"use client";

import { useState, useEffect } from "react";
import { Printer, Sliders } from "lucide-react";
import { ThermalPrinterModal } from "@/client/hardware/ThermalPrinterModal";
import type { ReceiptData } from "@/client/hardware/escpos";

/**
 * Print & Hardware Trigger Button
 *
 * Supports both standard browser printing (F3) and high-speed ESC/POS Direct Thermal
 * printing (58mm / 80mm roll, paper cutter, cash drawer kick).
 */
export function PrintButton({
  variant = "header",
  receiptData,
}: {
  variant?: "header" | "tile";
  receiptData?: ReceiptData;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (variant !== "header") return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F3") return;
      event.preventDefault();
      if (receiptData) {
        setModalOpen(true);
      } else {
        window.print();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, receiptData]);

  const handleClick = () => {
    if (receiptData) {
      setModalOpen(true);
    } else {
      window.print();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-keyshortcuts={variant === "header" ? "F3" : undefined}
        className="amb-press inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-primary-active transition-colors hover:border-border-hover hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus print:hidden"
      >
        <Printer aria-hidden="true" className="h-4 w-4" />
        {variant === "header" ? "Print Bill / Tax Invoice (F3)" : "Print Bill (F3)"}
      </button>

      {receiptData && (
        <ThermalPrinterModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          receiptData={receiptData}
        />
      )}
    </>
  );
}
