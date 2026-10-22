/**
 * AI Dues Ranking & Multilingual WhatsApp Reminder Engine
 * Ranks outstanding wholesale debts by risk score, overdue days, and customer credit profile,
 * generating customized Gujarati, Hindi, and English WhatsApp reminder templates.
 */

export interface DebtorRecord {
  partyId: string;
  partyName: string;
  phone: string;
  totalDue: number;
  oldestInvoiceDays: number;
  creditDaysAllowed: number;
  lastPaymentDate?: string;
  bouncedChequeHistoryCount: number;
  preferredLanguage?: "gu" | "hi" | "en";
}

export interface RankedDebtor extends DebtorRecord {
  riskScore: number; // 0 - 100 (higher = call immediately)
  priorityTier: "Urgent" | "High" | "Medium" | "Normal";
  reminderMessage: string;
}

export function calculateDuesRiskScore(debtor: DebtorRecord): number {
  let score = 0;

  // Days overdue component (max 40 pts)
  const overdueDays = Math.max(0, debtor.oldestInvoiceDays - debtor.creditDaysAllowed);
  score += Math.min(40, overdueDays * 1.0);

  // Outstanding amount component (max 30 pts)
  if (debtor.totalDue >= 500000) score += 30;
  else if (debtor.totalDue >= 200000) score += 20;
  else if (debtor.totalDue >= 50000) score += 10;
  else score += 5;

  // Cheque bounce risk (max 30 pts)
  score += Math.min(30, debtor.bouncedChequeHistoryCount * 15);

  return Math.min(100, Math.round(score));
}

export function generateLocalizedReminderMessage(
  debtor: DebtorRecord,
  storeName: string
): string {
  const lang = debtor.preferredLanguage || "gu";
  const dueFormatted = `₹${debtor.totalDue.toLocaleString("en-IN")}`;
  const overdueDays = Math.max(0, debtor.oldestInvoiceDays - debtor.creditDaysAllowed);

  if (lang === "gu") {
    // Gujarati reminder
    return (
      `નમસ્તે ${debtor.partyName} જી,\n\n` +
      `આપનું ${storeName} નું બાકી પેમેન્ટ ${dueFormatted} જે ${overdueDays} દિવસથી અટકેલું છે. ` +
      `કૃપા કરીને આજ રોજ NEFT/RTGS અથવા UPI દ્વારા પતાવટ કરવા વિનંતી છે જેથી આગળનો માલ મોકલવામાં તકલીફ ન પડે.\n\n` +
      `ધન્યવાદ,\n${storeName}`
    );
  } else if (lang === "hi") {
    // Hindi reminder
    return (
      `नमस्ते ${debtor.partyName} जी,\n\n` +
      `आपका ${storeName} में बकाया भुगतान ${dueFormatted} पिछले ${overdueDays} दिनों से देय है। ` +
      `कृपया आज ही बैंक ट्रांसफर या UPI के माध्यम से भुगतान सुनिश्चित करें ताकि नया ऑर्डर तुरंत डिस्पैच किया जा सके।\n\n` +
      `धन्यवाद,\n${storeName}`
    );
  } else {
    // English reminder
    return (
      `Dear ${debtor.partyName},\n\n` +
      `This is a gentle reminder from ${storeName} regarding your outstanding balance of ${dueFormatted}, ` +
      `which is overdue by ${overdueDays} days. Please clear the pending dues via RTGS/NEFT/UPI today.\n\n` +
      `Regards,\n${storeName}`
    );
  }
}

export function rankDebtorsForCollection(
  debtors: DebtorRecord[],
  storeName: string = "G-POS Textile"
): RankedDebtor[] {
  return debtors
    .map((debtor) => {
      const riskScore = calculateDuesRiskScore(debtor);
      let priorityTier: "Urgent" | "High" | "Medium" | "Normal" = "Normal";

      if (riskScore >= 75) priorityTier = "Urgent";
      else if (riskScore >= 50) priorityTier = "High";
      else if (riskScore >= 30) priorityTier = "Medium";

      const reminderMessage = generateLocalizedReminderMessage(debtor, storeName);

      return {
        ...debtor,
        riskScore,
        priorityTier,
        reminderMessage,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}
