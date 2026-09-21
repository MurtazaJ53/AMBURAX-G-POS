"use client";

import * as React from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";

export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = formData.get("q");
    if (q && typeof q === "string") {
      router.push("/products?q=" + encodeURIComponent(q));
      setOpen(false);
    }
  };

  return (
    <>
      <div className="relative hidden min-w-0 max-w-[420px] flex-1 md:block" onClick={() => setOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}>
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <div className="flex h-9 w-full items-center rounded-md border border-slate-200 bg-slate-50 pl-9 pr-10 text-[11px] text-slate-400 cursor-text transition hover:border-sky-400 hover:bg-white">
          Search by product name, SKU, barcode, customer...
        </div>
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] text-slate-400">
          ⌘ K
        </kbd>
      </div>

      <button onClick={() => setOpen(true)} className="md:hidden flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
        <Search size={18} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Global Search</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSearch} className="flex items-center border-b border-border px-3">
            <Search className="h-5 w-5 text-tertiary shrink-0" />
            <Input
              name="q"
              placeholder="Search anything..."
              className="border-0 focus-visible:ring-0 shadow-none rounded-none text-base bg-transparent h-14"
              autoFocus
              autoComplete="off"
            />
          </form>
          <div className="px-4 py-6 text-center text-sm text-tertiary">
            Start typing to search across your store.
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
