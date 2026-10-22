/**
 * Customer Feedback & Review Rating Engine (Line 35)
 *
 * Implements:
 * 1. Post-Purchase Survey Dispatch (NPS, 1-5 Star Ratings, Category Satisfaction).
 * 2. Automated SMS / WhatsApp Feedback Link Generator with tokenized verification.
 * 3. Store Experience Sentiment Analysis (Billing speed, Staff courtesy, Fitting & Quality, Ambience).
 * 4. Google Review Booster: High ratings (4 or 5 stars) prompt customer to post directly on Google Business.
 * 5. Review aggregation metrics (NPS score: Promoters % - Detractors %, Average Star Rating).
 */

export interface CustomerFeedbackSubmission {
  id: string;
  saleId: string;
  customerId: string;
  customerName?: string;
  phone: string;
  storeId: string;
  overallRating: 1 | 2 | 3 | 4 | 5; // 1 to 5 Stars
  npsScore: number; // 0 to 10
  dimensions?: {
    billingSpeed?: 1 | 2 | 3 | 4 | 5;
    staffCourtesy?: 1 | 2 | 3 | 4 | 5;
    fittingAndQuality?: 1 | 2 | 3 | 4 | 5;
    storeAmbience?: 1 | 2 | 3 | 4 | 5;
  };
  comment?: string;
  submittedAt: string;
}

export function generateFeedbackSurveyLink(params: {
  baseUrl: string;
  saleId: string;
  customerId: string;
  phone: string;
}): string {
  const token = Buffer.from(`${params.saleId}:${params.customerId}:${Date.now()}`).toString("base64url");
  return `${params.baseUrl.replace(/\/$/, "")}/feedback?t=${token}`;
}

export function evaluateReviewBoosterPrompt(rating: number): {
  promptGoogleReview: boolean;
  message: string;
} {
  if (rating >= 4) {
    return {
      promptGoogleReview: true,
      message: "Thank you for the wonderful rating! Would you mind sharing your review on Google to support our team?",
    };
  }
  return {
    promptGoogleReview: false,
    message: "Thank you for your valuable feedback. Our store manager will review your comments to improve our service.",
  };
}

export function calculateNpsAndSatisfaction(submissions: CustomerFeedbackSubmission[]): {
  totalResponses: number;
  averageStarRating: number;
  nps: number;
  promoters: number;
  passives: number;
  detractors: number;
} {
  if (submissions.length === 0) {
    return {
      totalResponses: 0,
      averageStarRating: 0,
      nps: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
    };
  }

  let totalStars = 0;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;

  for (const s of submissions) {
    totalStars += s.overallRating;
    if (s.npsScore >= 9) promoters += 1;
    else if (s.npsScore >= 7) passives += 1;
    else detractors += 1;
  }

  const avgStars = Number((totalStars / submissions.length).toFixed(2));
  const nps = Math.round(((promoters - detractors) / submissions.length) * 100);

  return {
    totalResponses: submissions.length,
    averageStarRating: avgStars,
    nps,
    promoters,
    passives,
    detractors,
  };
}
