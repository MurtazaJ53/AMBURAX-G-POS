"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, FileUp, Sparkles, Users, Package, Receipt } from "lucide-react";
import { parseCsv, csvCell } from "@/lib/csv";
import { parseImportFile } from "@/lib/importParser";
import { IMPORT_FIELDS, autoMapColumns, type ImportKind } from "@/server/imports/importFields";
import { buttonClass, Card, CardHeader } from "../../_components/ui";

/**
 * Moving in from another software. Pick what to bring over, upload its CSV, Excel (.xlsx, .xls),
 * or JSON export, check which column is which (matched automatically by name — or by AI with
 * "Smart match"), preview, import.
 * Rows go in batches of 200; every row that couldn't be imported is listed and downloadable, and
 * running the same file again skips what is already here.
 */

const KINDS: { kind: ImportKind; title: string; hint: string; icon: typeof Users }[] = [
  { kind: "customers", title: "Customers", hint: "Names, mobiles, email, GSTIN", icon: Users },
  { kind: "products", title: "Products & stock", hint: "Items, sizes, prices, GST, cost, opening stock", icon: Package },
  { kind: "sales", title: "Past sales", hint: "Old bills, kept as history only", icon: Receipt },
];

const BATCH = 200;

type Outcome = { created: number; skipped: number; errors: { row: number; reason: string }[] };

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportClient({ aiOn }: { aiOn: boolean }) {
  const [kind, setKind] = useState<ImportKind>("products");
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [smartBusy, setSmartBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const fields = IMPORT_FIELDS[kind];
  const headers = useMemo(() => table[0] ?? [], [table]);
  const body = useMemo(() => table.slice(1), [table]);
  const missing = fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0);

  const mapped = useMemo(
    () => body.map((r) => Object.fromEntries(fields.map((f) => [f.key, (mapping[f.key] ?? -1) >= 0 ? (r[mapping[f.key]!] ?? "") : undefined]))),
    [body, fields, mapping],
  );

  function reset(k: ImportKind) {
    setKind(k);
    setTable([]);
    setFileName(null);
    setMapping({});
    setResult(null);
    setNote(null);
  }

  async function load(file: File) {
    setResult(null);
    setNote(null);
    if (!/\.(csv|xlsx|xls|json|txt|tsv)$/i.test(file.name)) {
      setNote("Upload a CSV, Excel (.xlsx, .xls) or JSON file.");
      return;
    }
    try {
      const parsed = await parseImportFile(file);
      const rows = parsed.rows;
      if (rows.length < 2) {
        setNote("That file has no rows under its header or records.");
        return;
      }
      setFileName(file.name);
      setTable(rows);
      setMapping(autoMapColumns(kind, rows[0]!));
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't read that file. Check the format.");
    }
  }

  async function smartMatch() {
    setSmartBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/v1/imports/map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, headers, sample: body.slice(0, 5) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data?.error?.message ?? "Smart matching didn't work.");
      else {
        const found = Object.entries(data.mapping as Record<string, number>).filter(([, v]) => v >= 0);
        setMapping((m) => ({ ...m, ...Object.fromEntries(found) }));
        setNote("Columns matched by AI. Check them before importing.");
      }
    } catch {
      setNote("No connection. Try again.");
    } finally {
      setSmartBusy(false);
    }
  }

  async function run() {
    const batchId = crypto.randomUUID();
    const total: Outcome = { created: 0, skipped: 0, errors: [] };
    setRunning({ done: 0, total: mapped.length });
    for (let i = 0; i < mapped.length; i += BATCH) {
      const rows = mapped.slice(i, i + BATCH);
      try {
        const res = await fetch(`/api/v1/imports/${kind}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId, firstRowNumber: i + 2, rows }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          total.errors.push({ row: i + 2, reason: `Rows ${i + 2}–${i + 1 + rows.length}: ${data?.error?.message ?? "batch failed"}` });
        } else {
          total.created += data.created;
          total.skipped += data.skipped;
          total.errors.push(...data.errors);
        }
      } catch {
        total.errors.push({ row: i + 2, reason: `Rows ${i + 2}–${i + 1 + rows.length}: no connection` });
      }
      setRunning({ done: Math.min(i + BATCH, mapped.length), total: mapped.length });
    }
    setRunning(null);
    setResult(total);
  }

  const template = () =>
    downloadText(
      `amburax-${kind}-template.csv`,
      [fields.map((f) => csvCell(f.label)).join(","), fields.map((f) => csvCell(f.example)).join(",")].join("\n"),
    );

  const shownFields = fields.filter((f) => (mapping[f.key] ?? -1) >= 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => reset(k.kind)}
            aria-pressed={kind === k.kind}
            className={`amb-press flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
              kind === k.kind ? "border-sky-600 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <k.icon aria-hidden="true" className="mt-0.5 h-5 w-5 text-sky-700" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">{k.title}</span>
              <span className="block text-xs text-slate-500">{k.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={`1. Upload your ${KINDS.find((k) => k.kind === kind)!.title.toLowerCase()} file`}
          subtitle="Export from your old software as Excel (.xlsx, .xls), CSV, or JSON (Tally, Vyapar, Marg, Busy, Zoho, etc.). We analyze and match columns for you."
        />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.xls,.json,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/json"
            className="sr-only"
            aria-label="File to import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={() => input.current?.click()} className={`${buttonClass("primary")} amb-press`}>
            <FileUp aria-hidden="true" className="h-4 w-4" />
            {fileName ? "Choose another file" : "Choose Excel / CSV / JSON file"}
          </button>
          <button type="button" onClick={template} className={buttonClass("secondary")}>
            <Download aria-hidden="true" className="h-4 w-4" />
            Download CSV template
          </button>
          {fileName && (
            <span className="text-sm font-medium text-slate-800">
              {fileName} · {body.length.toLocaleString("en-IN")} rows analyzed
            </span>
          )}
        </div>
        {kind === "sales" && (
          <p className="mx-5 mb-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Past bills are kept as history (customer history and old totals). They don&apos;t change stock, aren&apos;t counted as today&apos;s
            sales and aren&apos;t sent to Backend. Bring your current stock in with “Products &amp; stock”.
          </p>
        )}
      </Card>

      {note && (
        <p role="status" className="amb-pop-in rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {note}
        </p>
      )}

      {table.length > 1 && (
        <Card className="amb-fade-in">
          <CardHeader title="2. Check which column is which" subtitle="Matched by column name. Change any that are wrong." />
          <div className="px-5 pb-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-100 bg-violet-50/60 p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-950">
                  <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-600" />
                  Smart Column Matching
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {aiOn
                    ? "Let your AI key inspect headers and sample values to map columns automatically."
                    : "Add your Anthropic API key in Settings → General (AI card) to enable one-click smart matching."}
                </p>
              </div>
              {aiOn ? (
                <button
                  type="button"
                  disabled={smartBusy}
                  onClick={() => void smartMatch()}
                  className={`${buttonClass("primary")} amb-press text-xs`}
                >
                  <Sparkles aria-hidden="true" className={`h-4 w-4 ${smartBusy ? "animate-spin" : ""}`} />
                  {smartBusy ? "Matching with AI…" : "Smart match with AI"}
                </button>
              ) : (
                <Link href="/settings" className={`${buttonClass("secondary")} text-xs`}>
                  Set up AI key
                </Link>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <label key={f.key} className="text-sm font-medium text-slate-700">
                  {f.label}
                  {f.required && <span className="text-rose-600"> *</span>}
                  <select
                    value={mapping[f.key] ?? -1}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                    className={`amb-focus mt-1 block min-h-11 w-full rounded-lg border px-3 text-sm ${
                      f.required && (mapping[f.key] ?? -1) < 0 ? "border-rose-400 bg-rose-50" : "border-slate-300 bg-white"
                    }`}
                  >
                    <option value={-1}>— not in file —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                        {body[0]?.[i] ? `  (e.g. ${body[0][i]!.slice(0, 24)})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 py-4">
            <p className="mb-2 text-sm font-semibold text-slate-900">3. Preview (first 5 rows)</p>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    {shownFields.map((f) => (
                      <th key={f.key} className="py-1.5 pr-3 font-semibold">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapped.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {shownFields.map((f) => (
                        <td key={f.key} className="max-w-[180px] truncate py-1.5 pr-3 text-slate-800">
                          {r[f.key] || <span className="text-slate-400">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
            <p className="text-sm text-slate-600">
              {missing.length > 0
                ? `Choose a column for: ${missing.map((f) => f.label).join(", ")}.`
                : `Ready to import ${body.length.toLocaleString("en-IN")} rows. Rows already here are skipped.`}
            </p>
            <button
              type="button"
              disabled={missing.length > 0 || running !== null}
              onClick={() => void run()}
              className={`${buttonClass("primary")} amb-press`}
            >
              {running ? `Importing… ${running.done.toLocaleString("en-IN")} / ${running.total.toLocaleString("en-IN")}` : "Import now"}
            </button>
          </div>
          {running && (
            <div className="mx-5 mb-4 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full bg-sky-600 transition-[width] duration-300" style={{ width: `${(running.done / running.total) * 100}%` }} />
            </div>
          )}
        </Card>
      )}

      {result && (
        <Card className="amb-pop-in">
          <CardHeader
            title="Import finished"
            subtitle={`${result.created.toLocaleString("en-IN")} added · ${result.skipped.toLocaleString("en-IN")} already here (skipped) · ${result.errors.length.toLocaleString("en-IN")} couldn't be imported`}
          />
          {result.errors.length > 0 && (
            <div className="space-y-3 px-5 pb-5">
              <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
                {result.errors.slice(0, 100).map((e, i) => (
                  <li key={i} className="text-rose-700">
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  downloadText(`amburax-${kind}-import-problems.csv`, ["Row,Problem", ...result.errors.map((e) => `${e.row},${csvCell(e.reason)}`)].join("\n"))
                }
                className={buttonClass("secondary")}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Download the list
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
