"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { UserFacingError, userMessage } from "../../lib/errors";
import { useAuthStore } from "../../lib/store/authStore";
import { Button } from "../ui/Button";
import { FormField, FormTextarea } from "../ui/Input";

/**
 * Remembers that this browser has already seen the invitation, so it is shown
 * once rather than on every visit. Two keys, not one: a visitor who joined
 * should never be asked again, while a visitor who closed it can be shown the
 * popup again after the dismissal expires.
 */
const JOINED_KEY = "growman-dootha-waitlist-joined";
const DISMISSED_KEY = "growman-dootha-waitlist-dismissed";

/** A dismissal without joining is respected for this long. */
const DISMISS_DAYS = 30;

/** Long enough that the popup does not land on top of a page still painting. */
const OPEN_DELAY_MS = 8000;

/** Shared with the quotation and pickup forms so the name and number carry over. */
const CONTACT_STORAGE_KEY = "growman-quotation-contact";

/**
 * Product shots for the slider. One is square and one is portrait, so they are
 * shown with `object-contain` on a warm backdrop rather than cropped to fill —
 * the whole planter and its screen have to be visible.
 */
const SLIDES = [
  {
    src: "/dootha-care-1.jpg",
    alt: "Dootha Care planter with a pothos, its screen reading “Healthy & Growing” and 68% water",
  },
  {
    src: "/dootha-care-2.jpg",
    alt: "The mint green Dootha Care planter with a syngonium, its screen showing a thirsty face",
  },
];

/** Slow enough to actually look at each shot. */
const SLIDE_MS = 3800;

type Details = { name: string; phone: string; email: string; address: string };

const EMPTY: Details = { name: "", phone: "", email: "", address: "" };

function validate(details: Details): string | null {
  if (details.name.trim().length < 2) return "Please enter your name.";
  if (!/^[6-9]\d{9}$/.test(details.phone)) {
    return "Please enter a valid 10-digit mobile number.";
  }
  if (details.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email.trim())) {
    return "Please enter a valid email address, or leave it blank.";
  }
  return null;
}

/** True when this browser has neither joined nor recently dismissed the popup. */
function shouldOffer(): boolean {
  try {
    if (localStorage.getItem(JOINED_KEY)) return false;
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) || 0);
    if (!dismissedAt) return true;
    return Date.now() - dismissedAt > DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // Private mode with storage blocked: show it, but only this once per load.
    return true;
  }
}

/**
 * Auto-advancing product slider for the popup header. Crossfades rather than
 * slides horizontally, because the two shots have different aspect ratios and
 * a horizontal track would make the letterboxing jump around.
 */
