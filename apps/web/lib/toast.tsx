"use client";

import { useState, useEffect } from "react";
import { CheckCircle, X } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
}

let toastIdCounter = 0;
const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

function notify() {
  listeners.forEach((listener) => listener([...toasts]));
}

export function toast(message: string, type: "success" | "error" | "info" = "success") {
  const id = `toast-${++toastIdCounter}`;
  toasts.push({ id, message, type });
  notify();

  // Auto remove after 3 seconds
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 3000);
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
    <div className="fixed top-4 right-4 z-[9999] space-y-2">
      {toastList.map((toast) => (
        <div
          key={toast.id}
          className={`
            flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg
            min-w-[300px] max-w-md animate-slideInRight
            ${
              toast.type === "success"
                ? "bg-emerald-500 text-white"
                : toast.type === "error"
                ? "bg-red-500 text-white"
                : "bg-blue-500 text-white"
            }
          `}
        >
          {toast.type === "success" && <CheckCircle className="w-5 h-5 shrink-0" />}
          <p className="flex-1 text-sm font-medium">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 hover:opacity-80 transition-opacity"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

