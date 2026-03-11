import Footer from "../../components/hompage/footer";

export default function DeleteAccount() {
  return (
    <main className="min-h-screen bg-[#f7f9f4]">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-[#1a4a2e] via-[#2d7a4f] to-[#3a9e64] text-white py-16 px-4 relative overflow-hidden">
        {/* Decorative leaf shapes */}
        <div className="absolute top-0 right-0 w-64 h-64 opacity-10 pointer-events-none select-none">
          <svg viewBox="0 0 200 200" fill="white" xmlns="http://www.w3.org/2000/svg">
            <path d="M100 10 C150 10 190 50 190 100 C190 150 150 190 100 190 C80 190 60 170 40 150 C20 130 10 110 10 90 C10 45 55 10 100 10Z" />
          </svg>
        </div>
        <div className="absolute bottom-0 left-10 w-40 h-40 opacity-10 pointer-events-none select-none">
          <svg viewBox="0 0 200 200" fill="white" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="100" cy="100" rx="90" ry="60" />
          </svg>
        </div>

        <div className="max-w-3xl mx-auto relative z-10">
          <div className="flex items-center gap-3 mb-4">
            {/* Leaf icon */}
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/20">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20C19 20 22 3 22 3c-1 2-8 4-9 9s-4 7-5 7 3-2 4-7 8-7 5-4z"/>
              </svg>
            </span>
            <span className="text-green-200 text-sm font-semibold uppercase tracking-widest">Account Management</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold leading-tight mb-3 tracking-tight">
            Delete Your Growman Account
          </h1>
          <p className="text-green-100 text-base md:text-lg max-w-xl leading-relaxed">
            We're sorry to see you go. Your privacy matters to us — here's how to permanently remove your account and data.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-10">

        {/* Intro Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6 md:p-8">
          <p className="text-gray-600 leading-relaxed">
            This page explains how users of the <span className="font-semibold text-green-800">Growman</span> mobile application, published by <span className="font-semibold text-green-800">Dreamxcodey</span>, can request deletion of their account and all associated personal data.
          </p>
        </div>

        {/* Steps */}
        <section>
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1 h-6 rounded-full bg-[#3a9e64]"></div>
            <h2 className="text-xl md:text-2xl font-bold text-[#1a4a2e]">Steps to Request Account Deletion</h2>
          </div>
          <div className="space-y-4">
            {[
              {
                num: "01",
                text: (
                  <>Send an email to <a href="mailto:growman.live@gmail.com" className="text-[#3a9e64] font-semibold hover:underline">growman.live@gmail.com</a></>
                ),
              },
              {
                num: "02",
                text: "Use the email address or phone number that is registered in the Growman mobile app.",
              },
              {
                num: "03",
                text: (
                  <>Mention <span className="font-semibold text-[#1a4a2e]">"Account Deletion Request"</span> in the email subject.</>
                ),
              },
              {
                num: "04",
                text: (
                  <>Our support team will verify your request and process the deletion within <span className="font-semibold text-[#1a4a2e]">7 business days</span>.</>
                ),
              },
            ].map((step) => (
              <div key={step.num} className="flex items-start gap-4 bg-white rounded-xl border border-green-100 shadow-sm p-5">
                <span className="shrink-0 text-2xl font-black text-green-200 leading-none w-10 text-center">{step.num}</span>
                <p className="text-gray-700 leading-relaxed">{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Two column data section */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Data Deleted */}
          <section className="bg-white rounded-2xl border border-green-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-50">
                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </span>
              <h2 className="text-lg font-bold text-[#1a4a2e]">Data That Will Be Deleted</h2>
            </div>
            <ul className="space-y-2.5">
              {[
                "User profile information",
                "Saved delivery addresses",
                "Account login credentials",
                "Order history",
                "Stored preferences & settings",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-gray-600 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Data Retained */}
          <section className="bg-white rounded-2xl border border-green-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-50">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <h2 className="text-lg font-bold text-[#1a4a2e]">Data That May Be Retained</h2>
            </div>
            <p className="text-gray-600 text-sm leading-relaxed">
              Certain transaction records such as invoices or purchase records may be retained for up to{" "}
              <span className="font-semibold text-[#1a4a2e]">90 days</span>, or longer if required for legal, accounting, or tax compliance purposes.
            </p>
            <p className="text-gray-500 text-sm mt-3">
              This data is stored securely and is never used for marketing or other purposes.
            </p>
          </section>
        </div>

        {/* Contact */}
        <section className="bg-gradient-to-br from-[#1a4a2e] to-[#2d7a4f] rounded-2xl p-6 md:p-8 text-white">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-green-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <h2 className="text-lg font-bold">Have Questions? Contact Us</h2>
          </div>
          <p className="text-green-200 text-sm mb-4 leading-relaxed">
            If you have any questions regarding account deletion or your personal data, our support team is here to help.
          </p>
          <a
            href="mailto:growman.live@gmail.com"
            className="inline-flex items-center gap-2 bg-white text-[#1a4a2e] font-semibold text-sm px-5 py-2.5 rounded-full hover:bg-green-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            growman.live@gmail.com
          </a>
        </section>

      </div>

      <Footer />
    </main>
  );
}