function DeviceSlider() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    // Anyone who has asked for less motion keeps the first shot, and can still
    // page through with the dots.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % SLIDES.length),
      SLIDE_MS
    );
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <div
      className="relative h-48 w-full overflow-hidden bg-[#F6F2EA] sm:h-60"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Dootha Care"
    >
      {SLIDES.map((slide, i) => (
        <Image
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          fill
          // Both shots are square or portrait and `object-contain` fits them to
          // the box height, so the painted width is capped near 200px however
          // wide the screen is. Sizing by viewport instead makes the browser
          // fetch a file several times larger than it can use.
          sizes="200px"
          // The first shot is what a visitor sees when the popup opens.
          priority={i === 0}
          aria-hidden={i !== index}
          className={`object-contain py-2 transition-opacity duration-700 ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      <div className="absolute inset-x-0 bottom-1 flex justify-center gap-1">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show photo ${i + 1} of ${SLIDES.length}`}
            aria-current={i === index}
            // A 28px target so the dots stay tappable on a phone even though
            // the visible dot is small.
            className="grid h-7 w-7 place-items-center"
          >
            <span
              className={`block h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-emerald-600" : "w-1.5 bg-emerald-700/30"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function remember(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // storage is optional
  }
}

/**
 * First-visit invitation to join the waiting list for the Dootha Care device.
 *
 * The device is not on sale yet, so this collects interest rather than an
 * order: name and mobile number are required, email and delivery area are
 * optional, and signing in is offered but never required.
 */
export default function DoothaWaitlistPopup() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details>(EMPTY);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!shouldOffer()) return;
    const timer = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Prefill from the shared contact details, then from the signed-in profile.
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(CONTACT_STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved) as Partial<Details>;
        if (s.name || s.phone) {
          setDetails((prev) => ({
            ...prev,
            name: prev.name || s.name || "",
            phone: prev.phone || s.phone || "",
            address: prev.address || s.address || "",
          }));
        }
      }
    } catch {
      // ignore unreadable storage
    }
    if (!isAuthenticated) return;
    void (async () => {
      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) return;
        const me = await res.json();
        const address = [me.address?.line, me.address?.city, me.address?.pincode]
          .filter(Boolean)
          .join(", ");
        setDetails((prev) => ({
          name: prev.name || me.name || "",
          phone:
            prev.phone ||
            String(me.phone || "")
              .replace(/\D/g, "")
              .slice(-10),
          email: prev.email || me.email || "",
          address: prev.address || address,
        }));
      } catch {
        // prefill is best-effort
      }
    })();
  }, [open, isAuthenticated]);

  const close = useCallback(() => {
    if (!joined) remember(DISMISSED_KEY);
    setOpen(false);
  }, [joined]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, submitting, close]);

  const update = (key: keyof Details, value: string) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate(details);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let res: Response;
      try {
        res = await apiFetch("/dootha-waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: details.name.trim(),
            phone: details.phone,
            email: details.email.trim(),
            address: details.address.trim(),
            source: "homepage_popup",
            website,
          }),
        });
      } catch {
        throw new UserFacingError("No connection. Please check your internet and try again.");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("Waitlist signup failed:", res.status, body);
        throw new UserFacingError("Couldn't add you to the list. Please try again.");
      }
      remember(JOINED_KEY);
      try {
        const saved = localStorage.getItem(CONTACT_STORAGE_KEY);
        const existing = saved ? (JSON.parse(saved) as Record<string, unknown>) : {};
        localStorage.setItem(
          CONTACT_STORAGE_KEY,
          JSON.stringify({ ...existing, name: details.name.trim(), phone: details.phone })
        );
      } catch {
        // storage is optional
      }
      setJoined(true);
    } catch (err) {
      setError(userMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dootha-waitlist-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) close();
      }}
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white sm:max-w-md sm:rounded-2xl">
        <div className="relative shrink-0">
          <DeviceSlider />
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label="Close"
            className="absolute top-2.5 right-2.5 rounded-full bg-white/90 p-1.5 text-gray-600 transition hover:bg-white hover:text-gray-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {joined ? (
          <div className="overflow-y-auto px-5 py-5">
            <h2
              id="dootha-waitlist-title"
              className="flex items-center gap-2 text-lg font-semibold text-green-900"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              You&apos;re on the list
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              We&apos;ll call or message you on {details.phone} when Dootha Care is
              ready, before it goes on general sale.
            </p>

            {!isAuthenticated && (
              <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                Create an account to track orders and save plants to a wishlist.{" "}
                <Link
                  href="/signup"
                  className="font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                  onClick={() => setOpen(false)}
                >
                  Sign up
                </Link>
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <Link
                href="/shop"
                prefetch={false}
                onClick={() => setOpen(false)}
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Browse plants
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
            <div className="overflow-y-auto px-5 pt-4 pb-1">
              <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700 uppercase">
                Coming soon
              </p>
              <h2
                id="dootha-waitlist-title"
                className="mt-1.5 font-space text-xl font-bold text-green-900"
              >
                Join the Dootha Care waiting list
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                A planter that watches your plant for you — moisture, light and
                health on a little screen, with reminders when it needs water.
                Leave your details and we&apos;ll tell you the moment it&apos;s
                available.
              </p>

              <div className="mt-4 space-y-3">
                <FormField
                  size="sm"
                  label="Name"
                  autoComplete="name"
                  value={details.name}
                  onChange={(e) => update("name", e.target.value)}
                  maxLength={100}
                />
                <FormField
                  size="sm"
                  label="Mobile number"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={details.phone}
                  onChange={(e) =>
                    update("phone", e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder="10-digit number"
                  maxLength={10}
                  hint="We'll message you when it launches"
                />
                <FormField
                  size="sm"
                  label="Email (optional)"
                  type="email"
                  autoComplete="email"
                  value={details.email}
                  onChange={(e) => update("email", e.target.value)}
                  maxLength={160}
                />
                <FormTextarea
                  size="sm"
                  label="Delivery area (optional)"
                  rows={2}
                  autoComplete="street-address"
                  value={details.address}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder="City and pincode are enough"
                  maxLength={300}
                />
              </div>

              <div
                aria-hidden="true"
                className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
              >
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {error ? (
                <p role="alert" className="mt-3 text-sm text-green-950/55">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="border-t border-gray-100 px-5 py-3">
              <Button
                type="submit"
                variant="solid-sm"
                loading={submitting}
                loadingText="Adding you…"
              >
                Join the waiting list
              </Button>
              <p className="mt-2 text-center text-xs text-gray-500">
                {isAuthenticated ? (
                  <>No payment now — we only get in touch at launch.</>
                ) : (
                  <>
                    Already have an account?{" "}
                    <Link
                      href="/login"
                      className="font-medium text-emerald-700 hover:underline"
                      onClick={() => setOpen(false)}
                    >
                      Log in
                    </Link>{" "}
                    to fill this in for you.
                  </>
                )}
              </p>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
