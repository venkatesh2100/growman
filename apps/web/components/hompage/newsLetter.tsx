'use client';

import { useState } from 'react';
import { FaLeaf, FaCheck } from 'react-icons/fa';

export default function NewsLetterSection() {
  const [email, setEmail] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubscribed(true);
    setTimeout(() => setIsSubscribed(false), 5000);
    setEmail('');
  };

  return (
    <section className="bg-gradient-to-br from-emerald-600 to-green-700 py-8 sm:py-10">
      <div className="container mx-auto max-w-2xl px-4">
        {isSubscribed && (
          <div className="mb-4 rounded-xl bg-white/10 p-4 text-center text-white animate-fade-in sm:mb-6">
            <FaCheck className="mr-2 inline" />
            Welcome! Check your email for our weekly newsletter.
          </div>
        )}

        <div className="text-center">
          {/* <FaLeaf className="mx-auto mb-3 h-10 w-10 text-white sm:mb-4 sm:h-12 sm:w-12" /> */}
          <h2 className="mb-2 text-2xl font-bold text-white sm:mb-3 sm:text-3xl">
            Join India&apos;s Green Community
          </h2>
          <p className="mb-5 text-sm text-emerald-100 sm:mb-6 sm:text-base">
            Get plant care tips and exclusive offers
          </p>

          <form
            onSubmit={handleSubmit}
            className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="flex-1 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-emerald-200 focus:border-emerald-400 focus:outline-none"
              required
            />
            <button
              type="submit"
              className="rounded-lg bg-white px-6 py-3 font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              Subscribe
            </button>
          </form>

          <p className="text-xs text-emerald-200/80">
            By subscribing, you agree to our Privacy Policy
          </p>
        </div>
      </div>
    </section>
  );
}