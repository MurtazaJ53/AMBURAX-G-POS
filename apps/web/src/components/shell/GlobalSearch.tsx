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
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full max-w-sm rounded-md border border-border bg-background-app px-3 py-1.5 text-sm text-tertiary transition-colors hover:border-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">Search products, customers, orders...</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-background-subtle px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
          <span className="text-xs">âŒ˜</span >K
        </kbd>
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
