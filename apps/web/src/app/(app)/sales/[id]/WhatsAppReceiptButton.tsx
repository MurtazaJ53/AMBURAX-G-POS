"use client";

import { useState } from "react";
import { MessageCircle, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

interface WhatsAppReceiptButtonProps {
  customerPhone?: string | null;
  customerName?: string | null;
  billNumber: string;
  totalMinor: number;
  storeName: string;
  saleId?: string;
  variant?: "badge" | "action-tile";
  className?: string;
}

export function WhatsAppReceiptButton({
  customerPhone,
  customerName,
  billNumber,
  totalMinor,
  storeName,
  saleId,
  variant = "badge",
  className = "",
}: WhatsAppReceiptButtonProps) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [sent, setSent] = useState(false);

  const cleanPhone = phone.replace(/\D/g, "");
  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  const billUrl = typeof window !== "undefined"
    ? (saleId ? `${window.location.origin}/sales/${saleId}` : window.location.href)
    : "";

  const messageText = `Namaste ${customerName || "Customer"}, thank you for shopping at ${storeName}! Your digital bill #${billNumber} for ${formatMinor(totalMinor)} is confirmed. View details: ${billUrl}`;

  const waLink = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(messageText)}`;

  return (
    <>
      {variant === "action-tile" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="success-share-whatsapp"
          className={`inline-flex h-[52px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-800 transition-colors hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${className}`}
        >
          <MessageCircle className="h-5 w-5 text-emerald-600" />
          Share via WhatsApp
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`amb-press inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-100 ${className}`}
        >
          <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
          WhatsApp Bill
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Send WhatsApp E-Receipt</h3>
                  <p className="text-[11px] text-slate-500">Instant digital bill copy</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Customer Mobile Number
                </label>
                <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                  <span className="bg-slate-100 px-2.5 py-2 text-slate-500 font-mono text-xs">+91</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9876543210"
                    className="flex-1 px-2.5 py-2 text-xs font-mono outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 leading-relaxed border border-slate-100">
                <span className="font-bold text-slate-800 block mb-1">Preview Message:</span>
                &quot;{messageText}&quot;
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <a
                href={cleanPhone.length >= 10 ? waLink : undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (cleanPhone.length >= 10) {
                    setSent(true);
                    setTimeout(() => setOpen(false), 1200);
                  }
                }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold text-white shadow-sm transition-all ${
                  cleanPhone.length >= 10
                    ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                    : "bg-slate-300 cursor-not-allowed opacity-60"
                }`}
              >
                <Send className="h-3.5 w-3.5" />
                {sent ? "Opening WhatsApp..." : "Send E-Receipt"}
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
