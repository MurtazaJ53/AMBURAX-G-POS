import { describe, it, expect } from "vitest";
import {
  generateFeedbackSurveyLink,
  evaluateReviewBoosterPrompt,
  calculateNpsAndSatisfaction,
  type CustomerFeedbackSubmission,
} from "@/server/loyalty/customerFeedback";

describe("Customer Feedback & Reviews Engine (Line 35)", () => {
  it("generates tokenized URL for customer SMS / WhatsApp feedback", () => {
    const link = generateFeedbackSurveyLink({
      baseUrl: "https://amburax.pos",
      saleId: "sale_992",
      customerId: "cust_441",
      phone: "9876543210",
    });

    expect(link.startsWith("https://amburax.pos/feedback?t=")).toBe(true);
  });

  it("triggers Google Review booster for 4-star and 5-star delighted customers", () => {
    const fiveStar = evaluateReviewBoosterPrompt(5);
    expect(fiveStar.promptGoogleReview).toBe(true);
    expect(fiveStar.message).toContain("Google");

    const twoStar = evaluateReviewBoosterPrompt(2);
    expect(twoStar.promptGoogleReview).toBe(false);
    expect(twoStar.message).toContain("store manager");
  });

  it("calculates Net Promoter Score (NPS) and Average Star rating accurately", () => {
    const sampleReviews: CustomerFeedbackSubmission[] = [
      {
        id: "fb_1",
        saleId: "s1",
        customerId: "c1",
        phone: "9876543210",
        storeId: "store_main",
        overallRating: 5,
        npsScore: 10, // Promoter
        submittedAt: new Date().toISOString(),
      },
      {
        id: "fb_2",
        saleId: "s2",
        customerId: "c2",
        phone: "9876543211",
        storeId: "store_main",
        overallRating: 4,
        npsScore: 9, // Promoter
        submittedAt: new Date().toISOString(),
      },
      {
        id: "fb_3",
        saleId: "s3",
        customerId: "c3",
        phone: "9876543212",
        storeId: "store_main",
        overallRating: 3,
        npsScore: 7, // Passive
        submittedAt: new Date().toISOString(),
      },
      {
        id: "fb_4",
        saleId: "s4",
        customerId: "c4",
        phone: "9876543213",
        storeId: "store_main",
        overallRating: 2,
        npsScore: 4, // Detractor
        submittedAt: new Date().toISOString(),
      },
    ];

    const stats = calculateNpsAndSatisfaction(sampleReviews);
    expect(stats.totalResponses).toBe(4);
    // Average: (5 + 4 + 3 + 2) / 4 = 3.5
    expect(stats.averageStarRating).toBe(3.5);
    // Promoters: 2 (50%), Passives: 1 (25%), Detractors: 1 (25%)
    // NPS = 50% - 25% = +25
    expect(stats.nps).toBe(25);
    expect(stats.promoters).toBe(2);
    expect(stats.detractors).toBe(1);
  });
});
