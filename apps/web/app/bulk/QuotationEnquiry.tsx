"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Printer, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { FormField, FormTextarea } from "../../components/ui/Input";
import { apiFetch, readJson } from "../../lib/api";
import { userMessage } from "../../lib/errors";
import {
  collectClientContext,
  formatRupees,
  submitQuotation,
  type Quotation,
} from "../../lib/quotation";
import { useAuthStore } from "../../lib/store/authStore";
import type { BulkItem } from "./BulkOrderList";
import QuotationDocument from "./QuotationDocument";

export type EnquiryLine = BulkItem & { quantity: number };

type Contact = { name: string; phone: string; address: string };

/** The parts of the signed-in profile this form prefills from. */
type ProfileResponse = {
  name?: string;
  phone?: string;
  address?: { line?: string; city?: string; pincode?: string } | null;
};

type CustomLine = { id: number; name: string; size: string; quantity: number };

const EMPTY_DRAFT = { name: "", size: "", quantity: "" };

const draftInput =
  "h-9 min-w-0 rounded-md border border-gray-300 px-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none";

type Props = {
  lines: EnquiryLine[];
  /** Dialled by the call link. The digits are never printed on the page. */
  phone: string;
  onQuantityChange: (key: string, quantity: number) => void;
  onClose: () => void;
  onSent: () => void;
  /** Details the shopper already typed elsewhere; they win over saved ones. */
  initialContact?: Partial<Contact>;
};

const CONTACT_STORAGE_KEY = "growman-quotation-contact";

function validate(c: Contact): string | null {
  if (c.name.trim().length < 2) return "Please enter your name.";
  if (!/^[6-9]\d{9}$/.test(c.phone)) return "Please enter a valid 10-digit mobile number.";
  if (c.address.trim().length < 5) return "Please enter the delivery address.";
  return null;
}

/** Prints only the quotation, in an isolated frame that reuses the page's stylesheets. */
async function printQuotation(node: HTMLElement, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join("");
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${window.location.origin}/"><title>${title}</title>${styles}` +
      `<style>@page{size:A4;margin:12mm}html,body{background:#fff}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>` +
      `</head><body>${node.outerHTML}</body></html>`
  );
  doc.close();
  const pending: Array<HTMLLinkElement | HTMLImageElement> = [
    ...Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter((l) => !l.sheet),
    ...Array.from(doc.images).filter((img) => !img.complete),
  ];
  await Promise.all(
    pending.map(
      (el) =>
        new Promise<void>((resolve) => {
          el.onload = el.onerror = () => resolve();
          setTimeout(resolve, 2000);
        })
    )
  );
  win.focus();
  win.print();
  setTimeout(() => frame.remove(), 1000);
}

