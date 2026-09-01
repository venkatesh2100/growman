"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Camera, Package, Leaf } from "lucide-react";
import { apiFetch, getApiUrl, resolveAuthToken } from "../../lib/api";
import Link from "next/link";
import Image from "next/image";
import MarkdownRenderer from "./MarkdownRenderer";
import { toast } from "../../lib/toast";
import { useAuthStore } from "../../lib/store/authStore";

interface Message {
  id: string;
  role: "user" | "dootha";
  content: string;
  products?: Array<{
    id: number;
    name: string;
    slug: string;
    price: number;
    imageUrl?: string;
  }>;
  orders?: Array<{
    id: number;
    status: string;
    amount: number;
    createdAt: string;
    expectedDeliveryDate?: string;
    itemCount: number;
    itemPreview: string;
    imageUrl?: string;
  }>;
}

const STORAGE_KEY_MESSAGES = "plant-chatbot-messages";
const STORAGE_KEY_IS_OPEN = "plant-chatbot-is-open";

const DEFAULT_MESSAGE: Message = {
  id: "1",
  role: "dootha",
  content:
    "Hi! I'm **Dootha**, your Growman plant assistant. Ask about care, pests, light, or watering — I can suggest products from our store too.",
};

function orderStatusClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes("delivered")) return "bg-green-100 text-green-800";
  if (s.includes("ship") || s.includes("delivery")) return "bg-blue-100 text-blue-800";
  if (s.includes("pending")) return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function ThinkingIndicator() {
  return (
    <div className="mb-2 flex justify-start animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="flex max-w-[80%] items-center gap-3 rounded-2xl rounded-bl-md border border-emerald-100 bg-white px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-emerald-600"
              style={{
                animation: "chat-dot 0.84s ease-in-out infinite",
                animationDelay: `${i * 160}ms`,
              }}
            />
          ))}
        </div>
        <span className="text-sm text-gray-500 animate-pulse">Thinking</span>
      </div>
    </div>
  );
}

