/**
 * Promotion & Scheme Evaluation Engine (Track 2)
 *
 * Supports:
 * 1. BOGO (Buy X Get Y Free)
 * 2. Tiered Cart Spend Discount (e.g. Spend ₹3000 get ₹500 off)
 * 3. Quantity Pack Discounts (e.g. Buy 3 for ₹999)
 */

export interface PromotionRule {
  id: string;
  name: string;
  type: "BOGO" | "TIERED_SPEND" | "PACK_DISCOUNT";
  description: string;
  active: boolean;
  // BOGO configuration
  buyQty?: number;
  getQty?: number;
  // Tiered Spend configuration
  minSpendMinor?: number;
  discountMinor?: number;
  // Pack configuration
  packQty?: number;
  packPriceMinor?: number;
  // Applicable variants or categories (empty means store-wide)
  applicableCategory?: string | null;
  applicableVariantIds?: string[];
}

export const DEFAULT_PROMOTIONS: PromotionRule[] = [
  {
    id: "promo-bogo-festive",
    name: "Buy 2 Get 1 Free (Selected Garments)",
    type: "BOGO",
    description: "Buy any 2 apparel pieces and get the 3rd lowest priced piece free.",
    active: false,
    buyQty: 2,
    getQty: 1,
    applicableCategory: "Apparel",
  },
  {
    id: "promo-festive-spend",
    name: "Festival Cart Bonanza",
    type: "TIERED_SPEND",
    description: "Shop for ₹3,000 or more and get instant ₹400 off at counter.",
    active: false,
    minSpendMinor: 300_000, // ₹3,000
    discountMinor: 40_000,  // ₹400
  },
  {
    id: "promo-combo-pack",
    name: "Summer Pack: Buy 3 for ₹999",
    type: "PACK_DISCOUNT",
    description: "Any 3 essentials for flat ₹999 instead of MRP.",
    active: false,
    packQty: 3,
    packPriceMinor: 99_900, // ₹999
  },
];

export interface PromotionEvaluationResult {
  promotionsApplied: {
    ruleId: string;
    ruleName: string;
    discountMinor: number;
    description: string;
  }[];
  totalPromoDiscountMinor: number;
}

export interface PromoCartItem {
  variantId: string;
  category?: string | null;
  quantity: number;
  unitPriceMinor: number;
}

/**
 * Evaluates active promotions against the cashier's cart items.
 * If selectedOfferId is passed, only that chosen offer is applied (single offer mode).
 * If selectedOfferId is null or not passed and allowStacking is false (default: false),
 * it selects the single best qualifying offer for the bill.
 */
export function evaluatePromotions(
  cart: PromoCartItem[],
  rules: PromotionRule[] = DEFAULT_PROMOTIONS,
  options?: {
    selectedOfferId?: string | null;
    allowStacking?: boolean;
  }
): PromotionEvaluationResult {
  const activeRules = rules.filter((r) => r.active);
  // If explicitly cleared/set to "none" (e.g. for Udhar sales or when no offer should be given),
  // return zero applied promotions without stopping the store's global offers.
  if (options?.selectedOfferId === "none") {
    return {
      promotionsApplied: [],
      totalPromoDiscountMinor: 0,
    };
  }

  // If a specific offer was selected by the cashier or owner, filter to only that offer
  const eligibleRules = options?.selectedOfferId
    ? activeRules.filter((r) => r.id === options.selectedOfferId)
    : activeRules;

  const candidatePromotions: Array<{
    ruleId: string;
    ruleName: string;
    discountMinor: number;
    description: string;
  }> = [];

  const cartGrossMinor = cart.reduce((sum, it) => sum + it.unitPriceMinor * it.quantity, 0);

  for (const rule of eligibleRules) {
    if (rule.type === "TIERED_SPEND" && rule.minSpendMinor && rule.discountMinor) {
      if (cartGrossMinor >= rule.minSpendMinor) {
        candidatePromotions.push({
          ruleId: rule.id,
          ruleName: rule.name,
          discountMinor: rule.discountMinor,
          description: `Applied ₹${(rule.discountMinor / 100).toFixed(0)} off on orders over ₹${(
            rule.minSpendMinor / 100
          ).toFixed(0)}`,
        });
      }
    }

    if (rule.type === "BOGO" && rule.buyQty && rule.getQty) {
      // Find matching items
      const matchingItems: { unitPriceMinor: number }[] = [];
      for (const item of cart) {
        const matchesCategory =
          !rule.applicableCategory ||
          (item.category && item.category.toLowerCase() === rule.applicableCategory.toLowerCase());
        const matchesVariant =
          !rule.applicableVariantIds ||
          rule.applicableVariantIds.length === 0 ||
          rule.applicableVariantIds.includes(item.variantId);

        if (matchesCategory || matchesVariant) {
          for (let i = 0; i < item.quantity; i++) {
            matchingItems.push({ unitPriceMinor: item.unitPriceMinor });
          }
        }
      }

      const totalGroup = rule.buyQty + rule.getQty;
      const numSets = Math.floor(matchingItems.length / totalGroup);

      if (numSets > 0) {
        // Sort lowest price first to discount the free items
        matchingItems.sort((a, b) => a.unitPriceMinor - b.unitPriceMinor);
        let bogoDiscount = 0;
        const freeItemsCount = numSets * rule.getQty;
        for (let i = 0; i < freeItemsCount; i++) {
          bogoDiscount += matchingItems[i]?.unitPriceMinor || 0;
        }

        if (bogoDiscount > 0) {
          candidatePromotions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            discountMinor: bogoDiscount,
            description: `Applied free item(s) discount on ${numSets} set(s) of ${rule.buyQty}+${rule.getQty}`,
          });
        }
      }
    }
  }

  // If allowStacking is false (default), only ONE offer is applied to the bill.
  // Either the user's explicitly selected offer, or the best (highest discount) qualifying offer.
  const promotionsApplied = options?.allowStacking
    ? candidatePromotions
    : candidatePromotions.length > 0
    ? [candidatePromotions.sort((a, b) => b.discountMinor - a.discountMinor)[0]!]
    : [];

  const totalPromoDiscountMinor = promotionsApplied.reduce((sum, p) => sum + p.discountMinor, 0);

  return {
    promotionsApplied,
    totalPromoDiscountMinor,
  };
}
