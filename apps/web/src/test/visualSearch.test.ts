import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  searchCatalogByVisualSimilarity,
  parseGarmentVisionInference,
  type GarmentVisualSignature,
} from "@/server/ai/visualSearch";

describe("Visual Search & AI Auto-Tagging Engine (Line 55 & Line 56)", () => {
  it("calculates exact cosine similarity between vector embeddings", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBe(1.0); // Identical
    expect(cosineSimilarity(v1, v3)).toBe(0.0); // Orthogonal
  });

  it("finds top visually matching garments ranked by cosine similarity", () => {
    const queryVector = [0.8, 0.2, 0.1, 0.5];

    const catalog: GarmentVisualSignature[] = [
      {
        productId: "p1",
        variantId: "v1",
        sku: "SHIRT-BLUE-SLIM",
        productName: "Sky Blue Slim Shirt",
        category: "Men Formal",
        colorFamily: "Blue",
        fabric: "Cotton",
        featureVector: [0.79, 0.21, 0.12, 0.49], // Very close match
      },
      {
        productId: "p2",
        variantId: "v2",
        sku: "JEANS-BLACK-REG",
        productName: "Black Denim Jeans",
        category: "Men Casual",
        colorFamily: "Black",
        fabric: "Denim",
        featureVector: [0.1, 0.9, 0.8, 0.1], // Distant match
      },
    ];

    const results = searchCatalogByVisualSimilarity(queryVector, catalog, 5, 0.7);
    expect(results.length).toBe(1);
    expect(results[0]?.sku).toBe("SHIRT-BLUE-SLIM");
    expect(results[0]?.similarityScore).toBeGreaterThan(0.99);
  });

  it("auto-tags garment category, fabric, and pattern from AI vision outputs", () => {
    const visionOutput = {
      detectedLabels: ["Clothing", "Denim Jeans", "Plaid", "Cotton blend", "Shirt"],
      dominantColors: ["Indigo", "White"],
    };

    const tagged = parseGarmentVisionInference(visionOutput);
    expect(tagged.fabricType).toBe("Denim");
    expect(tagged.pattern).toBe("CHECKED");
    expect(tagged.primaryColor).toBe("Indigo");
    expect(tagged.confidenceScore).toBe(0.92);
  });
});
