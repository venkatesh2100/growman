import Link from "next/link";
import { Card, PageHeader, PageShell } from "../../components/layout/Page";
import { buttonClass } from "../../components/ui/buttonStyles";
import { business } from "../../lib/seo/site";

const deletedItems = [
  "Profile (name, email, phone)",
  "Saved addresses",
  "Login credentials",
  "Wishlist and stock alerts",
  "App preferences",
];

const DELETION_SUBJECT = "Account Deletion Request";

export default function DeleteAccount() {
  const mailto = `mailto:${business.email}?subject=${encodeURIComponent(DELETION_SUBJECT)}`;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Delete your account"
        description="For users of the Growman website and app (Dreamxcodey). Do it yourself from your account, or email us."
      />

      <Card as="section" className="p-5 sm:p-6" aria-labelledby="self-heading">
        <h2 id="self-heading" className="text-base font-semibold text-green-900">
          Do it yourself
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          If you can sign in, you can download a copy of your data and erase
          your details from your account — no email needed, and it takes effect
          immediately.
        </p>
        <Link href="/account/privacy" className={buttonClass("primary", "md", "mt-4")}>
          Go to your data
        </Link>
      </Card>

      <Card as="section" className="mt-4 p-5 sm:p-6" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-base font-semibold text-green-900">
          If you can&apos;t sign in
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
        <a href={mailto} className={buttonClass("secondary", "md", "mt-5")}>
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
            What we keep, and for how long
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">
            A minimised record of each past order — the items, the amount and the date, with
            your contact details removed — is kept for one year from the date of that order,
            because tax and consumer-protection law requires it. It is deleted after that and
            is never used for marketing. Reviews you wrote stay on the product pages, no
            longer shown under your name.
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
