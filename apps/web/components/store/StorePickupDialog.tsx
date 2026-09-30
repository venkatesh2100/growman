"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Clock, MapPin, Phone, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { userMessage } from "../../lib/errors";
import {
  collectClientContext,
  formatRupees,
  submitQuotation,
  type Quotation,
} from "../../lib/quotation";
import { business, openingHoursDisplay } from "../../lib/seo/site";
import { useAuthStore } from "../../lib/store/authStore";
import type { CartItem } from "../../lib/store/cartStore";
import { Button } from "../ui/Button";
import { FormField, FormTextarea } from "../ui/Input";

/**
 * Shared with the bulk quotation form so a shopper who has already asked for a
 * quotation does not retype their name and number.
 */
const CONTACT_STORAGE_KEY = "growman-quotation-contact";

/**
 * A pickup request goes through the quotation endpoint, which requires an
 * address. There is no delivery address to give, so this states plainly what
 * the store is being asked for — it is what shows in the "Address" row of the
 * enquiry email the nursery receives.
 */
const PICKUP_ADDRESS = "Store pickup — customer will collect from the nursery";

type Props = {
  items: CartItem[];
  onClose: () => void;
  /** Called after a request is sent and the shopper dismisses the confirmation. */
  onSent?: () => void;
};

type Contact = { name: string; phone: string };

function validate(contact: Contact): string | null {
  if (contact.name.trim().length < 2) return "Please enter your name.";
  if (!/^[6-9]\d{9}$/.test(contact.phone)) {
    return "Please enter a valid 10-digit mobile number.";
  }
  return null;
}

/**
 * "Pick up at store" request for the items already in the cart.
 *
 * Nothing is paid here and no delivery is booked: the nursery sets the plants
 * aside, then calls to confirm the amount and a collection time. It reuses the
 * bulk quotation endpoint with delivery switched off, so the store receives the
 * request in the same inbox and format it already works from.
 */
