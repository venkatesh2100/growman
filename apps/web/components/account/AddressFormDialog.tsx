"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Navigation } from "lucide-react";
import { apiFetch, readApiError } from "../../lib/api";
import {
  addressPayload,
  emptyAddressInput,
  toAddressInput,
  validateAddressInput,
  type AddressCoords,
  type AddressInput,
  type SavedAddress,
} from "../../lib/addresses";
import {
  getAllStateNames,
  getCitiesByState,
  indianStates,
} from "../../lib/data/indianStatesCities";
import { userMessage } from "../../lib/errors";
import { getCurrentLocation } from "../../lib/utils/geolocation";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { buttonClass } from "../ui/buttonStyles";
import { FormField, FormSelect } from "../ui/Input";
import ModalDialog from "../ui/ModalDialog";

type Props = {
  /** The address being edited, or null to add a new one. */
  address: SavedAddress | null;
  /** True when this will be the only saved address, which makes it the default. */
  isFirstAddress: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
};

export default function AddressFormDialog({
  address,
  isFirstAddress,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<AddressInput>(
    address ? toAddressInput(address) : emptyAddressInput
  );
  const [coords, setCoords] = useState<AddressCoords>({
    latitude: address?.latitude,
    longitude: address?.longitude,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const cities = form.state ? getCitiesByState(form.state) : [];
  const cityListId = "address-city-suggestions";

  const update = (patch: Partial<AddressInput>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    if (error) setError(null);
  };

  const handleLocateMe = async () => {
    setLocating(true);
    try {
      const location = await getCurrentLocation();

      let matchedState = "";
      if (location.state) {
        const needle = location.state.toLowerCase();
        const match = indianStates.find(
          (state) =>
            state.name.toLowerCase().includes(needle) ||
            needle.includes(state.name.toLowerCase())
        );
        if (match) matchedState = match.name;
      }

      update({
        addressLine: location.addressLine || form.addressLine,
        city: location.city || form.city,
        state: matchedState || form.state,
        pincode: location.pincode || form.pincode,
      });
      if (location.latitude && location.longitude) {
        setCoords({
          latitude: location.latitude,
          longitude: location.longitude,
        });
      }
    } catch (err) {
      setError(
        userMessage(
          err,
          "Couldn't find your location. Please enter the address instead."
        )
      );
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateAddressInput(form);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(
        address ? `/addresses/${address.id}` : "/addresses",
        {
          method: address ? "PUT" : "POST",
          body: JSON.stringify(
            addressPayload(
              { ...form, isDefault: form.isDefault || isFirstAddress },
              coords
            )
          ),
        }
      );
      if (!res.ok) {
        setError(
          await readApiError(
            res,
            "We couldn't save that address. Please try again."
          )
        );
        return;
      }
      onSaved(address ? "Address updated." : "Address saved.");
    } catch {
      toast(
        "We couldn't reach the server. Please check your connection.",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={address ? "Edit address" : "Add an address"}
      description="We use this to work out delivery and to print the shipping label."
      busy={saving}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormField
          size="sm"
          label="Name of this address (optional)"
          value={form.label}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Home, Office"
          maxLength={40}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            size="sm"
            label="Full name"
            autoComplete="name"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Who receives the plants"
            maxLength={100}
          />
          <FormField
            size="sm"
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={form.phone}
            onChange={(e) =>
              update({ phone: e.target.value.replace(/\D/g, "").slice(0, 10) })
            }
            placeholder="9876543210"
            maxLength={10}
            hint="The courier calls this number"
          />
        </div>

        <FormField
          size="sm"
          label="Street address"
          autoComplete="street-address"
          labelExtra={
            <button
              type="button"
              onClick={() => void handleLocateMe()}
              disabled={locating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-green-900 transition-colors hover:bg-emerald-50/60 disabled:opacity-50"
            >
              {locating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Navigation
                  className="h-3.5 w-3.5 text-emerald-700"
                  aria-hidden="true"
                />
              )}
              {locating ? "Locating" : "Use my location"}
            </button>
          }
          value={form.addressLine}
          onChange={(e) => update({ addressLine: e.target.value })}
          placeholder="House / flat, building, street"
          maxLength={200}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            size="sm"
            label="Pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            value={form.pincode}
            onChange={(e) =>
              update({ pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })
            }
            placeholder="500001"
            maxLength={6}
          />
          <FormSelect
            size="sm"
            label="State"
            value={form.state}
            onChange={(e) => update({ state: e.target.value, city: "" })}
          >
            <option value="">Select state</option>
            {getAllStateNames().map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </FormSelect>
          <div className="col-span-2">
            <FormField
              size="sm"
              label="City"
              autoComplete="address-level2"
              list={cities.length > 0 ? cityListId : undefined}
              value={form.city}
              onChange={(e) => update({ city: e.target.value })}
              placeholder={form.state ? "Start typing" : "Select a state first"}
              maxLength={80}
            />
            {cities.length > 0 ? (
              <datalist id={cityListId}>
                {cities.map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            ) : null}
          </div>
        </div>

        {isFirstAddress ? (
          <p className="text-xs text-gray-500">
            This is your first saved address, so it becomes your default.
          </p>
        ) : (
          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => update({ isDefault: e.target.checked })}
              disabled={address?.isDefault}
              className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-600/30 disabled:opacity-60"
            />
            <span>
              Use this as my default address
              {address?.isDefault ? (
                <span className="block text-xs text-gray-500">
                  This is already your default. Set another address as default
                  to change it.
                </span>
              ) : null}
            </span>
          </label>
        )}

        <p className="text-xs text-gray-500">
          We deliver within India only.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={buttonClass("secondary", "md")}
          >
            Cancel
          </button>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            loadingText="Saving"
          >
            {address ? "Save changes" : "Save address"}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
