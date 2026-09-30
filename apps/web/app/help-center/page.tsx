import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Clock, Mail, Phone } from "lucide-react";
import JsonLd from "../../components/seo/JsonLd";
import { Card, PageHeader, PageShell } from "../../components/layout/Page";
import { createBreadcrumbs, createPageMetadata } from "../../lib/seo/metadata";
import { createFaqJsonLd } from "../../lib/seo/jsonLd";
import { business, openingHoursDisplay } from "../../lib/seo/site";

export const metadata: Metadata = createPageMetadata({
  title: "Help Center",
  description:
    "Answers to common Growman questions about payment, delivery across India, store pickup, order tracking, damaged plants and bulk orders.",
  path: "/help-center",
});

type Faq = { q: string; a: string; link?: { href: string; label: string } };

const FAQ_GROUPS: Array<{ id: string; title: string; items: Faq[] }> = [
  {
    id: "ordering",
    title: "Ordering and payment",
    items: [
      {
        q: "How do I pay?",
        a: "Pay online at checkout by UPI, debit or credit card, netbanking or wallet. Payments are processed by Razorpay; Growman does not store your card details.",
      },
      {
        q: "Do I need an account to order?",
        a: "No. You can check out as a guest with your name, mobile number, email and address. Signing in saves your address for next time and keeps your orders in one place.",
        link: { href: "/signup", label: "Create an account" },
      },
      {
        q: "Will I get an order confirmation?",
        a: "Yes. We email a confirmation to the address you entered at checkout as soon as your payment goes through.",
      },
    ],
  },
  {
    id: "delivery",
    title: "Delivery and pickup",
    items: [
      {
        q: "Where do you deliver?",
        a: "Across India. The delivery fee depends on your address and the size of the plants, and it is shown at checkout before you pay. For some addresses and very large orders we cannot show a fixed fee online; checkout then lets you send a quotation request and our team calls you with a price.",
      },
      {
        q: "How long does delivery take?",
        a: "It depends on your pincode. Where a courier estimate is available, checkout shows it. Once your order is scheduled, its expected delivery date appears in Orders.",
      },
      {
        q: "How do I track my order?",
        a: "Sign in and open Orders. Each order shows its current status: confirmed, shipped, out for delivery or delivered.",
        link: { href: "/orders", label: "Go to Orders" },
      },
      {
        q: "Can I collect my plants from the nursery?",
        a: `Yes. In your cart, choose "Pick up at the nursery". We set the plants aside at our ${business.address.locality} nursery and the store calls you to confirm the amount and a pickup time. Nothing is paid online.`,
        link: { href: "/cart", label: "Go to cart" },
      },
    ],
  },
  {
    id: "plants",
    title: "Plants and care",
    items: [
      {
        q: "What if a plant arrives damaged?",
        a: "Plants are living products, so we look at each case individually. Contact us within 48 hours of delivery with your order number, and a photo if possible, and we will help.",
      },
      {
        q: "How do I look after my plant?",
        a: "Each product page lists care basics such as light and watering. For specific questions, ask Dootha, our plant assistant, using the chat button, or read our plant care guides.",
        link: { href: "/blog", label: "Read the care guides" },
      },
      {
        q: "Can you identify a plant from a photo?",
        a: "Yes. Tap the camera icon in the search bar and upload a photo of the plant.",
      },
    ],
  },
  {
    id: "bulk",
    title: "Bulk orders and account",
    items: [
      {
        q: "Do you take bulk and corporate orders?",
        a: "Yes, for landscaping, offices, events and resellers. List the plants and quantities you need on the bulk orders page and we reply with an itemised quotation. Add your GSTIN to the request if you need it on the quotation.",
        link: { href: "/bulk", label: "Request a quotation" },
      },
      {
        q: "How do I delete my account?",
        a: "Email us from the address or phone number registered with your account, with the subject \"Account Deletion Request\". We process requests within 7 business days.",
        link: { href: "/delete-account", label: "Delete my account" },
      },
    ],
  },
];

const ALL_FAQS = FAQ_GROUPS.flatMap((group) => group.items);

export default function HelpCenterPage() {
  return (
    <PageShell width="narrow">
      {/* Built from the same questions rendered below. */}
      <JsonLd id="help-center-faq" data={createFaqJsonLd(ALL_FAQS)} />

      <PageHeader
        breadcrumbs={createBreadcrumbs([{ name: "Help Center", path: "/help-center" }])}
        title="Help Center"
        description="Answers to the questions we are asked most. If yours isn't here, contact us using the details at the bottom of the page."
      />

      <nav aria-label="Help topics" className="mb-8 flex flex-wrap gap-2">
        {FAQ_GROUPS.map((group) => (
          <a
            key={group.id}
            href={`#${group.id}`}
            className="rounded-full border border-emerald-100 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:border-emerald-300 hover:text-green-900"
          >
            {group.title}
          </a>
        ))}
      </nav>

      <div className="space-y-10">
        {FAQ_GROUPS.map((group) => (
          <section key={group.id} id={group.id} aria-labelledby={`${group.id}-heading`} className="scroll-mt-32">
            <h2 id={`${group.id}-heading`} className="mb-3 font-space text-lg font-semibold text-green-900">
              {group.title}
            </h2>
            <div className="divide-y divide-emerald-50 rounded-2xl border border-emerald-100 bg-white">
              {group.items.map((item) => (
                <details key={item.q} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium text-green-900">
                    {item.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="pb-4 text-sm leading-relaxed text-gray-600">
                    <p>{item.a}</p>
                    {item.link ? (
                      <Link
                        href={item.link.href}
                        className="mt-2 inline-block font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        {item.link.label} →
                      </Link>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card as="section" className="mt-12 p-6" aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="font-space text-lg font-semibold text-green-900">
          Contact us
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Include your order number if your question is about an order.
        </p>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <li className="flex items-center gap-2.5">
            <Phone className="h-4 w-4 shrink-0 text-emerald-700" />
            <a href={`tel:${business.telephone}`} className="font-medium text-emerald-700 hover:text-emerald-900">
              Call the nursery
            </a>
          </li>
          <li className="flex items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0 text-emerald-700" />
            <a href={`mailto:${business.email}`} className="break-all text-gray-700 hover:text-green-900">
              {business.email}
            </a>
          </li>
          <li className="flex items-center gap-2.5 text-gray-700">
            <Clock className="h-4 w-4 shrink-0 text-emerald-700" />
            {openingHoursDisplay}
          </li>
        </ul>
      </Card>
    </PageShell>
  );
}
