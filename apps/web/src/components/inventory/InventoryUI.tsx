export type Status = "In Stock" | "Low Stock" | "Out of Stock" | "Negative";

export function StatusPill({ status }: { status: Status }) {
  let style = "bg-slate-100 text-slate-700 border-slate-300";
  if (status === "In Stock") style = "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "Low Stock") style = "bg-amber-50 text-amber-800 border-amber-200";
  if (status === "Out of Stock" || status === "Negative") style = "bg-red-50 text-red-800 border-red-200";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap h-5 px-1.5 rounded-[3px] border text-[10px] uppercase font-bold tracking-tight font-mono ${style}`}
    >
      {status}
    </span>
  );
}
