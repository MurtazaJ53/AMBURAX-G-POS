/**
 * Post-Dated Cheque (PDC) Manager
 * Tracks wholesale customer / supplier post-dated cheques, clearance dates,
 * bank deposits, dishonor / bounces, and party/agent credit aging.
 */

export interface ChequeRecord {
  id: string;
  chequeNumber: string;
  bankName: string;
  partyId: string;
  partyName: string;
  agentId?: string;
  amount: number;
  chequeDate: string; // ISO date string YYYY-MM-DD
  depositDate?: string;
  clearanceDate?: string;
  status: "received" | "deposited" | "cleared" | "bounced" | "cancelled";
  bounceReason?: string;
  bounceCharge?: number;
  invoicesCovered: string[];
  createdAt: string;
}

export interface ChequeDepositBatch {
  depositDate: string;
  bankAccount: string;
  chequeIds: string[];
  totalAmount: number;
}

export interface PartyChequeAgingSummary {
  partyId: string;
  partyName: string;
  agentId?: string;
  totalPdcAmount: number;
  dueInDays: {
    overdue: number; // Cheque date already passed but not cleared/deposited
    days0To7: number;
    days8To15: number;
    days16To30: number;
    days30Plus: number;
  };
  bouncedChequesCount: number;
  bouncedAmount: number;
}

export function registerCheque(
  record: Omit<ChequeRecord, "status" | "createdAt">
): ChequeRecord {
  if (!record.chequeNumber || record.chequeNumber.trim().length === 0) {
    throw new Error("Cheque number is required");
  }
  if (record.amount <= 0) {
    throw new Error("Cheque amount must be greater than zero");
  }

  return {
    ...record,
    status: "received",
    createdAt: new Date().toISOString(),
  };
}

export function depositCheques(
  cheques: ChequeRecord[],
  chequeIdsToDeposit: string[],
  depositDate: string,
  bankAccount: string
): { updatedCheques: ChequeRecord[]; batch: ChequeDepositBatch } {
  let totalAmount = 0;
  const updatedCheques = cheques.map((ch) => {
    if (chequeIdsToDeposit.includes(ch.id)) {
      if (ch.status !== "received") {
        throw new Error(
          `Cheque ${ch.chequeNumber} cannot be deposited because its status is ${ch.status}`
        );
      }
      totalAmount += ch.amount;
      return {
        ...ch,
        depositDate,
        status: "deposited" as const,
      };
    }
    return ch;
  });

  return {
    updatedCheques,
    batch: {
      depositDate,
      bankAccount,
      chequeIds: chequeIdsToDeposit,
      totalAmount: Math.round(totalAmount * 100) / 100,
    },
  };
}

export function clearCheque(
  cheque: ChequeRecord,
  clearanceDate: string
): ChequeRecord {
  if (cheque.status !== "deposited") {
    throw new Error(`Cheque must be deposited before clearance. Current status: ${cheque.status}`);
  }
  return {
    ...cheque,
    status: "cleared",
    clearanceDate,
  };
}

export function bounceCheque(
  cheque: ChequeRecord,
  bounceReason: string,
  bounceCharge: number = 250
): ChequeRecord {
  if (cheque.status !== "deposited" && cheque.status !== "received") {
    throw new Error(`Cheque in status ${cheque.status} cannot be marked bounced`);
  }
  return {
    ...cheque,
    status: "bounced",
    bounceReason,
    bounceCharge,
  };
}

export function computePdcAging(
  cheques: ChequeRecord[],
  asOfDateStr: string = new Date().toISOString().slice(0, 10)
): PartyChequeAgingSummary[] {
  const asOf = new Date(asOfDateStr).getTime();
  const partyMap = new Map<string, PartyChequeAgingSummary>();

  for (const ch of cheques) {
    if (ch.status === "cancelled") continue;

    let partySummary = partyMap.get(ch.partyId);
    if (!partySummary) {
      partySummary = {
        partyId: ch.partyId,
        partyName: ch.partyName,
        agentId: ch.agentId,
        totalPdcAmount: 0,
        dueInDays: {
          overdue: 0,
          days0To7: 0,
          days8To15: 0,
          days16To30: 0,
          days30Plus: 0,
        },
        bouncedChequesCount: 0,
        bouncedAmount: 0,
      };
      partyMap.set(ch.partyId, partySummary);
    }

    if (ch.status === "bounced") {
      partySummary.bouncedChequesCount += 1;
      partySummary.bouncedAmount += ch.amount + (ch.bounceCharge ?? 0);
      continue;
    }

    if (ch.status === "cleared") {
      continue; // Cleared cheques are not pending PDC
    }

    // Active PDC (received or deposited)
    partySummary.totalPdcAmount += ch.amount;
    const chDate = new Date(ch.chequeDate).getTime();
    const diffDays = Math.floor((chDate - asOf) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      partySummary.dueInDays.overdue += ch.amount;
    } else if (diffDays <= 7) {
      partySummary.dueInDays.days0To7 += ch.amount;
    } else if (diffDays <= 15) {
      partySummary.dueInDays.days8To15 += ch.amount;
    } else if (diffDays <= 30) {
      partySummary.dueInDays.days16To30 += ch.amount;
    } else {
      partySummary.dueInDays.days30Plus += ch.amount;
    }
  }

  return Array.from(partyMap.values());
}