export default function StorePickupDialog({ items, onClose, onSent }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [contact, setContact] = useState<Contact>({ name: "", phone: "" });
  const [collectBy, setCollectBy] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  /**
   * The cart and checkout summaries are `position: sticky`, which creates a
   * stacking context — a dialog rendered inside one paints under the fixed
   * navbar no matter its z-index. Portalling to the body avoids that.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const lines = items.filter((item) => item.productId > 0 && item.quantity > 0);
  const estimate = lines.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const units = lines.reduce((sum, i) => sum + i.quantity, 0);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONTACT_STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved) as Partial<Contact>;
        if (s.name || s.phone) {
          setContact({ name: s.name ?? "", phone: s.phone ?? "" });
          return;
        }
      }
    } catch {
      // ignore unreadable storage
    }
    if (!isAuthenticated) return;
    void (async () => {
      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) return;
        const me = await res.json();
        setContact((prev) => ({
          name: prev.name || me.name || "",
          phone:
            prev.phone ||
            String(me.phone || "")
              .replace(/\D/g, "")
              .slice(-10),
        }));
      } catch {
        // prefill is best-effort
      }
    })();
  }, [isAuthenticated]);

  const update = (key: keyof Contact, value: string) => {
    setContact((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) {
      setError("Your cart is empty.");
      return;
    }
    const problem = validate(contact);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitQuotation({
        name: contact.name.trim(),
        phone: contact.phone,
        address: PICKUP_ADDRESS,
        company: "",
        email: "",
        gstin: "",
        city: business.address.locality,
        state: business.address.region,
        pincode: "",
        requiredBy: collectBy.trim(),
        notes: notes.trim(),
        // Delivery off is what makes this a pickup: the quotation then prices
        // the plants alone, with freight marked "Not required".
        services: { delivery: false, loading: false, plantation: false },
        website,
        items: lines.map((item) => ({
          productId: item.productId,
          sizeId: item.productSizeId ?? 0,
          quantity: item.quantity,
        })),
        customItems: [],
        client: collectClientContext(),
      });
      try {
        const saved = localStorage.getItem(CONTACT_STORAGE_KEY);
        const existing = saved ? (JSON.parse(saved) as Record<string, unknown>) : {};
        localStorage.setItem(
          CONTACT_STORAGE_KEY,
          JSON.stringify({ ...existing, ...contact })
        );
      } catch {
        // storage is optional
      }
      setQuotation(result);
    } catch (err) {
      setError(userMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    onSent?.();
    onClose();
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-pickup-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting && !quotation) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:max-w-md sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5">
          <h2 id="store-pickup-title" className="text-lg font-semibold text-gray-900">
            {quotation ? "Plants reserved" : "Pick up at store"}
          </h2>
          <button
            type="button"
            onClick={quotation ? finish : onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {quotation ? (
          <div className="overflow-y-auto px-4 py-4 sm:px-5">
            <p className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              Request {quotation.estimateNo} sent. We&apos;ll set these plants aside
              and call you on {quotation.requester.phone} to confirm the amount and
              a time to collect.
            </p>

            <dl className="mt-4 space-y-2.5 rounded-lg bg-emerald-50/60 p-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <dt className="font-medium text-green-900">Collect from</dt>
                  <dd className="text-gray-700">
                    {business.parentOrganization}, {business.address.locality},{" "}
                    {business.address.region}
                    <a
                      href={business.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block text-xs font-medium text-emerald-700 underline underline-offset-2"
                    >
                      Open in Google Maps
                    </a>
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <dt className="font-medium text-green-900">Store hours</dt>
                  <dd className="text-gray-700">{openingHoursDisplay}</dd>
                </div>
              </div>
            </dl>

            <div className="mt-4 flex gap-2">
              <a
                href={`tel:${business.telephone}`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <Phone className="h-4 w-4" />
                Call the store
              </a>
              <button
                type="button"
                onClick={finish}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
            <div className="overflow-y-auto px-4 py-4 sm:px-5">
              <p className="text-sm text-gray-600">
                We&apos;ll set these plants aside at our {business.address.locality}{" "}
                nursery for you to visit and collect. Nothing is paid now — the
                store calls you to confirm the amount and a time.
              </p>

              <ul className="mt-3 divide-y divide-gray-100 border-y border-gray-100">
                {lines.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {item.label ? `${item.label} · ` : ""}
                        {item.quantity} {item.quantity === 1 ? "plant" : "plants"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm text-gray-900">
                      {formatRupees(item.price * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex justify-between text-sm font-semibold text-gray-900">
                <span>
                  {units} {units === 1 ? "plant" : "plants"} at listed rates
                </span>
                <span>{formatRupees(estimate)}</span>
              </p>

              <div className="mt-4 space-y-3">
                <FormField
                  size="sm"
                  label="Name"
                  autoComplete="name"
                  value={contact.name}
                  onChange={(e) => update("name", e.target.value)}
                  maxLength={100}
                />
                <FormField
                  size="sm"
                  label="Mobile number"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={contact.phone}
                  onChange={(e) =>
                    update("phone", e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder="10-digit number"
                  maxLength={10}
                  hint="The store calls this number to confirm"
                />
                <FormField
                  size="sm"
                  label="When will you collect? (optional)"
                  value={collectBy}
                  onChange={(e) => setCollectBy(e.target.value)}
                  placeholder="Tomorrow evening, Sunday morning…"
                  // The quotation endpoint stores this as a short single line.
                  maxLength={40}
                />
                <FormTextarea
                  size="sm"
                  label="Anything we should know? (optional)"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={300}
                />
              </div>

              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {error ? (
                <p role="alert" className="mt-3 text-sm text-green-950/55">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="border-t border-gray-200 px-4 py-3 sm:px-5">
              <Button
                type="submit"
                variant="solid-sm"
                loading={submitting}
                loadingText="Sending…"
              >
                Reserve for store pickup
              </Button>
              <p className="mt-2 text-center text-xs text-gray-500">
                Prefer to talk?{" "}
                <a
                  href={`tel:${business.telephone}`}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  Contact us
                </a>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
