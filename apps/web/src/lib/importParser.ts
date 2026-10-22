import * as XLSX from "xlsx";
import { parseCsv } from "./csv";

/**
 * Universal file parser for Import: supports CSV, TSV, JSON, and Excel (.xlsx, .xls).
 * Always returns a 2D array of string cells: `[headers, ...rows]`.
 */

export async function parseImportFile(file: File): Promise<{ fileName: string; rows: string[][] }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "json") {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return { fileName: file.name, rows: parseJsonToTable(parsed) };
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) throw new Error("Excel file has no sheets.");
    const sheet = wb.Sheets[firstSheetName];
    if (!sheet) throw new Error("First sheet is empty.");
    // Sheet to 2D array of strings
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    // Filter out completely empty rows
    const rows = (data as unknown[][]).map((row) =>
      row.map((cell) => (cell !== null && cell !== undefined ? String(cell).trim() : ""))
    ).filter((row) => row.some((c) => c !== ""));
    return { fileName: file.name, rows };
  }

  // Default: CSV, TSV, TXT
  const text = await file.text();
  return { fileName: file.name, rows: parseCsv(text) };
}

/** Flatten JSON array of objects or nested items into a 2D table */
function parseJsonToTable(json: unknown): string[][] {
  let list: unknown[] = [];
  if (Array.isArray(json)) {
    list = json;
  } else if (typeof json === "object" && json !== null) {
    // Try to find an array in the object (e.g. { customers: [...] } or { data: [...] } or { items: [...] })
    const arrayProp = Object.values(json).find((v) => Array.isArray(v));
    if (arrayProp && Array.isArray(arrayProp)) {
      list = arrayProp;
    } else {
      list = [json];
    }
  } else {
    throw new Error("JSON must contain an array of records or an object containing an array.");
  }

  if (list.length === 0) {
    return [];
  }

  // Collect all unique keys across all objects
  const headerSet = new Set<string>();
  const flatObjects: Record<string, string>[] = [];

  for (const item of list) {
    if (typeof item === "object" && item !== null) {
      const flat: Record<string, string> = {};
      flattenObject(item as Record<string, unknown>, flat, "");
      flatObjects.push(flat);
      Object.keys(flat).forEach((k) => headerSet.add(k));
    }
  }

  const headers = Array.from(headerSet);
  const rows = [headers];

  for (const flat of flatObjects) {
    rows.push(headers.map((h) => flat[h] ?? ""));
  }

  return rows;
}

function flattenObject(obj: Record<string, unknown>, out: Record<string, string>, prefix = "") {
  for (const [key, val] of Object.entries(obj)) {
    const k = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined) {
      out[k] = "";
    } else if (typeof val === "object" && !Array.isArray(val)) {
      flattenObject(val as Record<string, unknown>, out, k);
    } else if (Array.isArray(val)) {
      out[k] = val.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
    } else {
      out[k] = String(val).trim();
    }
  }
}
