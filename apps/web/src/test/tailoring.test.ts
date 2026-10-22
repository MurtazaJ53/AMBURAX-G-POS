import { describe, it, expect } from "vitest";
import {
  createTailoringOrder,
  updateAlterationStatus,
  generateTailoringJobTicket,
  type TailoringMeasurementSheet,
} from "@/server/sales/tailoring";

describe("Alteration Orders & Customer Measurements (Line 9 & Line 36)", () => {
  const sampleMeasurements: TailoringMeasurementSheet = {
    customerId: "cust_123",
    customerName: "Rajesh Kumar",
    phone: "9876543210",
    unit: "INCHES",
    chest: 40,
    waist: 34,
    hip: 38,
    shoulder: 18,
    trouserLength: 41,
    inseam: 31,
    updatedAt: new Date().toISOString(),
  };

  it("creates a tailoring order with itemized alterations and balance due", () => {
    const order = createTailoringOrder({
      tenantId: "ten_test",
      storeId: "str_surat",
      customerId: "cust_123",
      customerName: "Rajesh Kumar",
      phone: "9876543210",
      deliveryPromisedAt: "2026-10-21T18:00:00Z",
      items: [
        {
          productName: "Linen Formal Trouser Charcoal 34",
          alterationType: "HEM_LENGTH",
          instructions: "Shorten length by 1.5 inches, narrow bottom opening to 14 inches",
          chargeMinor: 15000, // ₹150
        },
        {
          productName: "Slim Fit Oxford Shirt White 40",
          alterationType: "SLEEVE_SHORTEN",
          instructions: "Shorten both sleeves by 1 inch from shoulder",
          chargeMinor: 10000, // ₹100
        },
      ],
      measurements: sampleMeasurements,
      advancePaidMinor: 10000, // ₹100 advance paid
    });

    expect(order.orderNumber.startsWith("TLR-")).toBe(true);
    expect(order.items.length).toBe(2);
    expect(order.totalChargesMinor).toBe(25000); // ₹250
    expect(order.advancePaidMinor).toBe(10000);   // ₹100
    expect(order.balanceDueMinor).toBe(15000);    // ₹150
    expect(order.status).toBe("BOOKED");
    expect(order.measurements?.chest).toBe(40);
  });

  it("updates status and karigar assignment across the job lifecycle", () => {
    let order = createTailoringOrder({
      tenantId: "ten_test",
      storeId: "str_surat",
      customerId: "cust_123",
      customerName: "Rajesh Kumar",
      phone: "9876543210",
      deliveryPromisedAt: "2026-10-21T18:00:00Z",
      items: [
        {
          productName: "Linen Trouser",
          alterationType: "HEM_LENGTH",
          instructions: "Shorten 1 inch",
          chargeMinor: 0, // Complimentary
        },
      ],
    });

    order = updateAlterationStatus(order, "ASSIGNED", "Master Ramesh Tailor");
    expect(order.status).toBe("ASSIGNED");
    expect(order.items[0]?.assignedKarigarName).toBe("Master Ramesh Tailor");

    order = updateAlterationStatus(order, "READY");
    expect(order.status).toBe("READY");
    expect(order.items[0]?.status).toBe("READY");
  });

  it("generates a formatted printable job ticket for the karigar", () => {
    const order = createTailoringOrder({
      tenantId: "ten_test",
      storeId: "str_surat",
      customerId: "cust_123",
      customerName: "Rajesh Kumar",
      phone: "9876543210",
      deliveryPromisedAt: "2026-10-21T18:00:00Z",
      items: [
        {
          productName: "Linen Trouser",
          alterationType: "HEM_LENGTH",
          instructions: "Shorten 1 inch",
          chargeMinor: 15000,
        },
      ],
      measurements: sampleMeasurements,
      advancePaidMinor: 5000,
    });

    const ticket = generateTailoringJobTicket(order);
    expect(ticket).toContain("TAILORING & ALTERATION TICKET");
    expect(ticket).toContain("Rajesh Kumar (9876543210)");
    expect(ticket).toContain("MEASUREMENTS (INCHES):");
    expect(ticket).toContain("Waist: 34");
    expect(ticket).toContain("Due: ₹100.00");
  });
});
