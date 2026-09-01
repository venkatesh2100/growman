"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
}

let toastIdCounter = 0;
const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];
let lastToastKey = "";
let lastToastAt = 0;

function notify() {
  listeners.forEach((listener) => listener([...toasts]));
}

export function toast(
  message: string,
  type: "success" | "error" | "info" = "success"
) {
  const now = Date.now();
  const key = `${type}:${message}`;
  // Ignore duplicate toasts fired within a short window (e.g. throw + catch).
  if (key === lastToastKey && now - lastToastAt < 1500) {
    return;
  }
  lastToastKey = key;
  lastToastAt = now;

  const id = `toast-${++toastIdCounter}`;
  toasts.push({ id, message, type });
  notify();

  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 3200);
}

export function useToast() {
  const [toastList, setToastList] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => {
      setToastList(newToasts);
    };
    listeners.push(listener);
    setToastList([...toasts]);

    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return toastList;
}

export function ToastContainer() {
  const toastList = useToast();

  if (toastList.length === 0) return null;

  const removeToast = (id: string) => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[9999] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:bottom-auto sm:top-6 sm:items-end">
      {toastList.map((item) => (
        <div
          key={item.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-emerald-900/8 bg-white/95 px-4 py-3 shadow-[0_8px_30px_rgba(6,78,59,0.08)] backdrop-blur-md animate-slideInRight"
        >
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              item.type === "error"
                ? "bg-stone-400"
                : item.type === "info"
                  ? "bg-emerald-400"
                  : "bg-emerald-600"
            }`}
            aria-hidden
          />
          <p className="flex-1 text-sm leading-snug text-green-950/80">
            {item.message}
          </p>
          <button
            type="button"
            onClick={() => removeToast(item.id)}
            className="shrink-0 rounded-lg p-0.5 text-green-950/30 transition-colors hover:text-green-950/60"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
