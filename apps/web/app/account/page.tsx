"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Navigation, Pencil } from "lucide-react";
import { apiFetch, readJson } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { indianStates, getAllStateNames } from "../../lib/data/indianStatesCities";
import { getCurrentLocation } from "../../lib/utils/geolocation";
import { toast } from "../../lib/toast";
import { userMessage } from "../../lib/errors";
import AccountShell from "../../components/account/AccountShell";
import { FormField, FormSelect } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { buttonClass } from "../../components/ui/buttonStyles";

interface Address {
  line: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

interface UserInfo {
  name: string;
  email: string;
  phone: string;
  address: Address;
}

const emptyAddress: Address = { line: "", city: "", state: "", pincode: "", country: "India" };

const emptyUser: UserInfo = { name: "", email: "", phone: "", address: emptyAddress };

type UserResponse = {
  name?: string;
  email?: string;
  phone?: string;
  address?: Partial<Address> | null;
};

type SaveProfileResponse = {
  user?: UserResponse;
};

/** Normalises the /auth/me and /auth/profile user shape. */
function toUserInfo(data: UserResponse): UserInfo {
  return {
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    address: {
      line: data.address?.line || "",
      city: data.address?.city || "",
      state: data.address?.state || "",
      pincode: data.address?.pincode || "",
      country: data.address?.country || "India",
    },
  };
}

function hasAddress(address: Address): boolean {
  return Boolean(address.line || address.city || address.pincode);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-green-900">
        {value || <span className="text-gray-400">Not added</span>}
      </dd>
    </div>
  );
}

