export type Status = "In Stock" | "Low Stock" | "Out of Stock" | "Negative";

export function StatusPill({ status }: { status: Status }) {
  let style = "bg-slate-100 text-slate-700";
  if (status === "In Stock") style = "bg-green-100 text-green-700";
  if (status === "Low Stock") style = "bg-amber-100 text-amber-700";
  if (status === "Out of Stock") style = "bg-red-100 text-red-700";
  if (status === "Negative") style = "bg-red-200 text-red-900";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded px-2 py-1 text-[11px] font-semibold ${style}`}
    >
      {status}
    </span>
  );
}

export function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex min-w-[178px] flex-1 items-center gap-3 rounded-lg border border-border bg-background-card p-3 shadow-sm">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-secondary">{label}</p>
        <p className="text-xl font-bold text-primary">{value}</p>
      </div>
    </div>
  );
}
