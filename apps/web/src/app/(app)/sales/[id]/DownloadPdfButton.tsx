"use client";

import { Download } from "lucide-react";

export function DownloadPdfButton({ billNumber }: { billNumber: string }) {
  const handlePrintToPdf = () => {
    // Standard cross-browser practice for generating pixel-perfect statutory A4/A5 PDF
    // Prints the dedicated print view with CSS media queries @media print
    const originalTitle = document.title;
    document.title = `Tax-Invoice-${billNumber}`;
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  };

  return (
    <button
      type="button"
      onClick={handlePrintToPdf}
      className="amb-press inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-secondary transition-colors hover:border-border-hover hover:bg-background-hover hover:text-primary print:hidden"
    >
      <Download aria-hidden="true" className="h-4 w-4" />
      Save / PDF
    </button>
  );
}
