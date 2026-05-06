function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-base font-bold text-emerald-950">{title}</h2>
      <p className="text-sm leading-6 text-gray-600">{children}</p>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#F7F8FA] py-10">
      <div className="mx-auto max-w-3xl rounded-xl border border-emerald-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-emerald-950">Terms & Conditions</h1>
        <p className="mt-1 text-sm text-gray-600">Please review before using Growman services.</p>

        <div className="mt-6">
          <Section title="Orders and Fulfillment">
            Orders are subject to stock availability and serviceability at your location.
          </Section>
          <Section title="Pricing and Payments">
            All prices are listed in INR unless specified. Payment confirmation is required before dispatch.
          </Section>
          <Section title="Returns and Support">
            For quality or delivery issues, contact support within 48 hours with order details and photos.
          </Section>
          <Section title="Platform Usage">
            Users must provide accurate information and avoid abusive or fraudulent activity.
          </Section>
        </div>
      </div>
    </main>
  );
}
