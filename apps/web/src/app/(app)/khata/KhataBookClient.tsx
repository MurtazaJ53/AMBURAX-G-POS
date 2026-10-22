"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarRange,
  Check,
  CheckCircle2,
  HandCoins,
  MessageCircle,
  Phone,
  Printer,
  Search,
  X,
} from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatPhone } from "@/lib/customerFields";
import type { KhataCustomer, KhataStatus } from "@/server/khata/khataBook";

const STATUS: Record<KhataStatus, { label: string; tone: string }> = {
  OVERDUE: { label: "Overdue", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  DUE_SOON: { label: "Due soon", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  ON_TRACK: { label: "On track", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A WhatsApp link with a polite reminder, or null when there is no number to send it to. */
function reminderLink(
  c: { name: string; phone: string | null; dueMinor: number },
  storeName: string
): string | null {
  if (!c.phone) return null;
  const digits = c.phone.replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  const text = `Namaste ${c.name}, this is a gentle reminder from ${storeName}: your pending khata balance is ${formatMinor(
    c.dueMinor
  )}. Please clear it at your convenience. Thank you!`;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

interface SettlementSuccessData {
  customerName: string;
  customerPhone: string | null;
  amountMinor: number;
  remainingMinor: number;
  paymentMethod: string;
  reference?: string | null;
  allocations?: { billNumber: string; amountMinor: number }[];
}

/**
 * Customers who owe, the selected customer's khata ledger, collecting a payment, and instant digital receipt.
 */
export function KhataBookClient({
  customers,
  storeName,
}: {
  customers: KhataCustomer[];
  storeName: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | KhataStatus>("");
  const [selectedId, setSelectedId] = useState<string | null>(customers[0]?.id ?? null);
  const [collecting, setCollecting] = useState<KhataCustomer | null>(null);
  const [settlementSuccess, setSettlementSuccess] = useState<SettlementSuccessData | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return customers.filter(
      (c) =>
        (!status || c.status === status) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (digits.length > 2 && (c.phone ?? "").includes(digits.slice(-10))))
    );
  }, [customers, query, status]);

  const selected = customers.find((c) => c.id === selectedId) ?? null;
  const selectedReminder = selected ? reminderLink(selected, storeName) : null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Customers with due ------------------------------------------------------------- */}
      <section
        id="dues"
        aria-labelledby="khata-due-list"
        className="cust-rise min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        style={{ ["--i" as string]: 7 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3.5">
          <h2 id="khata-due-list" className="text-[16px] font-bold text-slate-900">
            Customers with Due{" "}
            <span className="text-[13px] font-medium text-slate-500">({customers.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="khata-status">
              Status
            </label>
            <select
              id="khata-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | KhataStatus)}
              className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-sky-500"
            >
              <option value="">All statuses</option>
              <option value="OVERDUE">Overdue</option>
              <option value="DUE_SOON">Due soon</option>
              <option value="ON_TRACK">On track</option>
            </select>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search customers with due"
                placeholder="Search name or mobile…"
                className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              />
            </div>
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-primary"
            >
              <BookOpen className="h-6 w-6" />
            </span>
            <p className="text-[14px] font-medium text-slate-900">Khata is completely clear</p>
            <p className="max-w-xs text-[12px] text-slate-500">
              No customer has an outstanding balance right now.
            </p>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-y border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Customer
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Mobile
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Due amount
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Due date
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Pending
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const isSelected = c.id === selectedId;
                  const wa = reminderLink(c, storeName);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`cursor-pointer border-b border-slate-100 transition-colors ${
                        isSelected ? "bg-sky-50/60" : "hover:bg-slate-50/60"
                      }`}
                    >
                      <td className="px-3 py-2.5 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600"
                          >
                            {initials(c.name)}
                          </span>
                          <span className="truncate">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-slate-600">
                        {c.phone ? formatPhone(c.phone) : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-right font-bold tabular-nums text-slate-900">
                        {formatMinor(c.dueMinor)}
                      </td>
                      <td className="px-2 py-2.5 text-slate-600">
                        {c.dueDate ? dateFmt.format(new Date(c.dueDate)) : "—"}
                      </td>
                      <td
                        className={`px-2 py-2.5 tabular-nums ${
                          c.status === "OVERDUE" ? "font-semibold text-rose-600" : "text-slate-600"
                        }`}
                      >
                        {c.daysPending} day{c.daysPending === 1 ? "" : "s"}
                      </td>
                      <td className="px-2 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                            STATUS[c.status].tone
                          }`}
                        >
                          {STATUS[c.status].label}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollecting(c);
                            }}
                            aria-label={`Collect payment from ${c.name}`}
                            className="amb-press inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-[12px] font-semibold text-sky-800 transition-colors hover:bg-sky-100"
                          >
                            <HandCoins aria-hidden="true" className="h-3.5 w-3.5" /> Collect
                          </button>
                          {wa ? (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Send ${c.name} a WhatsApp reminder`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            >
                              <MessageCircle aria-hidden="true" className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[12.5px] text-slate-500">
                      No customer matches these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Customer khata details ------------------------------------------------------------ */}
      <section
        aria-labelledby="khata-details"
        className="cust-rise min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        style={{ ["--i" as string]: 8 }}
      >
        <h2 id="khata-details" className="px-4 pb-2 pt-3.5 text-[16px] font-bold text-slate-900">
          Customer Khata Details
        </h2>
        {!selected ? (
          <div className="flex flex-col items-center px-4 pb-6 pt-2 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"
            >
              <CalendarRange className="h-6 w-6" />
            </span>
            <p className="mt-3 text-[13px] font-medium text-slate-600">No khata selected</p>
            <p className="mt-1 text-[11.5px] text-slate-400">
              Pick a customer to see every udhar and payment.
            </p>
          </div>
        ) : (
          <div key={selected.id} className="amb-fade-in px-4 pb-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[14px] font-bold text-sky-700"
              >
                {initials(selected.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold text-slate-900">{selected.name}</p>
                <p className="flex items-center gap-1 text-[12px] tabular-nums text-slate-500">
                  <Phone aria-hidden="true" className="h-3 w-3" />{" "}
                  {selected.phone ? formatPhone(selected.phone) : "No mobile number"}
                </p>
                <p className="text-[11.5px] text-slate-400">
                  Khata since {dateFmt.format(new Date(selected.firstUdharAt))}
                </p>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
              <div>
                <dt className="text-[11px] text-slate-400 font-medium">Total Due</dt>
                <dd className="text-[14px] font-bold tabular-nums text-slate-900">
                  {formatMinor(selected.dueMinor)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-400 font-medium">Due by</dt>
                <dd
                  className={`text-[13px] font-semibold ${
                    selected.status === "OVERDUE" ? "text-rose-600" : "text-slate-900"
                  }`}
                >
                  {selected.dueDate ? dateFmt.format(new Date(selected.dueDate)) : "No agreed terms"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-400 font-medium">Udhar limit</dt>
                <dd className="text-[13px] font-semibold tabular-nums text-slate-900">
                  {selected.creditLimitMinor !== null
                    ? formatMinor(selected.creditLimitMinor)
                    : "No limit"}
                </dd>
              </div>
            </dl>

            <h3 className="mt-3 text-[12.5px] font-semibold text-slate-700">Khata history</h3>
            <div className="mt-1 max-h-64 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[11px] text-slate-400">
                    <th scope="col" className="py-1.5 font-medium">
                      Date
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Particulars
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.entries.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-500">
                        {dateFmt.format(new Date(e.at))}
                      </td>
                      <td className="py-1.5 pr-2">
                        {e.saleId ? (
                          <Link
                            href={`/sales/${e.saleId}`}
                            className="text-primary hover:underline"
                          >
                            {e.label}
                          </Link>
                        ) : (
                          <span className="text-slate-800">{e.label}</span>
                        )}
                      </td>
                      <td
                        className={`py-1.5 text-right font-semibold tabular-nums ${
                          e.amountMinor > 0 ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {e.amountMinor > 0 ? "+" : "−"}
                        {formatMinor(Math.abs(e.amountMinor))}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-900">
                        {formatMinor(e.balanceMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setCollecting(selected)}
                className="amb-press inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                <HandCoins aria-hidden="true" className="h-4 w-4" /> Collect payment
              </button>
              {selectedReminder && (
                <a
                  href={selectedReminder}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle aria-hidden="true" className="h-4 w-4" /> Remind
                </a>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Collect Modal */}
      {collecting && (
        <CollectDialog
          customer={collecting}
          storeName={storeName}
          onClose={() => setCollecting(null)}
          onSuccess={(data) => {
            setCollecting(null);
            setSettlementSuccess(data);
            setToast(`${formatMinor(data.amountMinor)} collected from ${data.customerName}.`);
            router.refresh();
          }}
        />
      )}

      {/* Settlement Success & WhatsApp Receipt Modal */}
      {settlementSuccess && (
        <SettlementSuccessModal
          data={settlementSuccess}
          storeName={storeName}
          onClose={() => setSettlementSuccess(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="amb-fade-in fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg"
        >
          <Check aria-hidden="true" className="mr-1.5 inline h-4 w-4 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
}

function CollectDialog({
  customer,
  storeName,
  onClose,
  onSuccess,
}: {
  customer: KhataCustomer;
  storeName: string;
  onClose: () => void;
  onSuccess: (data: SettlementSuccessData) => void;
}) {
  const [amountRaw, setAmountRaw] = useState(
    (customer.dueMinor / 100).toFixed(2).replace(/\.00$/, "")
  );
  const [method, setMethod] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const valid = /^\d{1,8}(\.\d{1,2})?$/.test(amountRaw.trim());
  const amountMinor = valid ? Math.round(Number.parseFloat(amountRaw) * 100) : 0;
  const problem = !valid
    ? "Enter an amount like 500 or 499.50."
    : amountMinor <= 0
    ? "Enter an amount greater than zero."
    : amountMinor > customer.dueMinor
    ? `${customer.name} owes ${formatMinor(customer.dueMinor)}. Collect that much or less.`
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || saving) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    if (!key.current) key.current = crypto.randomUUID();
    try {
      const res = await fetch("/api/v1/khata/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          amountMinor,
          paymentMethod: method,
          reference: reference.trim() || undefined,
          idempotencyKey: key.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "The payment could not be recorded.");
        return;
      }
      onSuccess({
        customerName: customer.name,
        customerPhone: customer.phone,
        amountMinor,
        remainingMinor: data.remainingMinor ?? customer.dueMinor - amountMinor,
        paymentMethod: method,
        reference: reference.trim() || undefined,
        allocations: data.allocations,
      });
    } catch {
      setError("No connection. Try again — it will only be recorded once.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="cust-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="collect-title"
        className="pos-rise w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="collect-title" className="text-[17px] font-bold text-slate-900">
              Collect payment
            </h2>
            <p className="text-[12.5px] text-slate-500">
              {customer.name} owes{" "}
              <strong className="font-semibold text-slate-900">
                {formatMinor(customer.dueMinor)}
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="collect-amount"
              className="mb-1 block text-[12.5px] font-medium text-slate-700"
            >
              Amount received
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-500"
              >
                ₹
              </span>
              <input
                id="collect-amount"
                autoFocus
                inputMode="decimal"
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value.replace(/[^\d.]/g, ""))}
                aria-invalid={problem ? true : undefined}
                aria-describedby="collect-amount-help"
                className={`h-11 w-full rounded-lg border bg-white pl-7 pr-3 text-[16px] font-bold tabular-nums text-slate-900 outline-none focus:ring-4 ${
                  problem
                    ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/15"
                    : "border-slate-300 focus:border-sky-500 focus:ring-sky-500/15"
                }`}
              />
            </div>
            <p
              id="collect-amount-help"
              className={`mt-1 text-[11.5px] ${problem ? "text-rose-600" : "text-slate-500"}`}
            >
              {problem ??
                (amountMinor === customer.dueMinor
                  ? "Clears the full balance."
                  : `Leaves ${formatMinor(customer.dueMinor - amountMinor)} on khata.`)}
            </p>
            <div className="mt-1.5 flex gap-1.5">
              {[0.25, 0.5, 1].map((share) => (
                <button
                  key={share}
                  type="button"
                  onClick={() =>
                    setAmountRaw(
                      (Math.round(customer.dueMinor * share) / 100).toFixed(2).replace(/\.00$/, "")
                    )
                  }
                  className="h-7 flex-1 cursor-pointer rounded-md border border-slate-200 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {share === 1 ? "Full" : `${share * 100}%`}
                </button>
              ))}
            </div>
          </div>

          <fieldset>
            <legend className="mb-1 text-[12.5px] font-medium text-slate-700">Received by</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(["CASH", "UPI", "CARD"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={`h-9 cursor-pointer rounded-lg border text-[12.5px] font-semibold transition-colors ${
                    method === m
                      ? "border-primary bg-primary-subtle text-primary"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m === "CASH" ? "Cash" : m === "UPI" ? "UPI" : "Card"}
                </button>
              ))}
            </div>
          </fieldset>

          {method !== "CASH" && (
            <div className="amb-fade-in">
              <label
                htmlFor="collect-ref"
                className="mb-1 block text-[12.5px] font-medium text-slate-700"
              >
                Reference <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="collect-ref"
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "UPI" ? "UPI transaction ID" : "Card slip number"}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-[13px] outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="amb-press inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary text-[14px] font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <HandCoins aria-hidden="true" className="h-4 w-4" />
            {saving
              ? "Recording…"
              : `Record ${valid && amountMinor > 0 ? formatMinor(amountMinor) : "payment"}`}
          </button>
        </form>
      </div>
    </div>
  );
}

function SettlementSuccessModal({
  data,
  storeName,
  onClose,
}: {
  data: SettlementSuccessData;
  storeName: string;
  onClose: () => void;
}) {
  const digits = (data.customerPhone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  const receiptText = `*Payment Receipt — ${storeName}*\n\nNamaste ${
    data.customerName
  },\nWe have received payment of *${formatMinor(data.amountMinor)}* via ${
    data.paymentMethod
  }${data.reference ? ` (Ref: ${data.reference})` : ""}.\n\nYour remaining khata balance is *${formatMinor(
    data.remainingMinor
  )}*.\n\nThank you for your business!`;

  const waLink = to ? `https://wa.me/${to}?text=${encodeURIComponent(receiptText)}` : null;

  return (
    <div
      className="cust-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="pos-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-3">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h3 className="text-lg font-bold text-slate-900">Payment Collected</h3>
          <p className="text-xs text-slate-500 mt-0.5">Recorded and settled against FIFO bills</p>

          <div className="mt-4 w-full rounded-xl border border-slate-100 bg-slate-50 p-4 text-left space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Customer:</span>
              <span className="font-semibold text-slate-900">{data.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Amount Received:</span>
              <span className="font-bold text-emerald-700 text-sm">
                {formatMinor(data.amountMinor)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payment Method:</span>
              <span className="font-semibold text-slate-800">{data.paymentMethod}</span>
            </div>
            {data.reference && (
              <div className="flex justify-between">
                <span className="text-slate-500">Reference:</span>
                <span className="font-mono text-slate-800">{data.reference}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200/80 pt-2 font-medium">
              <span className="text-slate-500">Remaining Khata:</span>
              <span
                className={`font-bold ${
                  data.remainingMinor === 0 ? "text-emerald-600" : "text-amber-700"
                }`}
              >
                {formatMinor(data.remainingMinor)}
              </span>
            </div>
          </div>

          <div className="mt-5 flex w-full flex-col gap-2">
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="amb-press flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" /> Send WhatsApp Receipt
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-full items-center justify-center rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Done & Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
