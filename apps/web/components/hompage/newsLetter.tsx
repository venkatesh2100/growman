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
    <section className="max-h-[60vh] overflow-y-auto py-12 bg-gradient-to-br from-emerald-600 to-green-700">
      <div className="container mx-auto px-4 max-w-2xl">
        {isSubscribed && (
          <div className="mb-6 bg-green-800 text-white p-4 rounded-xl text-center animate-fade-in">
            <FaCheck className="inline mr-2" />
            Welcome! Check your email for 15% off coupon
          </div>
        )}

        <div className="text-center">
          <FaLeaf className="w-12 h-12 text-white mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-white mb-3">
            Join India's Green Community
          </h2>
          <p className="text-emerald-100 mb-6">
            Get plant care tips, exclusive offers & 15% off first order
          </p>

          <form onSubmit={handleSubmit} className="flex gap-3 mb-6">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="flex-1 px-5 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-emerald-200 focus:outline-none focus:border-emerald-400"
              required
            />
            <button
              type="submit"
              className="px-6 py-3 bg-white text-emerald-700 font-semibold rounded-lg hover:bg-emerald-50 transition-colors"
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