import { describe, expect, it } from "vitest";
import { deleteUserAccount, deleteCustomerData } from "@/server/identity/accountDeletion";

describe("Account & Customer Data Deletion (GDPR/DPDP Right to Erasure)", () => {
  it("exports account deletion and anonymization handlers", () => {
    expect(typeof deleteUserAccount).toBe("function");
    expect(typeof deleteCustomerData).toBe("function");
  });
});
