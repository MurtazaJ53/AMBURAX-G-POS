import { describe, expect, it, vi } from "vitest";
import { postOnAccountCreditSale } from "@/server/khata/creditSalePosting";
import type { PostOnAccountCreditSaleInput } from "@/server/khata/creditSalePosting";

describe("postOnAccountCreditSale Unit & Eligibility Tests", () => {
  const baseInput: PostOnAccountCreditSaleInput = {
    tenantId: "t1",
    saleId: "sale1",
    actorUserId: "u1",
    idempotencyKey: "idem1",
  };

  const validSale = {
    id: "sale1",
    tenantId: "t1",
    storeId: "store1",
    companyId: "comp1",
    currencySnapshot: "INR",
    effectiveTermsDaysSnapshot: 30,
    dueDateSnapshot: new Date("2026-11-15T00:00:00.000Z"),
    status: "COMPLETED",
    totalMinor: 10000,
    paidMinor: 0,
    initialOnAccountMinor: 10000,
    customerId: "cust1",
    store: {
      id: "store1",
      companyId: "comp1",
      currency: "INR",
    },
    customer: {
      id: "cust1",
      isActive: true,
      phoneVerifiedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  };

  const validCreditAccount = {
    id: "cca1",
    tenantId: "t1",
    companyId: "comp1",
    customerId: "cust1",
    currency: "INR",
    creditLimitMinor: 50000,
    creditEnabled: true,
    creditHold: false,
    // LIMITED at 50000: the mode limit, not legacy `creditLimitMinor`, is what limit tests exercise.
    creditMode: "LIMITED",
    creditModeLimitMinor: 50000,
  };

  /** Fresh-posting mock: account lock, then ledger sums, then overdue query (none). */
  function freshTx(account: Record<string, unknown>, owedMinor: bigint) {
    const create = vi.fn().mockResolvedValue({ id: "kre_new_entry" });
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) }, // posts 10000
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
      outboxEvent: { create: vi.fn() },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([account])
        .mockResolvedValueOnce([{ debitSum: owedMinor, creditSum: 0n }])
        .mockResolvedValueOnce([]),
    };
    return { mockTx, create };
  }

  describe("credit mode is the authority for UNLIMITED and LIMITED", () => {
    it("UNLIMITED posts regardless of legacy creditEnabled and legacy limit, with no available-credit figure", async () => {
      const { mockTx, create } = freshTx(
        { ...validCreditAccount, creditMode: "UNLIMITED", creditModeLimitMinor: null, creditEnabled: false, creditLimitMinor: 1 },
        9_000_000n,
      );
      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res).toMatchObject({ status: "success", currentReceivableMinor: 9_010_000, availableCreditMinor: null });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("UNLIMITED posts when the legacy limit is null", async () => {
      const { mockTx } = freshTx(
        { ...validCreditAccount, creditMode: "UNLIMITED", creditModeLimitMinor: null, creditLimitMinor: null },
        0n,
      );
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "success", availableCreditMinor: null });
    });

    it("LIMITED allows exposure exactly at the mode limit", async () => {
      const { mockTx, create } = freshTx({ ...validCreditAccount, creditModeLimitMinor: 25_000 }, 15_000n);
      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res).toMatchObject({ status: "success", currentReceivableMinor: 25_000, availableCreditMinor: 0 });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("LIMITED refuses exposure one minor unit over the mode limit, writing nothing", async () => {
      const { mockTx, create } = freshTx({ ...validCreditAccount, creditModeLimitMinor: 24_999 }, 15_000n);
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "rejected", code: "credit_limit_exceeded" });
      expect(create).not.toHaveBeenCalled();
      expect(mockTx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it("LIMITED ignores a larger legacy limit", async () => {
      const { mockTx, create } = freshTx({ ...validCreditAccount, creditModeLimitMinor: 12_000, creditLimitMinor: 9_999_999 }, 5_000n);
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "rejected", code: "credit_limit_exceeded" });
      expect(create).not.toHaveBeenCalled();
    });

    it("LIMITED ignores a smaller, zero or missing legacy limit", async () => {
      for (const legacy of [1, 0, null]) {
        const { mockTx } = freshTx({ ...validCreditAccount, creditModeLimitMinor: 50_000, creditLimitMinor: legacy }, 0n);
        expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "success", availableCreditMinor: 40_000 });
      }
    });

    it("hold still refuses an UNLIMITED account, writing nothing", async () => {
      const { mockTx, create } = freshTx({ ...validCreditAccount, creditMode: "UNLIMITED", creditModeLimitMinor: null, creditHold: true }, 0n);
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "rejected", code: "credit_account_on_hold" });
      expect(create).not.toHaveBeenCalled();
    });

    it("an overdue balance still refuses an UNLIMITED account, writing nothing", async () => {
      const create = vi.fn();
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ ...validCreditAccount, creditMode: "UNLIMITED", creditModeLimitMinor: null }])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([{ saleId: "old_sale", initialOnAccountMinor: 5000, outstandingMinor: 5000 }]),
      };
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "rejected", code: "overdue_balance_exists" });
      expect(create).not.toHaveBeenCalled();
    });

    it("an unverified phone still refuses an UNLIMITED account before any account read", async () => {
      const { mockTx, create } = freshTx({ ...validCreditAccount, creditMode: "UNLIMITED", creditModeLimitMinor: null }, 0n);
      mockTx.sale.findUnique.mockResolvedValue({ ...validSale, customer: { ...validSale.customer, phoneVerifiedAt: null } });
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "rejected", code: "customer_phone_unverified" });
      expect(create).not.toHaveBeenCalled();
      expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe("credit mode gate fails closed", () => {
    const blockingModes: Array<[string, Record<string, unknown>]> = [
      ["BLOCKED", { creditMode: "BLOCKED", creditModeLimitMinor: null }],
      ["a missing mode", { creditMode: undefined, creditModeLimitMinor: undefined }],
      ["a null mode", { creditMode: null, creditModeLimitMinor: null }],
      ["an unknown mode", { creditMode: "OPEN", creditModeLimitMinor: null }],
      ["LIMITED without a limit", { creditMode: "LIMITED", creditModeLimitMinor: null }],
      ["LIMITED with a zero limit", { creditMode: "LIMITED", creditModeLimitMinor: 0 }],
      ["UNLIMITED carrying a limit", { creditMode: "UNLIMITED", creditModeLimitMinor: 500 }],
    ];

    it.each(blockingModes)("rejects a fresh posting under %s with no ledger or outbox write", async (_label, mode) => {
      const create = vi.fn();
      const outboxCreate = vi.fn();
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create,
        },
        outboxEvent: { create: outboxCreate },
        $queryRaw: vi.fn().mockResolvedValue([{ ...validCreditAccount, ...mode }]),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res).toMatchObject({ status: "rejected", code: "credit_mode_blocked" });
      expect(create).not.toHaveBeenCalled();
      expect(outboxCreate).not.toHaveBeenCalled();
      // Only the account lock ran; no ledger sums or overdue queries followed.
      expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("rejects BLOCKED even when the legacy flag and limit would allow it", async () => {
      const create = vi.fn();
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create,
        },
        $queryRaw: vi.fn().mockResolvedValue([
          { ...validCreditAccount, creditEnabled: true, creditLimitMinor: 999_999, creditMode: "BLOCKED", creditModeLimitMinor: null },
        ]),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res).toMatchObject({ status: "rejected", code: "credit_mode_blocked" });
      expect(create).not.toHaveBeenCalled();
    });

    it.each(blockingModes)("rejects an idempotent replay under %s with no write", async (_label, mode) => {
      const create = vi.fn();
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            id: "rec-existing",
            tenantId: "t1",
            companyId: "comp1",
            customerId: "cust1",
            creditAccountId: "cca1",
            currency: "INR",
            entryType: "DEBIT_CREDIT_SALE",
            amountMinor: 10000,
            saleId: "sale1",
            paymentAllocationId: null,
            allocationId: null,
            saleReturnId: null,
            reversalOfId: null,
            reversalOfTenantId: null,
            reversalOfCompanyId: null,
            reversalOfCustomerId: null,
            reversalOfAccountId: null,
            reversalOfCurrency: null,
          }),
          create,
        },
        customerCreditAccount: { findUnique: vi.fn().mockResolvedValue({ ...validCreditAccount, ...mode }) },
        $queryRaw: vi.fn(),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res).toMatchObject({ status: "rejected", code: "credit_mode_blocked" });
      expect(create).not.toHaveBeenCalled();
      expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it("throws error if root PrismaClient is passed instead of interactive TransactionClient", async () => {
    const mockRootClient: any = {
      $transaction: vi.fn(),
      sale: { findUnique: vi.fn() },
    };

    await expect(postOnAccountCreditSale(mockRootClient, baseInput)).rejects.toThrow(
      "postOnAccountCreditSale requires an interactive transaction"
    );
  });

  it("rejects when sale is not found", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("sale_not_found");
    }
  });

  it("rejects when sale is not COMPLETED", async () => {
    const mockTx: any = {
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          ...validSale,
          status: "DRAFT",
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("sale_not_completed");
    }
  });

  it("rejects when sale is missing companyId or currencySnapshot", async () => {
    const mockTx: any = {
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          ...validSale,
          companyId: null,
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("sale_missing_scope");
    }
  });

  it("rejects when store and sale company scope mismatch", async () => {
    const mockTx: any = {
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          ...validSale,
          store: {
            id: "store1",
            companyId: "comp_different",
            currency: "INR",
          },
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("sale_store_scope_mismatch");
    }
  });

  it("rejects when customer is inactive", async () => {
    const mockTx: any = {
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          ...validSale,
          customer: {
            ...validSale.customer,
            isActive: false,
          },
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("customer_inactive");
    }
  });

  it("rejects when customer phone is unverified", async () => {
    const mockTx: any = {
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          ...validSale,
          customer: {
            ...validSale.customer,
            phoneVerifiedAt: null,
          },
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("customer_phone_unverified");
    }
  });

  it("legacy creditEnabled=false no longer blocks a LIMITED account within its mode limit", async () => {
    const { mockTx, create } = freshTx({ ...validCreditAccount, creditEnabled: false }, 0n);
    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res).toMatchObject({ status: "success", availableCreditMinor: 40_000 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects when credit account is on administrative hold", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          ...validCreditAccount,
          creditHold: true,
        },
      ]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("credit_account_on_hold");
    }
  });

  it("rejects when customer has overdue balance", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $queryRaw: vi
        .fn()
        // 1. Account lock query
        .mockResolvedValueOnce([validCreditAccount])
        // 2. Current receivable sum query
        .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
        // 3. Overdue sales query (finds overdue row)
        .mockResolvedValueOnce([{ saleId: "old_sale", initialOnAccountMinor: 5000, outstandingMinor: 5000 }]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("overdue_balance_exists");
    }
  });

  it("rejects when new credit exposure exceeds credit limit", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) }, // amountMinor: 10000
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $queryRaw: vi
        .fn()
        // 1. Account lock query (mode limit: 15000)
        .mockResolvedValueOnce([{ ...validCreditAccount, creditModeLimitMinor: 15000 }])
        // 2. Current receivable sum query (already owes 10000 -> new total 20000 > 15000)
        .mockResolvedValueOnce([{ debitSum: 10000n, creditSum: 0n }])
        // 3. Overdue sales query (none)
        .mockResolvedValueOnce([]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("credit_limit_exceeded");
    }
  });

  it("rejects and fails closed when ledger is in inconsistent state (credits > debits)", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $queryRaw: vi
        .fn()
        // 1. Account lock query
        .mockResolvedValueOnce([validCreditAccount])
        // 2. Current receivable sum query: debits 5000, credits 8000 -> credits > debits!
        .mockResolvedValueOnce([{ debitSum: 5000n, creditSum: 8000n }]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("inconsistent_ledger_state");
      expect(res.reason).toContain("credits (8000) exceed debits (5000)");
    }
  });

  it("rejects when ledger balances exceed MAX_SAFE_INTEGER bounds", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $queryRaw: vi
        .fn()
        // 1. Account lock query
        .mockResolvedValueOnce([validCreditAccount])
        // 2. Huge raw sum exceeding Number.MAX_SAFE_INTEGER
        .mockResolvedValueOnce([{ debitSum: BigInt(Number.MAX_SAFE_INTEGER) + 100n, creditSum: 0n }]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("inconsistent_ledger_state");
      expect(res.reason).toContain("exceeds safe integer bounds");
    }
  });

  it("succeeds on valid posting within limit", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "kre_new_entry" }),
      },
      $queryRaw: vi
        .fn()
        // 1. Account lock query (limit: 50000)
        .mockResolvedValueOnce([validCreditAccount])
        // 2. Current receivable sum query (owes 5000)
        .mockResolvedValueOnce([{ debitSum: 5000n, creditSum: 0n }])
        // 3. Overdue query (none)
        .mockResolvedValueOnce([]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.receivableEntryId).toBe("kre_new_entry");
      expect(res.idempotentReplay).toBe(false);
      expect(res.currentReceivableMinor).toBe(15000); // 5000 + 10000
      expect(res.availableCreditMinor).toBe(35000); // 50000 - 15000
      expect(res.originalPostedAmountMinor).toBe(10000);
    }
  });

  describe("Idempotent replay failure and safety paths", () => {
    const existingReplayEntry = {
      id: "kre_original_entry",
      tenantId: "t1",
      companyId: "comp1",
      customerId: "cust1",
      creditAccountId: "cca1",
      currency: "INR",
      entryType: "DEBIT_CREDIT_SALE",
      amountMinor: 10000,
      saleId: "sale1",
      paymentAllocationId: null,
      allocationId: null,
      saleReturnId: null,
      reversalOfId: null,
      reversalOfTenantId: null,
      reversalOfCompanyId: null,
      reversalOfCustomerId: null,
      reversalOfAccountId: null,
      reversalOfCurrency: null,
    };

    it("returns truthful current balances and originalPostedAmountMinor on valid replay", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(existingReplayEntry),
        },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue(validCreditAccount),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ debitSum: 10000n, creditSum: 2000n }]),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("success");
      if (res.status === "success") {
        expect(res.receivableEntryId).toBe("kre_original_entry");
        expect(res.idempotentReplay).toBe(true);
        expect(res.currentReceivableMinor).toBe(8000);
        expect(res.availableCreditMinor).toBe(42000);
        expect(res.originalPostedAmountMinor).toBe(10000);
      }
    });

    it("rejects replay when credit account does not exist", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(existingReplayEntry),
        },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("credit_account_not_found");
      }
    });

    it("rejects replay when credit account scope mismatches", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(existingReplayEntry),
        },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue({
            ...validCreditAccount,
            companyId: "diff_company",
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("credit_account_not_found");
        expect(res.reason).toContain("scope mismatch");
      }
    });

    it("replay ignores legacy creditEnabled=false", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: { findUnique: vi.fn().mockResolvedValue(existingReplayEntry) },
        customerCreditAccount: { findUnique: vi.fn().mockResolvedValue({ ...validCreditAccount, creditEnabled: false }) },
        $queryRaw: vi.fn().mockResolvedValueOnce([{ debitSum: 10000n, creditSum: 0n }]),
      };
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "success", idempotentReplay: true, availableCreditMinor: 40_000 });
    });

    it("replay of an UNLIMITED account reports no available-credit figure", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: { findUnique: vi.fn().mockResolvedValue(existingReplayEntry) },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue({ ...validCreditAccount, creditMode: "UNLIMITED", creditModeLimitMinor: null }),
        },
        $queryRaw: vi.fn().mockResolvedValueOnce([{ debitSum: 10000n, creditSum: 0n }]),
      };
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "success", availableCreditMinor: null });
    });

    it("rejects replay when credit account is on hold", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(existingReplayEntry),
        },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue({
            ...validCreditAccount,
            creditHold: true,
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("credit_account_on_hold");
      }
    });

    it("replay ignores a non-positive legacy limit and uses the mode limit", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: { findUnique: vi.fn().mockResolvedValue(existingReplayEntry) },
        customerCreditAccount: { findUnique: vi.fn().mockResolvedValue({ ...validCreditAccount, creditLimitMinor: 0 }) },
        $queryRaw: vi.fn().mockResolvedValueOnce([{ debitSum: 10000n, creditSum: 0n }]),
      };
      expect(await postOnAccountCreditSale(mockTx, baseInput)).toMatchObject({ status: "success", availableCreditMinor: 40_000 });
    });

    it("fails closed on replay when ledger state is inconsistent (credits > debits)", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(existingReplayEntry),
        },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue(validCreditAccount),
        },
        $queryRaw: vi
          .fn()
          // Replay sums query: debits 2000, credits 8000 -> credits > debits!
          .mockResolvedValueOnce([{ debitSum: 2000n, creditSum: 8000n }]),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("inconsistent_ledger_state");
        expect(res.reason).toContain("credits (8000) exceed debits (2000)");
      }
    });

    it("fails closed on replay when ledger sums exceed MAX_SAFE_INTEGER bounds", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(existingReplayEntry),
        },
        customerCreditAccount: {
          findUnique: vi.fn().mockResolvedValue(validCreditAccount),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ debitSum: BigInt(Number.MAX_SAFE_INTEGER) + 500n, creditSum: 0n }]),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("inconsistent_ledger_state");
        expect(res.reason).toContain("exceeds safe integer bounds");
      }
    });

    it("rejects with idempotency_conflict when existing row is CREDIT_REPAYMENT", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingReplayEntry,
            entryType: "CREDIT_REPAYMENT",
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
      }
    });

    it("rejects with idempotency_conflict when existing row is CREDIT_SALE_RETURN", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingReplayEntry,
            entryType: "CREDIT_SALE_RETURN",
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
      }
    });

    it("rejects with idempotency_conflict when existing row is CREDIT_REVERSAL or DEBIT_REVERSAL", async () => {
      for (const reversalType of ["CREDIT_REVERSAL", "DEBIT_REVERSAL"]) {
        const mockTx: any = {
          sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
          khataReceivableEntry: {
            findUnique: vi.fn().mockResolvedValue({
              ...existingReplayEntry,
              entryType: reversalType,
            }),
          },
        };

        const res = await postOnAccountCreditSale(mockTx, baseInput);
        expect(res.status).toBe("rejected");
        if (res.status === "rejected") {
          expect(res.code).toBe("idempotency_conflict");
        }
      }
    });

    it("rejects with idempotency_conflict when existing row currency mismatches sale currency", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingReplayEntry,
            currency: "USD",
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
      }
    });

    it("rejects with idempotency_conflict when existing row amountMinor mismatches", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingReplayEntry,
            amountMinor: 5000,
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
      }
    });

    it("rejects with idempotency_conflict when existing row has conflicting source links (paymentAllocationId, allocationId, saleReturnId)", async () => {
      const conflictingLinkProps = [
        { paymentAllocationId: "pa_conflicting" },
        { allocationId: "alloc_conflicting" },
        { saleReturnId: "ret_conflicting" },
      ];

      for (const prop of conflictingLinkProps) {
        const mockTx: any = {
          sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
          khataReceivableEntry: {
            findUnique: vi.fn().mockResolvedValue({
              ...existingReplayEntry,
              ...prop,
            }),
          },
        };

        const res = await postOnAccountCreditSale(mockTx, baseInput);
        expect(res.status).toBe("rejected");
        if (res.status === "rejected") {
          expect(res.code).toBe("idempotency_conflict");
        }
      }
    });

    it("rejects with idempotency_conflict when existing row has conflicting reversal linkage (reversalOfId)", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingReplayEntry,
            reversalOfId: "parent_entry_1",
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
      }
    });

    it("rejects with idempotency_conflict when existing row is missing creditAccountId", async () => {
      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue({
            ...existingReplayEntry,
            creditAccountId: "",
          }),
        },
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
      }
    });
  });

  describe("P2002 Unique Constraint Narrowing", () => {
    it("maps recognized idempotency-key P2002 violation (array ['tenantId', 'idempotencyKey']) to idempotency_conflict", async () => {
      const p2002IdemError: any = new Error("Unique constraint failed");
      p2002IdemError.code = "P2002";
      p2002IdemError.meta = { target: ["tenantId", "idempotencyKey"] };

      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(p2002IdemError),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([validCreditAccount])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([]),
      };

      const res = await postOnAccountCreditSale(mockTx, baseInput);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.code).toBe("idempotency_conflict");
        expect(res.reason).toContain("A unique constraint conflict occurred");
      }
    });

    it("maps recognized idempotency-key P2002 violation (string targets) to idempotency_conflict", async () => {
      for (const targetName of [
        "tenantId_idempotencyKey",
        "khata_receivable_entries_tenantId_idempotencyKey_key",
      ]) {
        const p2002StringError: any = new Error(`Unique constraint failed on ${targetName}`);
        p2002StringError.code = "P2002";
        p2002StringError.meta = { target: targetName };

        const mockTx: any = {
          sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
          khataReceivableEntry: {
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockRejectedValue(p2002StringError),
          },
          $queryRaw: vi
            .fn()
            .mockResolvedValueOnce([validCreditAccount])
            .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
            .mockResolvedValueOnce([]),
        };

        const res = await postOnAccountCreditSale(mockTx, baseInput);
        expect(res.status).toBe("rejected");
        if (res.status === "rejected") {
          expect(res.code).toBe("idempotency_conflict");
          expect(res.reason).toContain("A unique constraint conflict occurred");
        }
      }
    });

    it("re-throws P2002 on saleId-only target (['saleId']) unchanged", async () => {
      const p2002SaleIdError: any = new Error("Unique constraint failed on saleId");
      p2002SaleIdError.code = "P2002";
      p2002SaleIdError.meta = { target: ["saleId"] };

      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(p2002SaleIdError),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([validCreditAccount])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([]),
      };

      await expect(postOnAccountCreditSale(mockTx, baseInput)).rejects.toThrow(p2002SaleIdError);
    });

    it("re-throws P2002 on unrelated composite target containing saleId (['tenantId', 'saleId']) unchanged", async () => {
      const p2002CompositeSaleError: any = new Error("Unique constraint failed on tenantId_saleId");
      p2002CompositeSaleError.code = "P2002";
      p2002CompositeSaleError.meta = { target: ["tenantId", "saleId"] };

      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(p2002CompositeSaleError),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([validCreditAccount])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([]),
      };

      await expect(postOnAccountCreditSale(mockTx, baseInput)).rejects.toThrow(p2002CompositeSaleError);
    });

    it("re-throws P2002 on unrelated composite target (['tenantId', 'companyId', 'customerId']) unchanged", async () => {
      const p2002AccountCompositeError: any = new Error("Unique constraint failed on tenantId_companyId_customerId");
      p2002AccountCompositeError.code = "P2002";
      p2002AccountCompositeError.meta = { target: ["tenantId", "companyId", "customerId"] };

      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(p2002AccountCompositeError),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([validCreditAccount])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([]),
      };

      await expect(postOnAccountCreditSale(mockTx, baseInput)).rejects.toThrow(p2002AccountCompositeError);
    });

    it("re-throws unrelated P2002 violation (e.g. target is ['id'])", async () => {
      const p2002UnrelatedError: any = new Error("Unique constraint failed on ID");
      p2002UnrelatedError.code = "P2002";
      p2002UnrelatedError.meta = { target: ["id"] };

      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(p2002UnrelatedError),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([validCreditAccount])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([]),
      };

      await expect(postOnAccountCreditSale(mockTx, baseInput)).rejects.toThrow(p2002UnrelatedError);
    });

    it("re-throws non-P2002 database errors unchanged", async () => {
      const dbError: any = new Error("Connection lost");
      dbError.code = "P2025";

      const mockTx: any = {
        sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
        khataReceivableEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(dbError),
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([validCreditAccount])
          .mockResolvedValueOnce([{ debitSum: 0n, creditSum: 0n }])
          .mockResolvedValueOnce([]),
      };

      await expect(postOnAccountCreditSale(mockTx, baseInput)).rejects.toThrow(dbError);
    });
  });

  it("rejects conflicting reuse of idempotencyKey for different sale", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue({
          id: "kre_other_entry",
          saleId: "sale_different",
          companyId: "comp1",
          customerId: "cust1",
          amountMinor: 10000,
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("idempotency_conflict");
    }
  });

  it("rejects when sale has already been posted to Khata (pre-lock check)", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({
          id: "existing_posting_id",
          saleId: "sale1",
          entryType: "DEBIT_CREDIT_SALE",
        }),
      },
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("idempotency_conflict");
      expect(res.reason).toContain("has already been posted");
    }
  });

  it("rejects when concurrent transaction posted same sale (in-lock re-check)", async () => {
    const mockTx: any = {
      sale: { findUnique: vi.fn().mockResolvedValue(validSale) },
      khataReceivableEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "concurrent_posting_id",
            saleId: "sale1",
            entryType: "DEBIT_CREDIT_SALE",
          }),
      },
      $queryRaw: vi.fn().mockResolvedValueOnce([validCreditAccount]),
    };

    const res = await postOnAccountCreditSale(mockTx, baseInput);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") {
      expect(res.code).toBe("idempotency_conflict");
      expect(res.reason).toContain("concurrent_posting_id");
    }
  });
});
