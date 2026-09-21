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

export function KpiCard({
  icon: Icon,
  label,
  value,
  note,
  muted,
}: {
  icon: any;
  label: string;
  value: string;
  note: string;
  muted?: boolean;
}) {
  return (
    <article className="flex flex-col justify-between min-h-[104px] p-3.5 border border-border rounded-md bg-background-card shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold text-primary">{label}</span>
        <span className="grid place-items-center h-[22px] w-[22px] rounded text-blue-600 bg-blue-50 shrink-0">
          <Icon size={14} />
        </span>
      </div>
      <div className={`mt-3 mb-1 ${muted ? 'text-[13px] text-secondary font-sans font-medium' : 'text-[23px] font-mono tracking-tight text-primary font-bold'}`}>
        {value}
      </div>
      <div className="text-[10px] text-secondary">
        {note}
      </div>
    </article>
  );
}
