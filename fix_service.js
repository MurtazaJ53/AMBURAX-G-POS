const fs = require("fs");
let content = fs.readFileSync("apps/web/src/server/sales/saleService.ts", "utf-8");

// Add validation_error to CreateSaleResult if needed
if (!content.includes('| { status: "validation_error"; reason: string }')) {
  content = content.replace(
    '| { status: "unknown_customer" }',
    '| { status: "unknown_customer" }\n  | { status: "validation_error"; reason: string }'
  );
}

const targetBlock = `  const totals = computeSaleTotals(priced, input.discountMinor ?? 0);

  // Every supported tender is operator-confirmed at the counter; there is no gateway to
  // call and therefore no asynchronous confirmation to await. When a gateway is added this
  // becomes PENDING until the provider confirms ?" see ADR-082.
  const paidMinor = totals.totalMinor;`;

const targetBlock2 = `  const totals = computeSaleTotals(priced, input.discountMinor ?? 0);

  // Every supported tender is operator-confirmed at the counter; there is no gateway to
  // call and therefore no asynchronous confirmation to await. When a gateway is added this
  // becomes PENDING until the provider confirms ??? see ADR-082.
  const paidMinor = totals.totalMinor;`;

// We might have different encodings for the dash, let's use regex
const blockRegex = /const totals = computeSaleTotals.*?const paidMinor = totals.totalMinor;/s;

const replaceBlock = `const totals = computeSaleTotals(priced, input.discountMinor ?? 0);

  // Unify payments
  const providedPayments = input.payments || (input.payment ? [input.payment] : []);
  if (providedPayments.length === 0) {
    return { status: "validation_error", reason: "At least one payment is required." };
  }

  let sumMinor = 0;
  const processedPayments = providedPayments.map((p) => {
    const amt = p.amountMinor ?? totals.totalMinor;
    if (amt <= 0) {
      throw new Error("Payment amounts must be positive");
    }
    sumMinor += amt;
    return { ...p, amountMinor: amt };
  });

  if (sumMinor < totals.totalMinor) {
    return { status: "validation_error", reason: "Insufficient payment." };
  }
  if (sumMinor > totals.totalMinor) {
    const hasCash = processedPayments.some(p => p.method === "CASH");
    if (!hasCash) {
      return { status: "validation_error", reason: "Overpayment requires CASH method." };
    }
  }

  const paidMinor = totals.totalMinor;`;

content = content.replace(blockRegex, replaceBlock);

const createRegex = /payments:\s*\{\s*create:\s*\{\s*method:\s*input\.payment\.method,\s*status:\s*"CONFIRMED",\s*amountMinor:\s*paidMinor,\s*reference:\s*input\.payment\.reference\?\.trim\(\)\s*\|\|\s*null,\s*confirmedAt:\s*new\s*Date\(\),\s*\},\s*\},/s;

const replaceCreate = `payments: {
            create: processedPayments.map(p => ({
              method: p.method,
              status: "CONFIRMED",
              amountMinor: p.amountMinor,
              reference: p.reference?.trim() || null,
              confirmedAt: new Date(),
            })),
          },`;

content = content.replace(createRegex, replaceCreate);

const eventRegex = /paymentMethod:\s*input\.payment\.method,\s*\},/s;
const replaceEvent = `paymentMethod: processedPayments.length === 1 ? processedPayments[0].method : "SPLIT",
        },`;

content = content.replace(eventRegex, replaceEvent);

fs.writeFileSync("apps/web/src/server/sales/saleService.ts", content);