export default function PlantChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([DEFAULT_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    setIsMounted(true);

    const savedIsOpen = localStorage.getItem(STORAGE_KEY_IS_OPEN);
    if (savedIsOpen === "true") {
      setIsOpen(true);
    }

    const savedMessages = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      } catch (e) {
        console.error("Failed to parse saved messages:", e);
      }
    }
  }, []);

  useEffect(() => {
    if (isMounted && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    }
  }, [messages, isMounted]);

  useEffect(() => {
    if (isMounted && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY_IS_OPEN, isOpen.toString());
    }
  }, [isOpen, isMounted]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOpenFromNavbar = () => setIsOpen(true);
    const handlePrefillFromSearch = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      const message = customEvent.detail?.message?.trim();
      setIsOpen(true);
      if (message) {
        setInput(message);
      }
    };

    window.addEventListener("growman:open-chatbot", handleOpenFromNavbar);
    window.addEventListener("growman:chatbot-prefill", handlePrefillFromSearch as EventListener);

    return () => {
      window.removeEventListener("growman:open-chatbot", handleOpenFromNavbar);
      window.removeEventListener("growman:chatbot-prefill", handlePrefillFromSearch as EventListener);
    };
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    const priorMessages = messages;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const token = resolveAuthToken();
      const response = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          token: token ?? undefined,
          conversationHistory: priorMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        let errorText = "Failed to get response";
        try {
          const errorData = await response.text();
          if (errorData) {
            try {
              const errorJson = JSON.parse(errorData);
              errorText = errorJson.error || errorJson.message || errorText;
            } catch {
              errorText = errorData.substring(0, 100);
            }
          }
        } catch {
          errorText = `HTTP ${response.status}: ${response.statusText}`;
        }
        console.error("Chat API error:", errorText);
        throw new Error(errorText);
      }

      const data = await response.json();

      if (!data || !data.response) {
        console.error("Invalid response data:", data);
        throw new Error("Invalid response from server");
      }

      const rawOrders = Array.isArray(data.orders) ? data.orders : [];
      const orders = rawOrders.map((o: Record<string, unknown>) => ({
        id: Number(o.id),
        status: String(o.status ?? ""),
        amount: typeof o.amount === "number" ? o.amount : Number(o.amount ?? 0),
        createdAt: String(o.createdAt ?? o.created_at ?? ""),
        expectedDeliveryDate: (o.expectedDeliveryDate ?? o.expected_delivery_date) as
          | string
          | undefined,
        itemCount: Number(o.itemCount ?? o.item_count ?? 0),
        itemPreview: String(o.itemPreview ?? o.item_preview ?? ""),
        imageUrl: (o.imageUrl ?? o.image_url) as string | undefined,
      }));

      const doothaMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "dootha",
        content: data.response || "I'm sorry, I couldn't process that request.",
        products: data.recommendedProducts || [],
        orders: orders.length > 0 ? orders : undefined,
      };

      setMessages((prev) => [...prev, doothaMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      toast("Failed to get response. Please try again.", "error");
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "dootha",
        content: "I'm having trouble connecting. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const identifyPlantFromFile = async (file: File) => {
    setIsScanning(true);
    try {
      const apiUrl = getApiUrl();
      const url = `${apiUrl}/images/identify-plant`;
      const token = useAuthStore.getState().token || localStorage.getItem("token");
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch(url, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Plant identification failed");
      }

      const data = await response.json();
      const name =
        data?.bestMatch ||
        data?.results?.[0]?.species?.scientificName ||
        data?.results?.[0]?.species?.commonNames?.[0];

      if (name) {
        setInput(`What is ${name} and how do I care for it?`);
        toast("Plant identified! Edit the message and send.", "success");
      } else {
        toast("Could not identify plant. Try a clearer photo.", "error");
      }
    } catch (error) {
      console.error("Plant identification error:", error);
      toast("Identification failed. Please try again.", "error");
    } finally {
      setIsScanning(false);
    }
  };

  const onPickPlantImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await identifyPlantFromFile(file);
    event.target.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* FAB — matches mobile tab open affordance */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg transition-all duration-300 hover:bg-emerald-700 hover:shadow-xl sm:bottom-6 sm:right-6"
        aria-label={isOpen ? "Close chat" : "Open chat"}
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>

      {isOpen && (
        <>
          {/* Mobile backdrop like mobile modal dim */}
          <button
            type="button"
            aria-label="Close chat overlay"
            className="fixed inset-0 z-40 bg-black/45 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div
            className="
              fixed inset-x-0 bottom-0 z-50 flex h-[min(92dvh,720px)] flex-col overflow-hidden
              rounded-t-3xl border border-emerald-100 bg-white shadow-2xl
              sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:max-h-[calc(100vh-8rem)]
              sm:w-[24rem] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl
            "
            role="dialog"
            aria-label="Dootha plant assistant"
          >
            {/* Header — light canvas like mobile */}
            <div className="flex items-center justify-between border-b border-emerald-100 bg-[#F0F7F4] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 overflow-hidden rounded-xl">
                  <Image
                    src="/growman.png"
                    alt="Dootha"
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <h3 className="font-space text-lg font-semibold tracking-tight text-green-900">
                    Dootha
                  </h3>
                  <p className="text-xs text-gray-500">Growman plant assistant</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-xl p-2 text-green-900 transition-colors hover:bg-emerald-50"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages — canvasAlt */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-[#F9FAFB] p-4">
              {messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message.id}
                    className={`mb-1 flex flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3 ${
                        isUser
                          ? "rounded-br-md bg-emerald-700 text-white"
                          : "rounded-bl-md border border-emerald-100 bg-white text-gray-800"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap text-[15px] leading-5">{message.content}</p>
                      ) : (
                        <MarkdownRenderer content={message.content} />
                      )}
                    </div>

                    {!isUser && message.orders && message.orders.length > 0 && (
                      <div className="mt-2 w-full space-y-2 self-stretch">
                        {message.orders.map((order) => (
                          <Link
                            key={order.id}
                            href="/orders"
                            onClick={() => setIsOpen(false)}
                            className="flex overflow-hidden rounded-2xl border border-emerald-100 bg-white transition-opacity active:opacity-90"
                          >
                            <div className="relative h-[76px] w-[76px] shrink-0 bg-gray-100">
                              {order.imageUrl ? (
                                <img
                                  src={order.imageUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-emerald-50 text-emerald-600">
                                  <Package className="h-7 w-7" />
                                </div>
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-bold text-emerald-950">
                                  Order #{order.id}
                                </p>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${orderStatusClass(order.status)}`}
                                >
                                  {order.status}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-4 text-gray-600">
                                {order.itemPreview}
                              </p>
                              <p className="mt-1 text-xs font-bold text-emerald-600">
                                ₹{Math.round(order.amount)} · {order.createdAt}
                                {order.expectedDeliveryDate
                                  ? ` · ETA ${order.expectedDeliveryDate}`
                                  : ""}
                              </p>
                            </div>
                          </Link>
                        ))}
                        <Link
                          href="/orders"
                          onClick={() => setIsOpen(false)}
                          className="block py-1 text-center text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                        >
                          View all orders →
                        </Link>
                      </div>
                    )}

                    {!isUser && message.products && message.products.length > 0 && (
                      <div className="mt-2 w-full self-stretch">
                        <p className="mb-2 text-xs font-semibold text-emerald-800">
                          Suggested for you
                        </p>
                        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
                          {message.products.map((product) => (
                            <Link
                              key={product.id}
                              href={`/product/${product.slug}`}
                              onClick={() => setIsOpen(false)}
                              className="h-[164px] w-[112px] shrink-0 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/80 transition-opacity active:opacity-90"
                            >
                              {product.imageUrl ? (
                                <img
                                  src={product.imageUrl}
                                  alt={product.name}
                                  className="h-[92px] w-full bg-gray-100 object-cover"
                                />
                              ) : (
                                <div className="flex h-[92px] items-center justify-center bg-emerald-100 text-emerald-600">
                                  <Leaf className="h-6 w-6" />
                                </div>
                              )}
                              <div className="flex flex-1 flex-col justify-center px-2 py-1.5">
                                <p className="line-clamp-2 text-[11px] font-semibold leading-[14px] text-emerald-950">
                                  {product.name}
                                </p>
                                <p className="mt-0.5 text-[11px] font-bold text-emerald-600">
                                  ₹{Math.round(product.price)}
                                </p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {isLoading ? <ThinkingIndicator /> : null}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer — matches mobile */}
            <div className="flex items-end gap-2 border-t border-emerald-100 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onPickPlantImage}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning || isLoading}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600/12 text-emerald-700 transition-colors hover:bg-emerald-600/20 disabled:opacity-50"
                aria-label="Scan plant"
                title="Scan plant"
              >
                {isScanning ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about plants or care…"
                rows={1}
                maxLength={500}
                disabled={isLoading}
                className="
                  max-h-[100px] min-h-[44px] flex-1 resize-none rounded-2xl
                  border border-emerald-100 bg-[#F9FAFB] px-4 py-3
                  text-[15px] text-gray-900 placeholder:text-gray-400
                  focus:border-emerald-300 focus:outline-none focus:ring-0
                "
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={`
                  flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors
                  ${
                    input.trim() && !isLoading
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-gray-200 text-gray-400"
                  }
                `}
                aria-label="Send message"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
