/**
 * Nightly WhatsApp Owner Summary Engine
 * Assembles daily business KPIs: sales, collections (cash/UPI/cheque), total party dues,
 * inventory alerts, and sends a concise formatted WhatsApp digest to the shop owner.
 */

export interface DailySummaryInput {
  date: string; // YYYY-MM-DD
  storeName: string;
  ownerName: string;
  salesMetrics: {
    grossSales: number;
    discounts: number;
    netSales: number;
    invoiceCount: number;
  };
  collections: {
    cash: number;
    upi: number;
    chequeCleared: number;
    totalCollected: number;
  };
  dues: {
    totalOutstanding: number;
    overdueAmount: number;
    partiesOverdueCount: number;
  };
  stockAlerts: {
    lowStockItemCount: number;
    deadStockValue: number;
  };
  productionStats?: {
    karigarJobsPending: number;
    cuttingMetersToday: number;
  };
}

export function generateNightlyWhatsAppDigest(data: DailySummaryInput): string {
  const f = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  let msg = `📊 *${data.storeName} - Daily Business Report*\n`;
  msg += `📅 *Date:* ${data.date}\n`;
  msg += `👤 *Report For:* ${data.ownerName}\n\n`;

  msg += `💰 *SALES SUMMARY:*\n`;
  msg += `• Net Sales: *${f(data.salesMetrics.netSales)}* (${data.salesMetrics.invoiceCount} bills)\n`;
  if (data.salesMetrics.discounts > 0) {
    msg += `• Total Discounts: ${f(data.salesMetrics.discounts)}\n`;
  }

  msg += `\n📥 *COLLECTIONS TODAY:*\n`;
  msg += `• Cash: ${f(data.collections.cash)}\n`;
  msg += `• UPI / Online: ${f(data.collections.upi)}\n`;
  msg += `• Cheque Cleared: ${f(data.collections.chequeCleared)}\n`;
  msg += `• *Total Inflow:* *${f(data.collections.totalCollected)}*\n`;

  msg += `\n⚠️ *OUTSTANDING DUES:*\n`;
  msg += `• Total Market Dues: ${f(data.dues.totalOutstanding)}\n`;
  msg += `• Critical Overdue: *${f(data.dues.overdueAmount)}* (${data.dues.partiesOverdueCount} parties)\n`;

  msg += `\n📦 *INVENTORY & ALERTS:*\n`;
  msg += `• Low Stock Items: ${data.stockAlerts.lowStockItemCount} SKUs\n`;
  if (data.stockAlerts.deadStockValue > 0) {
    msg += `• Aging/Dead Stock: ${f(data.stockAlerts.deadStockValue)}\n`;
  }

  if (data.productionStats) {
    msg += `\n✂️ *PRODUCTION & JOBWORK:*\n`;
    msg += `• Fabric Cut Today: ${data.productionStats.cuttingMetersToday} meters\n`;
    msg += `• Karigar Jobs Pending: ${data.productionStats.karigarJobsPending} orders\n`;
  }

  msg += `\n_Generated automatically by G-POS at 10:00 PM_`;
  return msg;
}
