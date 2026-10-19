"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { apiFetch, readApiError, readJson } from "../../../lib/api";
import {
  addressPayload,
  addressRegionLine,
  toAddressInput,
  MAX_SAVED_ADDRESSES,
  type AddressListResponse,
  type SavedAddress,
} from "../../../lib/addresses";
import { useAuthStore } from "../../../lib/store/authStore";
import { toast } from "../../../lib/toast";
import AccountShell from "../../../components/account/AccountShell";
import AddressFormDialog from "../../../components/account/AddressFormDialog";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { buttonClass } from "../../../components/ui/buttonStyles";

type DeleteResponse = { success?: boolean };

export default function AddressBookPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedAddress | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [promoting, setPromoting] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/addresses");
      if (!res.ok) {
        setLoadError(
          await readApiError(res, "We couldn't load your saved addresses.")
        );
        setAddresses([]);
        return;
      }
      const data = await readJson<AddressListResponse>(res);
      setAddresses(data.addresses ?? []);
      setLoadError(null);
    } catch {
      setLoadError(
        "We couldn't reach the server. Please check your connection and try again."
      );
      setAddresses([]);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const handleSaved = (message: string) => {
    setAdding(false);
    setEditing(null);
    toast(message, "success");
    void load();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/addresses/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast(
          await readApiError(res, "We couldn't delete that address."),
          "error"
        );
        return;
      }
      await readJson<DeleteResponse>(res);
      setPendingDelete(null);
      toast("Address deleted.", "success");
      await load();
    } catch {
      toast("We couldn't reach the server. Please try again.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async (address: SavedAddress) => {
    setPromoting(address.id);
    try {
      const res = await apiFetch(`/addresses/${address.id}`, {
        method: "PUT",
        body: JSON.stringify(
          addressPayload(
            { ...toAddressInput(address), isDefault: true },
            address
          )
        ),
      });
      if (!res.ok) {
        toast(
          await readApiError(res, "We couldn't change your default address."),
          "error"
        );
        return;
      }
      toast("Default address updated.", "success");
      await load();
    } catch {
      toast("We couldn't reach the server. Please try again.", "error");
    } finally {
      setPromoting(null);
    }
  };

  const atLimit = (addresses?.length ?? 0) >= MAX_SAVED_ADDRESSES;

  return (
    <AccountShell
      title="Addresses"
      description="Places we deliver to. Your default address is filled in at checkout."
      actions={
        addresses && !atLimit ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={buttonClass("primary", "sm")}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add address
          </button>
        ) : null
      }
    >
      {addresses === null ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-36 animate-pulse rounded-2xl border border-emerald-100 bg-white" />
          <div className="h-36 animate-pulse rounded-2xl border border-emerald-100 bg-white" />
          <span className="sr-only">Loading your saved addresses</span>
        </div>
      ) : (
        <div className="space-y-4">
          {loadError ? (
            <p
              role="alert"
              className="rounded-2xl border border-emerald-100 bg-white p-5 text-sm text-gray-700"
            >
              {loadError}{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
              >
                Try again
              </button>
            </p>
          ) : null}

          {addresses.length === 0 && !loadError ? (
            <div className="rounded-2xl border border-emerald-100 bg-white p-8 text-center">
              <MapPin
                className="mx-auto h-8 w-8 text-emerald-600"
                aria-hidden="true"
              />
              <h2 className="mt-3 text-base font-semibold text-green-900">
                No addresses saved
              </h2>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-600">
                Save an address and checkout fills it in for you. You can keep
                up to {MAX_SAVED_ADDRESSES}.
              </p>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className={buttonClass("primary", "md", "mt-5")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first address
              </button>
            </div>
          ) : null}

          <ul className="space-y-4">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="rounded-2xl border border-emerald-100 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-green-900">
                        {address.label || address.name}
                      </h2>
                      {address.isDefault ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                          <Star
                            className="h-3 w-3 fill-emerald-600 text-emerald-600"
                            aria-hidden="true"
                          />
                          Default
                        </span>
                      ) : null}
                    </div>
                    <address className="mt-2 text-sm leading-relaxed text-gray-700 not-italic">
                      {address.label ? (
                        <span className="block">{address.name}</span>
                      ) : null}
                      <span className="block">{address.addressLine}</span>
                      <span className="block">{addressRegionLine(address)}</span>
                      <span className="block text-gray-500">
                        {address.phone}
                      </span>
                    </address>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(address)}
                      aria-label={`Edit address ${address.label || address.name}`}
                      className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-green-900"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(address)}
                      aria-label={`Delete address ${address.label || address.name}`}
                      className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {!address.isDefault ? (
                  <button
                    type="button"
                    onClick={() => void handleSetDefault(address)}
                    disabled={promoting !== null}
                    aria-busy={promoting === address.id}
                    className="mt-3 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-900 disabled:text-gray-400"
                  >
                    {promoting === address.id
                      ? "Setting as default"
                      : "Set as default"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {atLimit ? (
            <p className="text-xs text-gray-500">
              You have reached the limit of {MAX_SAVED_ADDRESSES} saved
              addresses. Delete one to add another.
            </p>
          ) : null}
        </div>
      )}

      {adding || editing ? (
        <AddressFormDialog
          address={editing}
          isFirstAddress={(addresses?.length ?? 0) === 0}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete this address?"
          confirmLabel="Delete address"
          busyLabel="Deleting"
          cancelLabel="Keep it"
          busy={deleting}
          onConfirm={() => void handleDelete()}
          onClose={() => setPendingDelete(null)}
        >
          <p>
            {pendingDelete.addressLine}, {addressRegionLine(pendingDelete)} will
            be removed from your account. Orders already placed to it are not
            affected.
          </p>
          {pendingDelete.isDefault ? (
            <p>
              This is your default address. Another saved address becomes the
              default in its place.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </AccountShell>
  );
}
