"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { apiFetch } from "../../lib/api";
import Link from "next/link";
import Image from "next/image";
import MarkdownRenderer from "./MarkdownRenderer";

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
}

const STORAGE_KEY_MESSAGES = "plant-chatbot-messages";
const STORAGE_KEY_IS_OPEN = "plant-chatbot-is-open";

const DEFAULT_MESSAGE: Message = {
  id: "1",
  role: "dootha",
  content: "Hello! I'm your plant care dootha. I can help you with plant care tips, growing advice, and recommend products from our store. What would you like to know?",
};

export default function PlantChatbot() {
  // Initialize with consistent values for SSR (always false, always default message)
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([DEFAULT_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load from localStorage only after component mounts (client-side only)
  useEffect(() => {
    setIsMounted(true);

    // Load isOpen state
    const savedIsOpen = localStorage.getItem(STORAGE_KEY_IS_OPEN);
    if (savedIsOpen === "true") {
      setIsOpen(true);
    }

    // Load messages
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

  // Save messages to localStorage whenever they change (but not during initial load)
  useEffect(() => {
    if (isMounted && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    }
  }, [messages, isMounted]);

  // Save isOpen state to localStorage (but not during initial load)
  useEffect(() => {
    if (isMounted && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY_IS_OPEN, isOpen.toString());
    }
  }, [isOpen, isMounted]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          conversationHistory: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        // Try to get error message from response
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

      const doothaMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "dootha",
        content: data.response || "I'm sorry, I couldn't process that request.",
        products: data.recommendedProducts || [],
      };

      setMessages((prev) => [...prev, doothaMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "dootha",
        content: error instanceof Error && error.message
          ? `I'm sorry, I encountered an error: ${error.message}. Please check your API key configuration or try again later.`
          : "I'm sorry, I encountered an error. Please try again later.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full p-3 sm:p-4 shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center group"
        aria-label="Open chat"
      >
        {isOpen ? (
          <X className="h-5 w-5 sm:h-6 sm:w-6" />
        ) : (
          <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6 group-hover:scale-110 transition-transform" />
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed inset-0 sm:inset-auto sm:bottom-24 sm:right-6 sm:z-50 sm:w-96 sm:max-w-[calc(100vw-3rem)] sm:h-[600px] sm:max-h-[calc(100vh-8rem)] sm:rounded-lg z-50 bg-white shadow-2xl flex flex-col border-0 sm:border sm:border-emerald-100">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-green-600 text-white p-3 sm:p-4 sm:rounded-t-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image src="/dootha.svg" alt="Dootha AI" width={24} height={24} className="sm:w-[30px] sm:h-[30px]" />
              <h3 className="font-semibold text-sm sm:text-base">Dootha AI</h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="hover:bg-white/20 rounded-full p-1 transition-colors"
              aria-label="Close chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 bg-gradient-to-b from-green-50/50 to-white">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-gray-800 border border-emerald-100 shadow-sm"
                  }`}
                >
                  {message.role === "dootha" ? (
                    <MarkdownRenderer content={message.content} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}

                  {/* Product Recommendations */}
                  {message.products && message.products.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-emerald-200">
                      <p className="text-xs font-semibold mb-2 text-emerald-700">
                        Recommended Products:
                      </p>
                      <div className="space-y-2">
                        {message.products.map((product) => (
                          <Link
                            key={product.id}
                            href={`/product/${product.slug}`}
                            className="block p-2 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors"
                            onClick={() => setIsOpen(false)}
                          >
                            <div className="flex items-center gap-2">
                              {product.imageUrl && (
                                <img
                                  src={product.imageUrl}
                                  alt={product.name}
                                  className="w-10 h-10 object-cover rounded"
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">
                                  {product.name}
                                </p>
                                <p className="text-xs text-emerald-600 font-semibold">
                                  ₹{product.price}
                                </p>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-emerald-100 rounded-lg px-4 py-2 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 sm:p-4 border-t border-emerald-100 bg-white sm:rounded-b-lg">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about plants..."
                className="flex-1 px-3 py-2 sm:px-4 border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 sm:px-4 transition-colors flex-shrink-0"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 sm:h-5 sm:w-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center hidden sm:block">
              Ask me anything about plants! 🌱
            </p>
          </div>
        </div>
      )}
    </>
  );
}
