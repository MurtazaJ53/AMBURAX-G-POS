/**
 * Garment Digital QR Hangtag Engine
 * Encodes size chart, fabric composition, care instructions, warranty,
 * and seamless customer digital reorder URL onto customer-facing garment QR tags.
 */

export interface GarmentHangtagData {
  sku: string;
  designNumber: string;
  brand: string;
  name: string;
  size: string;
  mrp: number;
  fabric: string; // e.g., "100% Giza Cotton"
  careInstructions: string[]; // ["Machine wash cold", "Do not bleach", "Warm iron"]
  sizeChart: {
    chestInches: number;
    waistInches: number;
    lengthInches: number;
    shoulderInches: number;
  };
  reorderBaseUrl: string;
  batchOrLotNumber?: string;
}

export interface GeneratedHangtagPayload {
  qrCodeUrl: string;
  customerMobilePageUrl: string;
  printablePayloadText: string;
  careSymbols: string[];
}

export function generateGarmentHangtag(
  data: GarmentHangtagData
): GeneratedHangtagPayload {
  const customerMobilePageUrl = `${data.reorderBaseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(data.designNumber)}?sku=${encodeURIComponent(data.sku)}&size=${encodeURIComponent(data.size)}`;

  // Care symbols mapping
  const careSymbols: string[] = [];
  const careStr = data.careInstructions.join(" ").toLowerCase();
  if (careStr.includes("wash")) careSymbols.push("WASH_30C");
  if (careStr.includes("bleach")) careSymbols.push("DO_NOT_BLEACH");
  if (careStr.includes("iron")) careSymbols.push("IRON_MEDIUM");
  if (careStr.includes("dry")) careSymbols.push("LINE_DRY");

  // Format printable micro-string for QR code reader
  const printablePayloadText = [
    `BRAND:${data.brand}`,
    `DESIGN:${data.designNumber}`,
    `SIZE:${data.size}`,
    `FABRIC:${data.fabric}`,
    `CHEST:${data.sizeChart.chestInches}"`,
    `CARE:${data.careInstructions.slice(0, 2).join(",")}`,
    `REORDER:${customerMobilePageUrl}`,
  ].join("|");

  return {
    qrCodeUrl: customerMobilePageUrl,
    customerMobilePageUrl,
    printablePayloadText,
    careSymbols,
  };
}
