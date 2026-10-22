/**
 * Retail & Wholesale Festival Planner
 * Analyzes previous festive seasons (Diwali, Navratri, Eid, Wedding Season)
 * to forecast procurement quantities, lead times, and promotional calendar.
 */

export interface HistoricalFestivalSales {
  festivalName: string; // "Diwali", "Navratri", "Wedding Season", "Eid"
  year: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  categorySales: {
    category: string; // "Kurta Pajama", "Sarees", "Sherwani", "Lehenga", "Formal Shirts"
    unitsSold: number;
    revenue: number;
  }[];
  peakDayDate: string;
}

export interface UpcomingFestivalTarget {
  festivalName: string;
  targetYear: number;
  startDate: string; // YYYY-MM-DD
  expectedGrowthRatePercent: number; // e.g. 15 for 15% YoY growth
  procurementLeadTimeWeeks: number; // e.g. 4-6 weeks before festival
}

export interface FestivalPlanRecommendation {
  festivalName: string;
  targetYear: number;
  orderDeadlineDate: string; // When owner must issue POs to mills/manufacturers
  promoCampaignStartDate: string; // When customer WhatsApp/SMS blast should launch
  recommendedStockBudget: number;
  categoryProjections: {
    category: string;
    forecastUnits: number;
    projectedRevenue: number;
    recommendedProcurementDate: string;
  }[];
  marketingStrategy: string[];
}

export function generateFestivalPlan(
  historical: HistoricalFestivalSales[],
  target: UpcomingFestivalTarget
): FestivalPlanRecommendation {
  // Find matching festival from previous years
  const matchingPastFestivals = historical.filter(
    (h) => h.festivalName.toLowerCase() === target.festivalName.toLowerCase()
  );

  const growthFactor = 1 + target.expectedGrowthRatePercent / 100;

  // Calculate start dates
  const festivalStart = new Date(target.startDate);
  
  // Order deadline = Start Date minus lead time
  const orderDeadline = new Date(festivalStart);
  orderDeadline.setDate(orderDeadline.getDate() - target.procurementLeadTimeWeeks * 7);

  // Promo campaign launch = 2 weeks before festival
  const promoLaunch = new Date(festivalStart);
  promoLaunch.setDate(promoLaunch.getDate() - 14);

  // Group past sales by category
  const categoryTotals: Record<string, { units: number; rev: number; count: number }> = {};
  for (const f of matchingPastFestivals) {
    for (const cat of f.categorySales) {
      if (!categoryTotals[cat.category]) {
        categoryTotals[cat.category] = { units: 0, rev: 0, count: 0 };
      }
      const entry = categoryTotals[cat.category]!;
      entry.units += cat.unitsSold;
      entry.rev += cat.revenue;
      entry.count += 1;
    }
  }

  let totalProjectedBudget = 0;
  const categoryProjections = Object.entries(categoryTotals).map(([catName, data]) => {
    const avgUnits = data.units / data.count;
    const avgRev = data.rev / data.count;

    const forecastUnits = Math.round(avgUnits * growthFactor);
    const projectedRevenue = Math.round(avgRev * growthFactor);
    totalProjectedBudget += projectedRevenue * 0.55; // 55% estimated COGS

    return {
      category: catName,
      forecastUnits,
      projectedRevenue,
      recommendedProcurementDate: orderDeadline.toISOString().slice(0, 10),
    };
  });

  return {
    festivalName: target.festivalName,
    targetYear: target.targetYear,
    orderDeadlineDate: orderDeadline.toISOString().slice(0, 10),
    promoCampaignStartDate: promoLaunch.toISOString().slice(0, 10),
    recommendedStockBudget: Math.round(totalProjectedBudget),
    categoryProjections,
    marketingStrategy: [
      `Launch VIP customer sneak-peek offers 10 days before ${target.festivalName}.`,
      `Offer bundled accessories (matching dupattas, stoles, brooch) for high-ticket ethnic wear.`,
      `Implement late-night extended billing counters 3 days prior to peak festival date.`,
    ],
  };
}