export default function QuotationEnquiry({
  lines,
  phone,
  onQuantityChange,
  onClose,
  onSent,
  initialContact,
}: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [contact, setContact] = useState<Contact>({
    name: initialContact?.name ?? "",
    phone: initialContact?.phone ?? "",
    address: initialContact?.address ?? "",
  });
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [customLines, setCustomLines] = useState<CustomLine[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const nextCustomId = useRef(1);

  const estimate = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const isEmpty = lines.length === 0 && customLines.length === 0;

  const addCustomLine = () => {
    const name = draft.name.trim();
    const quantity = Number.parseInt(draft.quantity, 10);
    if (name.length < 2) {
      setDraftError("Enter the plant name.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setDraftError("Enter how many you need.");
      return;
    }
    setCustomLines((prev) => [
      ...prev,
      { id: nextCustomId.current++, name, size: draft.size.trim(), quantity },
    ]);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    if (error) setError(null);
  };

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
        setContact((prev) => ({
          name: prev.name || s.name || "",
          phone: prev.phone || s.phone || "",
          address: prev.address || s.address || "",
        }));
        return;
      }
    } catch {
      // ignore unreadable storage
    }
    if (!isAuthenticated) return;
    void (async () => {
      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) return;
        const me = await readJson<ProfileResponse>(res);
        const address = [me.address?.line, me.address?.city, me.address?.pincode]
          .filter(Boolean)
          .join(", ");
        setContact((prev) => ({
          name: prev.name || me.name || "",
          phone: prev.phone || String(me.phone || "").replace(/\D/g, "").slice(-10),
          address: prev.address || address,
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
    if (isEmpty) {
      setError("Add at least one plant.");
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
        address: contact.address.trim(),
        company: "",
        email: "",
        gstin: "",
        city: "",
        state: "",
        pincode: "",
        requiredBy: "",
        notes: "",
        services: { delivery: true, loading: true, plantation: true },
        website,
        items: lines.map((l) => ({
          productId: l.productId,
          sizeId: l.sizeId,
          quantity: l.quantity,
        })),
        customItems: customLines.map(({ name, size, quantity }) => ({ name, size, quantity })),
        client: collectClientContext(),
      });
      try {
        localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(contact));
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
    onSent();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quotation-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting && !quotation) onClose();
      }}
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:rounded-xl ${
          quotation ? "sm:max-w-4xl" : "sm:max-w-md"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5">
          <h2 id="quotation-title" className="text-lg font-semibold text-gray-900">
            {quotation ? `Quotation ${quotation.estimateNo}` : "Request quotation"}
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
          <div className="overflow-y-auto">
            <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="flex items-start gap-2 text-sm text-gray-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Sent. We&apos;ll call you on {quotation.requester.phone} to confirm.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    documentRef.current &&
                    void printQuotation(documentRef.current, `Quotation ${quotation.estimateNo}`)
                  }
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 sm:flex-none"
                >
                  <Printer className="h-4 w-4" />
                  Save PDF
                </button>
                <button
                  type="button"
                  onClick={finish}
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 sm:flex-none"
                >
                  Done
                </button>
              </div>
            </div>
            <QuotationDocument ref={documentRef} quotation={quotation} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
            <div className="overflow-y-auto px-4 py-4 sm:px-5">
              <ul className="divide-y divide-gray-100">
                {lines.map((line) => (
                  <li key={line.key} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-900">{line.name}</p>
                      <p className="text-xs text-gray-500">
                        {line.size ? `${line.size} · ` : ""}
                        {line.quantity.toLocaleString("en-IN")} units
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm text-gray-900">
                        {line.price > 0 ? formatRupees(line.price * line.quantity) : "On request"}
                      </span>
                      <button
                        type="button"
                        onClick={() => onQuantityChange(line.key, 0)}
                        aria-label={`Remove ${line.name}`}
                        className="text-gray-400 hover:text-gray-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
                {customLines.map((line) => (
                  <li key={`custom-${line.id}`} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-900">{line.name}</p>
                      <p className="text-xs text-gray-500">
                        {line.size ? `${line.size} · ` : ""}
                        {line.quantity.toLocaleString("en-IN")} units · requested
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm text-gray-500">On request</span>
                      <button
                        type="button"
                        onClick={() => setCustomLines((prev) => prev.filter((l) => l.id !== line.id))}
                        aria-label={`Remove ${line.name}`}
                        className="text-gray-400 hover:text-gray-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {isEmpty ? (
                <p className="text-sm text-gray-500">No plants added yet.</p>
              ) : (
                <div className="mt-2 flex justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-gray-900">
                  <span>Estimated total</span>
                  <span>{formatRupees(estimate)}</span>
                </div>
              )}

              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium text-gray-700">Need a plant that isn&apos;t listed?</p>
                <div className="flex gap-2">
                  <input
                    aria-label="Plant name"
                    placeholder="Plant name"
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomLine();
                      }
                    }}
                    className={`${draftInput} flex-1`}
                  />
                  <input
                    aria-label="Size"
                    placeholder="Size"
                    value={draft.size}
                    maxLength={40}
                    onChange={(e) => setDraft((d) => ({ ...d, size: e.target.value }))}
                    className={`${draftInput} w-20`}
                  />
                  <input
                    aria-label="Quantity"
                    placeholder="Qty"
                    inputMode="numeric"
                    value={draft.quantity}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, quantity: e.target.value.replace(/\D/g, "").slice(0, 6) }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomLine();
                      }
                    }}
                    className={`${draftInput} w-16`}
                  />
                  <button
                    type="button"
                    onClick={addCustomLine}
                    className="h-9 shrink-0 rounded-md border border-emerald-600 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    Add
                  </button>
                </div>
                {draftError ? <p className="mt-1 text-xs text-green-950/55">{draftError}</p> : null}
              </div>

              <div className="mt-5 space-y-3">
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
                  onChange={(e) => update("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number"
                  maxLength={10}
                />
                <FormTextarea
                  size="sm"
                  label="Delivery address"
                  rows={2}
                  autoComplete="street-address"
                  value={contact.address}
                  onChange={(e) => update("address", e.target.value)}
                  maxLength={300}
                />
              </div>

              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              {error ? <p role="alert" className="mt-3 text-sm text-green-950/55">{error}</p> : null}
            </div>

            <div className="border-t border-gray-200 px-4 py-3 sm:px-5">
              <Button type="submit" variant="solid-sm" loading={submitting} loadingText="Sending…">
                Send quotation request
              </Button>
              <p className="mt-2 text-center text-xs text-gray-500">
                Prefer to talk?{" "}
                <a href={`tel:${phone}`} className="font-medium text-emerald-700 hover:underline">
                  Contact us
                </a>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
