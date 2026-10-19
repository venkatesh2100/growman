"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Truck } from "lucide-react";
import { useAuthStore } from "../../../lib/store/authStore";
import { business } from "../../../lib/seo/site";
import AccountShell from "../../../components/account/AccountShell";
import ConsentChoices from "../../../components/privacy/ConsentChoices";
import DataExportButton from "../../../components/privacy/DataExportButton";
import ErasureDialog from "../../../components/privacy/ErasureDialog";
import { buttonClass } from "../../../components/ui/buttonStyles";

export default function PrivacyPage() {
  const router = useRouter();
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [erased, setErased] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const signOut = () => {
    clearAuth();
    router.replace("/");
  };

  return (
    <AccountShell
      title="Your data"
      description="Take a copy of everything we hold about you, or ask us to erase it."
    >
      <div className="space-y-4">
        <ConsentChoices />

        <section
          aria-labelledby="export-heading"
          className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
        >
          <h2
            id="export-heading"
            className="text-base font-semibold text-green-900"
          >
            Download my data
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            A JSON file with your account details, orders, saved addresses,
            reviews, wishlist, support requests and your consent history. It
            downloads straight to your device.
          </p>
          <DataExportButton />
        </section>

        {erased ? (
          <section
            aria-labelledby="erased-heading"
            className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
          >
            <h2
              id="erased-heading"
              className="flex items-center gap-2 text-base font-semibold text-green-900"
            >
              <CheckCircle2
                className="h-5 w-5 text-emerald-600"
                aria-hidden="true"
              />
              Your data has been erased
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {erased}
            </p>
            <button
              type="button"
              onClick={signOut}
              className={buttonClass("primary", "md", "mt-4")}
            >
              Sign out and return to the shop
            </button>
          </section>
        ) : (
          <section
            aria-labelledby="erase-heading"
            className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
          >
            <h2
              id="erase-heading"
              className="text-base font-semibold text-green-900"
            >
              Erase my data
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              We remove your identifying details right away: your name, email
              address and phone number are replaced with placeholders, and your
              saved addresses, wishlist and stock alerts are deleted. You will
              not be able to sign in again.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              One thing is not deleted immediately. A minimised record of your
              past orders — the items, the amount and the date, without your
              contact details — is kept for one year from the date of each
              order, because tax and consumer-protection law requires us to keep
              it. It is deleted once that year has passed.
            </p>

            {blocked ? (
              <div
                role="alert"
                className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
              >
                <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p>{blocked}</p>
                  <Link
                    href="/orders"
                    className="mt-1 inline-block font-medium underline underline-offset-2"
                  >
                    Check your orders
                  </Link>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={buttonClass("secondary", "md", "mt-4")}
            >
              Erase my data
            </button>
            <p className="mt-3 text-xs text-gray-500">
              Prefer to ask us by email? Write to{" "}
              <a
                href={`mailto:${business.email}`}
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
              >
                {business.email}
              </a>{" "}
              and read the{" "}
              <Link
                href="/privacy-policy"
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
              >
                privacy policy
              </Link>
              .
            </p>
          </section>
        )}
      </div>

      {dialogOpen ? (
        <ErasureDialog
          onClose={() => setDialogOpen(false)}
          onErased={(message) => {
            setDialogOpen(false);
            setBlocked(null);
            setErased(message);
          }}
          onBlocked={(reason) => {
            setDialogOpen(false);
            setBlocked(reason);
          }}
        />
      ) : null}
    </AccountShell>
  );
}
