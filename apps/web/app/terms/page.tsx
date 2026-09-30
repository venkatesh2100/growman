import type { Metadata } from "next";
import LegalPage from "../../components/layout/LegalPage";
import { createPageMetadata } from "../../lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Terms & Conditions",
  description:
    "The terms that apply when ordering plants from Growman, covering orders, fulfilment, pricing and acceptable use of the service.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      path="/terms"
      intro="These terms apply when you use Growman or place an order with us. Please read them before ordering."
      sections={[
        {
          title: "Orders and fulfilment",
          body: "Orders are subject to stock availability and to delivery being possible at your location.",
        },
        {
          title: "Pricing and payment",
          body: "All prices are in Indian rupees (INR) unless stated otherwise. An order is dispatched only after payment is confirmed.",
        },
        {
          title: "Returns and support",
          body: "For quality or delivery issues, contact us within 48 hours of delivery with your order details and photos.",
        },
        {
          title: "Use of the platform",
          body: "You must provide accurate information and must not use Growman for abusive or fraudulent activity.",
        },
      ]}
    />
  );
}
