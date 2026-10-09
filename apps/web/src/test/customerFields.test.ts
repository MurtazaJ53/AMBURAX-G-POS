import { describe, expect, it } from "vitest";
import {
  formatPhone,
  normalizeEmail,
  normalizeGstin,
  normalizeName,
  normalizePhone,
  phoneLookupVariants,
} from "@/lib/customerFields";

describe("normalizePhone — one number, one spelling", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["(+91) 98765 43210", "+919876543210"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizePhone(raw)).toEqual({ ok: true, value: expected });
  });

  it("accepts an international number written with its own country code", () => {
    expect(normalizePhone("+44 20 7946 0958")).toEqual({ ok: true, value: "+442079460958" });
  });

  it.each([
    ["", "Enter the customer's mobile number."],
    ["12345", "Enter a 10-digit mobile number."],
    ["5876543210", "An Indian mobile number starts with 6, 7, 8 or 9."],
    ["98765abc10", "A mobile number can only contain digits."],
    ["98765432101234", "Enter a 10-digit mobile number."],
  ])("refuses %j", (raw, error) => {
    expect(normalizePhone(raw)).toEqual({ ok: false, error });
  });

  it("finds every older spelling of the same number", () => {
    expect(phoneLookupVariants("+919876543210")).toEqual(["+919876543210", "9876543210", "919876543210", "09876543210"]);
  });

  it("formats for display", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("9876543210")).toBe("+91 98765 43210");
    expect(formatPhone(null)).toBe("");
  });
});

describe("normalizeName", () => {
  it("tidies spaces and keeps real names", () => {
    expect(normalizeName("  Priya   Sharma ")).toEqual({ ok: true, value: "Priya Sharma" });
    expect(normalizeName("D'Souza & Sons")).toEqual({ ok: true, value: "D'Souza & Sons" });
    expect(normalizeName("प्रिया शर्मा")).toEqual({ ok: true, value: "प्रिया शर्मा" });
  });

  it("refuses a phone number typed into the name box", () => {
    expect(normalizeName("9876543210")).toMatchObject({ ok: false, error: "A name cannot contain numbers." });
  });

  it("refuses too short, too long and odd characters", () => {
    expect(normalizeName("A").ok).toBe(false);
    expect(normalizeName("x".repeat(81)).ok).toBe(false);
    expect(normalizeName("Priya <script>").ok).toBe(false);
  });
});

describe("normalizeEmail and normalizeGstin — optional, but valid when given", () => {
  it("treats empty as none", () => {
    expect(normalizeEmail("")).toEqual({ ok: true, value: null });
    expect(normalizeGstin("  ")).toEqual({ ok: true, value: null });
  });

  it("lowercases e-mail and refuses a malformed one", () => {
    expect(normalizeEmail(" Priya@Mail.COM ")).toEqual({ ok: true, value: "priya@mail.com" });
    expect(normalizeEmail("priya@mail").ok).toBe(false);
  });

  it("uppercases a GSTIN and refuses a wrong shape", () => {
    expect(normalizeGstin("27abcde1234f1z5")).toEqual({ ok: true, value: "27ABCDE1234F1Z5" });
    expect(normalizeGstin("27ABCDE1234F1X5").ok).toBe(false);
  });
});