export default function AccountPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [formData, setFormData] = useState<UserInfo>(emptyUser);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchUserInfo = async () => {
      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) throw new Error("Failed to fetch user info");
        const info = toUserInfo(await readJson<UserResponse>(res));
        setUserInfo(info);
        setFormData(info);
      } catch (error) {
        console.error("Error fetching user info:", error);
        setUserInfo(emptyUser);
        setFormData(emptyUser);
      }
    };

    void fetchUserInfo();
  }, [isAuthenticated]);

  const setAddress = (patch: Partial<Address>) =>
    setFormData((prev) => ({ ...prev, address: { ...prev.address, ...patch } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          addressLine: formData.address.line,
          city: formData.address.city,
          state: formData.address.state,
          pincode: formData.address.pincode,
          country: formData.address.country,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("Save profile failed:", res.status, errorData);
        throw new Error("save profile failed");
      }

      const data = await readJson<SaveProfileResponse>(res);
      const saved = data.user ? toUserInfo(data.user) : formData;
      setUserInfo(saved);
      setFormData(saved);
      setEditing(false);
      toast("Your details have been saved.", "success");
    } catch {
      toast("Couldn't save your details. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (userInfo) setFormData(userInfo);
    setEditing(false);
  };

  const handleLocateMe = async () => {
    setLocating(true);
    try {
      const locationData = await getCurrentLocation();

      let matchedState = "";
      if (locationData.state) {
        const stateMatch = indianStates.find(
          (state) =>
            state.name.toLowerCase().includes(locationData.state!.toLowerCase()) ||
            locationData.state!.toLowerCase().includes(state.name.toLowerCase())
        );
        if (stateMatch) matchedState = stateMatch.name;
      }

      const updatedAddress: Address = {
        line: locationData.addressLine || formData.address.line,
        city: locationData.city || formData.address.city,
        state: matchedState || formData.address.state,
        pincode: locationData.pincode || formData.address.pincode,
        country: locationData.country || "India",
      };
      setFormData((prev) => ({ ...prev, address: updatedAddress }));

      if (locationData.latitude && locationData.longitude) {
        try {
          const res = await apiFetch("/auth/save-location", {
            method: "POST",
            body: JSON.stringify({
              addressLine: updatedAddress.line,
              city: updatedAddress.city,
              state: updatedAddress.state,
              pincode: updatedAddress.pincode,
              country: updatedAddress.country,
              latitude: locationData.latitude,
              longitude: locationData.longitude,
            }),
          });
          if (!res.ok) console.error("Failed to save location to backend");
        } catch (error) {
          // The form is already filled in; saving the coordinates is a bonus.
          console.error("Error saving location:", error);
        }
      }
    } catch (error) {
      toast(
        userMessage(error, "Couldn't find your location. Please enter your pincode."),
        "error"
      );
    } finally {
      setLocating(false);
    }
  };

  const address = userInfo?.address ?? emptyAddress;

  return (
    <AccountShell
      title="Profile"
      description="Your contact details and the address we fill in at checkout."
      actions={
        userInfo && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={buttonClass("secondary", "sm")}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit details
          </button>
        ) : null
      }
    >
      {!userInfo ? (
        <div className="h-64 animate-pulse rounded-2xl border border-emerald-100 bg-white" />
      ) : (
        <div className="space-y-4">
          <section
            aria-labelledby="personal-heading"
            className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
          >
            <h2 id="personal-heading" className="mb-4 text-base font-semibold text-green-900">
              Personal details
            </h2>
            {editing ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Full name"
                  type="text"
                  autoComplete="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
                <FormField
                  label="Mobile number"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                    })
                  }
                  placeholder="9876543210"
                  maxLength={10}
                />
                <div className="sm:col-span-2">
                  <FormField
                    label="Email"
                    type="email"
                    value={formData.email}
                    disabled
                    readOnly
                    hint="Your email is your sign-in and can't be changed here."
                  />
                </div>
              </div>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Full name" value={userInfo.name} />
                <Detail label="Mobile number" value={userInfo.phone} />
                <Detail label="Email" value={userInfo.email} />
              </dl>
            )}
          </section>

          <section
            aria-labelledby="address-heading"
            className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="address-heading" className="text-base font-semibold text-green-900">
                Saved address
              </h2>
              {editing ? (
                <button
                  type="button"
                  onClick={handleLocateMe}
                  disabled={locating}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-green-900 hover:bg-emerald-50/60 disabled:opacity-50"
                >
                  {locating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Navigation className="h-3.5 w-3.5 text-emerald-700" />
                  )}
                  {locating ? "Locating…" : "Use my location"}
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="space-y-4">
                <FormField
                  label="Street address"
                  type="text"
                  autoComplete="street-address"
                  value={formData.address.line}
                  onChange={(e) => setAddress({ line: e.target.value })}
                  placeholder="House / flat, building, street"
                />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <FormField
                    label="Pincode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={formData.address.pincode}
                    onChange={(e) =>
                      setAddress({ pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })
                    }
                    placeholder="500001"
                    maxLength={6}
                  />
                  <FormField
                    label="City"
                    type="text"
                    autoComplete="address-level2"
                    value={formData.address.city}
                    onChange={(e) => setAddress({ city: e.target.value })}
                    placeholder="City"
                  />
                  <div className="col-span-2 sm:col-span-1">
                    <FormSelect
                      label="State"
                      value={formData.address.state}
                      onChange={(e) => setAddress({ state: e.target.value })}
                    >
                      <option value="">Select state</option>
                      {getAllStateNames().map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </FormSelect>
                  </div>
                </div>
                <p className="text-xs text-gray-500">We currently deliver within India only.</p>
              </div>
            ) : hasAddress(address) ? (
              <address className="text-sm leading-relaxed text-green-900 not-italic">
                {address.line ? <span className="block">{address.line}</span> : null}
                <span className="block">
                  {[address.city, address.state, address.pincode].filter(Boolean).join(", ")}
                </span>
                <span className="block text-gray-500">{address.country}</span>
              </address>
            ) : (
              <p className="text-sm text-gray-500">
                No address saved yet. Add one to fill in checkout automatically.
              </p>
            )}

            {editing ? null : (
              <p className="mt-4 text-xs text-gray-500">
                Deliver to more than one place?{" "}
                <Link
                  href="/account/addresses"
                  className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                >
                  Manage your address book
                </Link>
              </p>
            )}
          </section>

          {editing ? (
            <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCancel}
                className={buttonClass("secondary", "md")}
              >
                Cancel
              </button>
              <Button
                variant="primary"
                onClick={handleSave}
                loading={saving}
                loadingText="Saving…"
              >
                Save changes
              </Button>
            </div>
          ) : (
            <p className="pt-2 text-xs text-gray-500">
              Want a copy of your data, or to close your account?{" "}
              <Link
                href="/account/privacy"
                className="font-medium text-gray-700 underline underline-offset-2 hover:text-green-900"
              >
                Download or erase your data
              </Link>
            </p>
          )}
        </div>
      )}
    </AccountShell>
  );
}
