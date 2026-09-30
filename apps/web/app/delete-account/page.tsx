import Link from "next/link";
import { Card, PageHeader, PageShell } from "../../components/layout/Page";
import { buttonClass } from "../../components/ui/buttonStyles";
import { business } from "../../lib/seo/site";

const deletedItems = [
  "Profile (name, email, phone)",
  "Saved addresses",
  "Login credentials",
  "Order history",
  "App preferences",
];

const DELETION_SUBJECT = "Account Deletion Request";

export default function DeleteAccount() {
  const mailto = `mailto:${business.email}?subject=${encodeURIComponent(DELETION_SUBJECT)}`;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Delete your account"
        description="For users of the Growman website and app (Dreamxcodey). Email us to remove your account and personal data."
      />

      <Card as="section" className="p-5 sm:p-6" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-base font-semibold text-green-900">
          How to request deletion
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-gray-700 marker:text-gray-400">
          <li>
            Email{" "}
            <a href={mailto} className="font-medium text-emerald-700 hover:text-emerald-900">
              {business.email}
            </a>
            .
          </li>
          <li>Send it from the email address, or mention the phone number, registered with your account.</li>
          <li>Use the subject line &ldquo;{DELETION_SUBJECT}&rdquo;.</li>
          <li>We process requests within 7 business days.</li>
        </ol>
        <a href={mailto} className={buttonClass("primary", "md", "mt-5")}>
          Email a deletion request
        </a>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card as="section" className="p-5" aria-labelledby="deleted-heading">
          <h2 id="deleted-heading" className="text-sm font-semibold text-green-900">
            What we delete
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-gray-700 marker:text-gray-400">
            {deletedItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>

        <Card as="section" className="p-5" aria-labelledby="kept-heading">
          <h2 id="kept-heading" className="text-sm font-semibold text-green-900">
            What we may keep
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">
            Invoices and transaction records may be kept for up to 90 days for legal or tax
            reasons. They are not used for marketing.
          </p>
        </Card>
      </div>

      <p className="mt-8 text-sm text-gray-600">
        Questions about your data? Email{" "}
        <a href={`mailto:${business.email}`} className="font-medium text-emerald-700 hover:text-emerald-900">
          {business.email}
        </a>{" "}
        or read our{" "}
        <Link href="/privacy-policy" className="font-medium text-emerald-700 hover:text-emerald-900">
          Privacy Policy
        </Link>
        .
      </p>
    </PageShell>
  );
}
