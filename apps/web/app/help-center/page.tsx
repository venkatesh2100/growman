import Link from "next/link";

const faqs = [
  {
    q: "How do I track my order?",
    a: "After placing an order, go to Orders to see the latest status and details.",
  },
  {
    q: "What is your return policy?",
    a: "Plants are living products. Contact support within 48 hours if there is a delivery issue.",
  },
  {
    q: "How do I care for my plants?",
    a: "Each product page includes care instructions. You can also ask Dootha assistant for guidance.",
  },
  {
    q: "Do you deliver nationwide?",
    a: "Yes, delivery is available across India. Timelines vary by pincode and weather conditions.",
  },
];

export default function HelpCenterPage() {
  return (
    <main className="min-h-screen bg-[#F7F8FA] py-10">
      <div className="mx-auto max-w-3xl px-4">
        <h1 className="text-2xl font-bold text-emerald-950">Help Center</h1>
        <p className="mt-1 text-sm text-gray-600">
          Answers to common questions and quick links for support.
        </p>

        <div className="mt-6 space-y-3">
          {faqs.map((item) => (
            <div key={item.q} className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
              <h2 className="font-semibold text-emerald-950">{item.q}</h2>
              <p className="mt-1 text-sm text-gray-600">{item.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Link href="/account" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
            Need more help? Contact support from your account.
          </Link>
        </div>
      </div>
    </main>
  );
}
