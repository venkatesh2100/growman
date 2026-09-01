import Link from "next/link";
import Image from "next/image";
import Footer from "../../components/hompage/footer";

const deletedItems = [
  "Profile (name, email, phone)",
  "Saved addresses",
  "Login credentials",
  "Order history",
  "App preferences",
];

export default function DeleteAccount() {
  return (
    <main className="min-h-screen bg-[#F9FAFB]">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <div className="mb-8 flex items-center gap-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-2xl shadow-sm ring-1 ring-emerald-800/10">
            <Image src="/growman.png" alt="Growman" fill sizes="44px" className="object-cover" />
          </div>
          <span className="font-space text-lg font-semibold tracking-tight text-green-900">
            Growman
          </span>
        </div>

        <h1 className="font-space text-[28px] font-bold tracking-tight text-green-900">
          Delete your account
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          For Growman app users (Dreamxcodey). Email us to remove your account and personal data.
        </p>

        <section className="mt-8 rounded-2xl border border-emerald-100/80 bg-white p-5 sm:p-6">
          <h2 className="text-base font-semibold text-green-900">How to request deletion</h2>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600">
            <li>
              Email{" "}
              <a
                href="mailto:growman.live@gmail.com"
                className="font-medium text-emerald-700 hover:text-emerald-800"
              >
                growman.live@gmail.com
              </a>
            </li>
            <li>Use the email or phone registered in the app.</li>
            <li>Subject line: Account Deletion Request.</li>
            <li>We process requests within 7 business days.</li>
          </ol>
        </section>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-emerald-100/80 bg-white p-5">
            <h2 className="text-sm font-semibold text-green-900">What we delete</h2>
            <ul className="mt-3 space-y-2 text-sm text-gray-600">
              {deletedItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-emerald-600">·</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-emerald-100/80 bg-white p-5">
            <h2 className="text-sm font-semibold text-green-900">What we may keep</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Invoices and transaction records may be kept up to 90 days for legal or tax reasons.
              Not used for marketing.
            </p>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-emerald-100/80 bg-[#F9FAFB] p-5 sm:p-6">
          <p className="text-sm text-gray-500">Questions about your data?</p>
          <a
            href="mailto:growman.live@gmail.com"
            className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            growman.live@gmail.com
          </a>
          <p className="mt-4">
            <Link href="/" className="text-sm font-medium text-gray-500 hover:text-green-900">
              Back to shop
            </Link>
          </p>
        </section>
      </div>

      <Footer />
    </main>
  );
}
