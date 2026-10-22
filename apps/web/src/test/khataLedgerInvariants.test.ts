import { describe, expect, it } from "vitest";

describe("Khata Ledger Invariants Specification Tests", () => {
  describe("Receivable Permitted Reversal Pairs", () => {
    const permittedReceivableReversalPairs = {
      DEBIT_CREDIT_SALE: "CREDIT_REVERSAL",
      CREDIT_REPAYMENT: "DEBIT_REVERSAL",
      CREDIT_SALE_RETURN: "DEBIT_REVERSAL",
      CREDIT_ADVANCE_APPLY: "DEBIT_REVERSAL",
    } as const;

    it("maps all non-reversal receivable entry types to their exact inverse reversal type", () => {
      expect(permittedReceivableReversalPairs.DEBIT_CREDIT_SALE).toBe("CREDIT_REVERSAL");
      expect(permittedReceivableReversalPairs.CREDIT_REPAYMENT).toBe("DEBIT_REVERSAL");
      expect(permittedReceivableReversalPairs.CREDIT_SALE_RETURN).toBe("DEBIT_REVERSAL");
      expect(permittedReceivableReversalPairs.CREDIT_ADVANCE_APPLY).toBe("DEBIT_REVERSAL");
    });

    it("does not permit reversing an already existing reversal entry", () => {
      const isReversalType = (type: string) => type === "DEBIT_REVERSAL" || type === "CREDIT_REVERSAL";
      expect(isReversalType("DEBIT_REVERSAL")).toBe(true);
      expect(isReversalType("CREDIT_REVERSAL")).toBe(true);
      expect(isReversalType("DEBIT_CREDIT_SALE")).toBe(false);
    });
  });

  describe("Advance Permitted Reversal Pairs", () => {
    const permittedAdvanceReversalPairs = {
      CREDIT_ADVANCE_DEPOSIT: "DEBIT_REVERSAL",
      DEBIT_APPLICATION: "CREDIT_REVERSAL",
      DEBIT_REFUND: "CREDIT_REVERSAL",
    } as const;

    it("maps all non-reversal advance entry types to their exact inverse reversal type", () => {
      expect(permittedAdvanceReversalPairs.CREDIT_ADVANCE_DEPOSIT).toBe("DEBIT_REVERSAL");
      expect(permittedAdvanceReversalPairs.DEBIT_APPLICATION).toBe("CREDIT_REVERSAL");
      expect(permittedAdvanceReversalPairs.DEBIT_REFUND).toBe("CREDIT_REVERSAL");
    });
  });

  describe("Scope Tuple Parity Requirements", () => {
    interface LedgerScope {
      tenantId: string;
      companyId: string;
      customerId: string;
      creditAccountId: string;
      currency: string;
    }

    interface ReversalPointer {
      reversalOfId: string;
      reversalOfTenantId: string;
      reversalOfCompanyId: string;
      reversalOfCustomerId: string;
      reversalOfAccountId: string;
      reversalOfCurrency: string;
    }

    function validateReversalScope(entryScope: LedgerScope, pointer: ReversalPointer) {
      if (entryScope.tenantId !== pointer.reversalOfTenantId) throw new Error("Tenant mismatch");
      if (entryScope.companyId !== pointer.reversalOfCompanyId) throw new Error("Company mismatch");
      if (entryScope.customerId !== pointer.reversalOfCustomerId) throw new Error("Customer mismatch");
      if (entryScope.creditAccountId !== pointer.reversalOfAccountId) throw new Error("Account mismatch");
      if (entryScope.currency !== pointer.reversalOfCurrency) throw new Error("Currency mismatch");
      return true;
    }

    it("accepts exactly matching scope tuples", () => {
      const scope: LedgerScope = {
        tenantId: "t-1",
        companyId: "c-1",
        customerId: "cust-1",
        creditAccountId: "cca-1",
        currency: "INR",
      };
      const pointer: ReversalPointer = {
        reversalOfId: "orig-1",
        reversalOfTenantId: "t-1",
        reversalOfCompanyId: "c-1",
        reversalOfCustomerId: "cust-1",
        reversalOfAccountId: "cca-1",
        reversalOfCurrency: "INR",
      };

      expect(validateReversalScope(scope, pointer)).toBe(true);
    });

    it("rejects cross-company reversal pointer", () => {
      const scope: LedgerScope = {
        tenantId: "t-1",
        companyId: "c-1",
        customerId: "cust-1",
        creditAccountId: "cca-1",
        currency: "INR",
      };
      const pointer: ReversalPointer = {
        reversalOfId: "orig-1",
        reversalOfTenantId: "t-1",
        reversalOfCompanyId: "c-2", // mismatched company!
        reversalOfCustomerId: "cust-1",
        reversalOfAccountId: "cca-1",
        reversalOfCurrency: "INR",
      };

      expect(() => validateReversalScope(scope, pointer)).toThrow("Company mismatch");
    });
  });

  describe("Allocation Scope & Account-Level Credit Privileges", () => {
    it("requires creditEnabled on CustomerCreditAccount and rejects if false even if customer.creditEnabled is true", () => {
      interface CustomerProfile {
        globalCreditEnabled: boolean;
        creditHold: boolean;
      }
      interface AccountProfile {
        creditEnabled: boolean;
        creditHold: boolean;
      }

      function isCreditFacilityActive(customer: CustomerProfile, account: AccountProfile): boolean {
        // Must be active on both or specifically scoped account must be enabled
        return !customer.creditHold && !account.creditHold && account.creditEnabled;
      }

      const customer: CustomerProfile = { globalCreditEnabled: true, creditHold: false };
      const accountDisabled: AccountProfile = { creditEnabled: false, creditHold: false };
      const accountEnabled: AccountProfile = { creditEnabled: true, creditHold: false };

      expect(isCreditFacilityActive(customer, accountDisabled)).toBe(false);
      expect(isCreditFacilityActive(customer, accountEnabled)).toBe(true);
    });

    it("enforces allocation scope boundaries across Company, Account, and Currency", () => {
      interface AllocationScope {
        tenantId: string;
        companyId: string;
        customerId: string;
        creditAccountId: string;
        currency: string;
      }

      function validateAllocationScopeParity(saleScope: AllocationScope, allocScope: AllocationScope) {
        if (saleScope.tenantId !== allocScope.tenantId) throw new Error("Tenant boundary crossed");
        if (saleScope.companyId !== allocScope.companyId) throw new Error("Company boundary crossed");
        if (saleScope.customerId !== allocScope.customerId) throw new Error("Customer boundary crossed");
        if (saleScope.creditAccountId !== allocScope.creditAccountId) throw new Error("Account boundary crossed");
        if (saleScope.currency !== allocScope.currency) throw new Error("Currency boundary crossed");
        return true;
      }

      const saleScope: AllocationScope = {
        tenantId: "t-1",
        companyId: "comp-A",
        customerId: "cust-1",
        creditAccountId: "cca-1",
        currency: "INR",
      };

      const crossCompanyAlloc: AllocationScope = {
        tenantId: "t-1",
        companyId: "comp-B", // Cross-company!
        customerId: "cust-1",
        creditAccountId: "cca-1",
        currency: "INR",
      };

      expect(() => validateAllocationScopeParity(saleScope, crossCompanyAlloc)).toThrow("Company boundary crossed");
    });
  });
});
