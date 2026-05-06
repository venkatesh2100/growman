const FULL_POLICY_URL =
  "https://www.privacypolicies.com/live/a738b4f7-0288-400a-b2d1-1c6af0406ab4";
const DELETE_ACCOUNT_URL = "https://growman.live/delete-account";
const SITE_URL = "https://growman.live/";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-base font-bold text-emerald-950">{title}</h2>
      <p className="text-sm leading-6 text-gray-600">{children}</p>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F7F8FA] py-10">
      <div className="mx-auto max-w-3xl rounded-xl border border-emerald-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-emerald-950">Privacy Policy</h1>
        <p className="mt-1 text-sm text-gray-600">Last updated: May 2026</p>

        <div className="mt-6">
          <Section title="Information We Collect">
            We collect account, order, and location details required for order fulfillment and support.
          </Section>
          <Section title="How We Use Data">
            Data is used for processing orders, customer support, recommendations, and platform security.
          </Section>
          <Section title="Your Controls">
            You can update profile details from account settings and request account deletion anytime.
          </Section>
          <Section title="Useful Links">
            Full policy: <a className="text-emerald-700 underline" href={FULL_POLICY_URL} target="_blank" rel="noreferrer">Privacy Policy Document</a>
            <br />
            Delete account: <a className="text-emerald-700 underline" href={DELETE_ACCOUNT_URL} target="_blank" rel="noreferrer">Delete Account</a>
            <br />
            Site: <a className="text-emerald-700 underline" href={SITE_URL} target="_blank" rel="noreferrer">{SITE_URL}</a>
          </Section>
        </div>
      </div>
    </main>
  );
}
