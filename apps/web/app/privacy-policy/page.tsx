import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../../components/layout/LegalPage";
import { createPageMetadata } from "../../lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Privacy Policy",
  description:
    "How Growman collects, uses and stores account, order and location information, and how to request deletion of your data.",
  path: "/privacy-policy",
});

const FULL_POLICY_URL =
  "https://www.privacypolicies.com/live/a738b4f7-0288-400a-b2d1-1c6af0406ab4";

const linkClass = "font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900";

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      path="/privacy-policy"
      intro="A summary of the information Growman collects and how it is used. The full policy is linked below."
      updated="May 2026"
      sections={[
        {
          title: "Information we collect",
          body: "We collect the account, order and location details needed to fulfil orders and provide support.",
        },
        {
          title: "How we use it",
          body: "We use this information to process orders, provide customer support, recommend products and keep the platform secure.",
        },
        {
          title: "Your choices",
          body: (
            <>
              You can update your details from your{" "}
              <Link href="/account" className={linkClass}>
                account
              </Link>{" "}
              and{" "}
              <Link href="/delete-account" className={linkClass}>
                request deletion of your account
              </Link>{" "}
              at any time.
            </>
          ),
        },
        {
          title: "Full policy",
          body: (
            <>
              Read the complete{" "}
              <a className={linkClass} href={FULL_POLICY_URL} target="_blank" rel="noreferrer">
                Privacy Policy document
              </a>
              .
            </>
          ),
        },
      ]}
    />
  );
}
