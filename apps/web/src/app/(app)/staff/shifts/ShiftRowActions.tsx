"use client";

import { useState } from "react";
import { Calculator, CheckCircle2, ArrowDownRight, Printer } from "lucide-react";
import { DayCloseModal, ApproveVarianceModal, CashMovementModal } from "./DayCloseModals";
import { ShiftHandoverSlipModal } from "./ShiftHandoverSlipModal";

export function ShiftRowActions(props: {
  session: {
    id: string;
    openedAt?: Date | string;
    closedAt: Date | null;
    cashierName: string;
    posDeviceName: string;
    posDeviceCode?: string;
    openingFloatMinor?: number | null;
    billsCount?: number;
    varianceStatus: string | null;
    expectedCashMinor: number;
    expectedUpiMinor: number;
    expectedCardMinor: number;
    counts?: Array<{
      method: string;
      expectedMinor: number;
      countedMinor: number;
      differenceMinor: number;
    }>;
    closingNote?: string | null;
  };
}) {
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [slipModalOpen, setSlipModalOpen] = useState(false);

  const isOpen = !props.session.closedAt;
  const needsApproval = props.session.varianceStatus === "PENDING_APPROVAL";

  return (
    <>
      <div className="flex items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => setSlipModalOpen(true)}
          title="Print shift handover slip and cash settlement breakdown"
          className="amb-focus amb-press inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 transition-colors"
        >
          <Printer className="h-3 w-3 text-indigo-600" /> Slip
        </button>
        {isOpen && (
          <>
            <button
              type="button"
              onClick={() => setMovementModalOpen(true)}
              className="amb-focus amb-press inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ArrowDownRight className="h-3 w-3 text-emerald-600" /> Pay In/Out
            </button>
            <button
              type="button"
              onClick={() => setCloseModalOpen(true)}
              className="amb-focus amb-press inline-flex h-7 items-center gap-1 rounded bg-indigo-600 px-2 text-[11px] font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              <Calculator className="h-3 w-3" /> Close &amp; Count
            </button>
          </>
        )}

        {needsApproval && (
          <button
            type="button"
            onClick={() => setApproveModalOpen(true)}
            className="amb-focus amb-press inline-flex h-7 items-center gap-1 rounded bg-amber-600 px-2 text-[11px] font-semibold text-white hover:bg-amber-700 transition-colors"
          >
            <CheckCircle2 className="h-3 w-3" /> Approve
          </button>
        )}
      </div>

      <DayCloseModal
        isOpen={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        session={{
          id: props.session.id,
          cashierName: props.session.cashierName,
          posDeviceName: props.session.posDeviceName,
          expectedCashMinor: props.session.expectedCashMinor,
          expectedUpiMinor: props.session.expectedUpiMinor,
          expectedCardMinor: props.session.expectedCardMinor,
        }}
      />

      <ApproveVarianceModal
        isOpen={approveModalOpen}
        onClose={() => setApproveModalOpen(false)}
        session={{
          id: props.session.id,
          cashierName: props.session.cashierName,
        }}
      />

      <CashMovementModal
        isOpen={movementModalOpen}
        onClose={() => setMovementModalOpen(false)}
        session={{
          id: props.session.id,
          cashierName: props.session.cashierName,
          posDeviceName: props.session.posDeviceName,
        }}
      />

      <ShiftHandoverSlipModal
        isOpen={slipModalOpen}
        onClose={() => setSlipModalOpen(false)}
        session={{
          id: props.session.id,
          openedAt: props.session.openedAt ?? new Date(),
          closedAt: props.session.closedAt,
          cashierName: props.session.cashierName,
          posDeviceName: props.session.posDeviceName,
          posDeviceCode: props.session.posDeviceCode ?? "REG-1",
          openingFloatMinor: props.session.openingFloatMinor ?? null,
          billsCount: props.session.billsCount ?? 0,
          expectedCashMinor: props.session.expectedCashMinor,
          expectedUpiMinor: props.session.expectedUpiMinor,
          expectedCardMinor: props.session.expectedCardMinor,
          counts: props.session.counts,
          closingNote: props.session.closingNote,
          varianceStatus: props.session.varianceStatus,
        }}
      />
    </>
  );
}
