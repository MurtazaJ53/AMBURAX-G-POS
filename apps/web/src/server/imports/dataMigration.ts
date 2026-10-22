/**
 * Excel / Tally Data Importer & Migration Engine
 * Imports legacy retail/wholesale accounting data: Parties, Items, Stock, and Opening Balances.
 */

export interface ImportedParty {
  name: string;
  type: "customer" | "supplier" | "both";
  gstin?: string;
  phone?: string;
  creditDays?: number;
  creditLimit?: number;
  openingBalance: number; // Positive = Receivable (Dr), Negative = Payable (Cr)
}

export interface ImportedItem {
  sku: string;
  name: string;
  brand?: string;
  category?: string;
  fabric?: string;
  hsnCode?: string;
  mrp: number;
  costPrice: number;
  taxRatePercent: number;
  openingStock: number;
}

export interface ParseResult<T> {
  success: boolean;
  validRows: T[];
  errors: { row: number; error: string; raw: any }[];
  summary: {
    totalRows: number;
    successfulRows: number;
    failedRows: number;
  };
}

export function parseTallyPartyCsv(rows: Array<Record<string, any>>): ParseResult<ImportedParty> {
  const validRows: ImportedParty[] = [];
  const errors: { row: number; error: string; raw: any }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const name = String(row["Ledger Name"] || row["Party Name"] || row["name"] || "").trim();
    if (!name) {
      errors.push({ row: rowNum, error: "Missing Ledger/Party Name", raw: row });
      return;
    }

    const rawBalance = String(row["Opening Balance"] || row["balance"] || "0")
      .replace(/,/g, "")
      .trim();
    let balance = parseFloat(rawBalance) || 0;
    const isCredit = /cr/i.test(rawBalance);
    if (isCredit && balance > 0) {
      balance = -balance;
    }

    const gstin = String(row["GSTIN"] || row["GST No"] || row["gstin"] || "")
      .trim()
      .toUpperCase();
    const phone = String(row["Mobile"] || row["Phone"] || row["phone"] || "").trim();
    const typeStr = String(row["Parent"] || row["Group"] || row["type"] || "").toLowerCase();
    
    let type: "customer" | "supplier" | "both" = "customer";
    if (typeStr.includes("creditor") || typeStr.includes("supplier") || typeStr.includes("vendor")) {
      type = "supplier";
    }

    validRows.push({
      name,
      type,
      gstin: gstin.length === 15 ? gstin : undefined,
      phone: phone || undefined,
      creditDays: parseInt(String(row["Credit Period"] || row["creditDays"] || "30"), 10) || 30,
      creditLimit: parseFloat(String(row["Credit Limit"] || row["creditLimit"] || "0")) || 0,
      openingBalance: balance,
    });
  });

  return {
    success: errors.length === 0,
    validRows,
    errors,
    summary: {
      totalRows: rows.length,
      successfulRows: validRows.length,
      failedRows: errors.length,
    },
  };
}

export function parseItemStockCsv(rows: Array<Record<string, any>>): ParseResult<ImportedItem> {
  const validRows: ImportedItem[] = [];
  const errors: { row: number; error: string; raw: any }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const name = String(row["Item Name"] || row["name"] || "").trim();
    const sku = String(row["SKU"] || row["Item Code"] || row["sku"] || `SKU-${idx + 1000}`).trim();
    const mrp = parseFloat(String(row["MRP"] || row["mrp"] || "0")) || 0;
    const costPrice = parseFloat(String(row["Cost"] || row["costPrice"] || "0")) || 0;
    const openingStock = parseFloat(String(row["Opening Qty"] || row["stock"] || "0")) || 0;

    if (!name) {
      errors.push({ row: rowNum, error: "Missing Item Name", raw: row });
      return;
    }
    if (mrp < 0 || costPrice < 0) {
      errors.push({ row: rowNum, error: "MRP and Cost cannot be negative", raw: row });
      return;
    }

    validRows.push({
      sku,
      name,
      brand: String(row["Brand"] || row["brand"] || "").trim() || undefined,
      category: String(row["Category"] || row["category"] || "").trim() || undefined,
      fabric: String(row["Fabric"] || row["fabric"] || "").trim() || undefined,
      hsnCode: String(row["HSN"] || row["hsnCode"] || "").trim() || undefined,
      mrp,
      costPrice,
      taxRatePercent: parseFloat(String(row["GST %"] || row["taxRate"] || "5")) || 5,
      openingStock,
    });
  });

  return {
    success: errors.length === 0,
    validRows,
    errors,
    summary: {
      totalRows: rows.length,
      successfulRows: validRows.length,
      failedRows: errors.length,
    },
  };
}
