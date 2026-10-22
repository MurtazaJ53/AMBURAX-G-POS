import { describe, it, expect } from "vitest";
import {
  calculateChargeableWeight,
  checkCourierServiceability,
  createCourierShipment,
  type ShippingOrderRequest,
} from "@/server/orders/shippingIntegration";

describe("Courier & Shipping Integration Engine (Line 65)", () => {
  it("calculates volumetric vs dead weight accurately", () => {
    // Heavy compact box: 2kg dead weight, 20x20x10 cm = 4000/5000 = 0.8kg volumetric -> Chargeable: 2.0kg
    const heavyBox = calculateChargeableWeight({
      lengthCm: 20,
      widthCm: 20,
      heightCm: 10,
      deadWeightKg: 2.0,
    });
    expect(heavyBox.chargeableWeightKg).toBe(2.0);

    // Light bulky box: 0.5kg dead weight, 40x30x20 cm = 24000/5000 = 4.8kg volumetric -> Chargeable: 4.8kg
    const bulkyBox = calculateChargeableWeight({
      lengthCm: 40,
      widthCm: 30,
      heightCm: 20,
      deadWeightKg: 0.5,
    });
    expect(bulkyBox.chargeableWeightKg).toBe(4.8);
  });

  it("checks carrier rates and serviceability across regional and national zones", () => {
    // Regional: Surat (395002) to Ahmedabad (380001)
    const regional = checkCourierServiceability("395002", "380001", 1.0, false);
    expect(regional.length).toBeGreaterThan(0);
    expect(regional[0]?.zone).toBe("REGIONAL");
    expect(regional[0]?.estimatedTransitDays).toBeLessThanOrEqual(3);

    // National: Surat (395002) to Delhi (110001)
    const national = checkCourierServiceability("395002", "110001", 1.0, false);
    expect(national[0]?.zone).toBe("NATIONAL");
    expect(national[0]?.rateMinor).toBeGreaterThan(regional[0]!.rateMinor);
  });

  it("manifests shipment and issues valid AWB tracking number", async () => {
    const order: ShippingOrderRequest = {
      orderId: "ord_101",
      orderNumber: "B2B-EXP-101",
      customerName: "Vikas Textiles",
      customerPhone: "9825123456",
      deliveryAddress: {
        addressLine1: "Connaught Place",
        city: "New Delhi",
        state: "Delhi",
        pincode: "110001",
      },
      pickupPincode: "395002",
      parcel: {
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
        deadWeightKg: 1.5,
      },
      paymentMode: "PREPAID",
    };

    const shipment = await createCourierShipment(order, "DELHIVERY_SURFACE");
    expect(shipment.status).toBe("MANIFESTED");
    expect(shipment.awbNumber.startsWith("AWB-DEL-")).toBe(true);
    expect(shipment.labelUrl).toContain(".pdf");
    expect(shipment.trackingUrl).toContain(shipment.awbNumber);
  });
});
