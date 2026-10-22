/**
 * Alterations & Tailoring Management (Line 9 & Line 36)
 *
 * Covers:
 * 1. Alteration / Tailoring Order lifecycle (BOOKED -> ASSIGNED -> IN_PROGRESS -> READY -> DELIVERED).
 * 2. Garment modification specifications (waist reduction, hem length, sleeve adjustment, chest tapering, etc.).
 * 3. Customer Measurement Profile (chest, waist, hip, inseam, shoulder, neck, sleeve, length).
 * 4. Job ticket generation for tailors/karigars with barcode and promised delivery timestamp.
 */

export type AlterationStatus = "BOOKED" | "ASSIGNED" | "IN_PROGRESS" | "READY" | "DELIVERED" | "CANCELLED";

export interface TailoringMeasurementSheet {
  customerId: string;
  customerName: string;
  phone: string;
  notes?: string;
  // Standard tailoring specs (inches / cm)
  unit: "INCHES" | "CM";
  chest?: number;
  waist?: number;
  hip?: number;
  shoulder?: number;
  sleeveLength?: number;
  neck?: number;
  inseam?: number;
  trouserLength?: number;
  kurtaLength?: number;
  updatedAt: string;
}

export interface GarmentAlterationItem {
  id: string;
  saleId?: string;
  productName: string;
  variantDescription?: string;
  barcode?: string;
  alterationType: "HEM_LENGTH" | "WAIST_TAKE_IN" | "WAIST_LET_OUT" | "SLEEVE_SHORTEN" | "CHEST_TAPER" | "CUSTOM_FIT";
  instructions: string;
  chargeMinor: number; // In paise (0 if complimentary with purchase)
  assignedKarigarName?: string;
  status: AlterationStatus;
}

export interface TailoringJobOrder {
  id: string;
  orderNumber: string;
  tenantId: string;
  storeId: string;
  customerId: string;
  customerName: string;
  phone: string;
  bookedAt: string;
  deliveryPromisedAt: string;
  items: GarmentAlterationItem[];
  measurements?: TailoringMeasurementSheet;
  totalChargesMinor: number;
  advancePaidMinor: number;
  balanceDueMinor: number;
  status: AlterationStatus;
  ticketBarcode: string;
}

export function createTailoringOrder(input: {
  tenantId: string;
  storeId: string;
  customerId: string;
  customerName: string;
  phone: string;
  deliveryPromisedAt: string;
  items: Omit<GarmentAlterationItem, "id" | "status">[];
  measurements?: TailoringMeasurementSheet;
  advancePaidMinor?: number;
}): TailoringJobOrder {
  const orderNumber = `TLR-${Date.now().toString().slice(-6)}`;
  let totalChargesMinor = 0;

  const items: GarmentAlterationItem[] = input.items.map((item, idx) => {
    totalChargesMinor += item.chargeMinor;
    return {
      ...item,
      id: `TLR-ITEM-${idx + 1}-${Date.now().toString().slice(-4)}`,
      status: "BOOKED",
    };
  });

  const advancePaid = input.advancePaidMinor || 0;
  const balanceDue = Math.max(0, totalChargesMinor - advancePaid);

  return {
    id: `tlr_${Date.now()}`,
    orderNumber,
    tenantId: input.tenantId,
    storeId: input.storeId,
    customerId: input.customerId,
    customerName: input.customerName,
    phone: input.phone,
    bookedAt: new Date().toISOString(),
    deliveryPromisedAt: input.deliveryPromisedAt,
    items,
    measurements: input.measurements,
    totalChargesMinor,
    advancePaidMinor: advancePaid,
    balanceDueMinor: balanceDue,
    status: "BOOKED",
    ticketBarcode: orderNumber,
  };
}

export function updateAlterationStatus(
  order: TailoringJobOrder,
  newStatus: AlterationStatus,
  karigarName?: string
): TailoringJobOrder {
  const updatedItems = order.items.map(item => ({
    ...item,
    status: newStatus,
    assignedKarigarName: karigarName ?? item.assignedKarigarName,
  }));

  return {
    ...order,
    status: newStatus,
    items: updatedItems,
  };
}

export function generateTailoringJobTicket(order: TailoringJobOrder): string {
  const lines: string[] = [
    `=== TAILORING & ALTERATION TICKET ===`,
    `Order #: ${order.orderNumber}`,
    `Customer: ${order.customerName} (${order.phone})`,
    `Booked: ${order.bookedAt.substring(0, 10)}`,
    `PROMISED DELIVERY: ${order.deliveryPromisedAt.substring(0, 10)}`,
    `--------------------------------------`,
    `GARMENTS FOR ALTERATION:`,
  ];

  order.items.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. ${item.productName}`,
      `   Type: ${item.alterationType}`,
      `   Instructions: ${item.instructions}`,
      `   Status: ${item.status}`,
      `   Charge: ₹${(item.chargeMinor / 100).toFixed(2)}`
    );
  });

  if (order.measurements) {
    lines.push(`--------------------------------------`);
    lines.push(`MEASUREMENTS (${order.measurements.unit}):`);
    if (order.measurements.chest) lines.push(`Chest: ${order.measurements.chest}`);
    if (order.measurements.waist) lines.push(`Waist: ${order.measurements.waist}`);
    if (order.measurements.hip) lines.push(`Hip: ${order.measurements.hip}`);
    if (order.measurements.inseam) lines.push(`Inseam: ${order.measurements.inseam}`);
    if (order.measurements.trouserLength) lines.push(`Length: ${order.measurements.trouserLength}`);
  }

  lines.push(`--------------------------------------`);
  lines.push(`Total: ₹${(order.totalChargesMinor / 100).toFixed(2)}`);
  lines.push(`Advance: ₹${(order.advancePaidMinor / 100).toFixed(2)}`);
  lines.push(`Due: ₹${(order.balanceDueMinor / 100).toFixed(2)}`);
  lines.push(`[BARCODE: ${order.ticketBarcode}]`);
  lines.push(`======================================`);

  return lines.join("\n");
}
