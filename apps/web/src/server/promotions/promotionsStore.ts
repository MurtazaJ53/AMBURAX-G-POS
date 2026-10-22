"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PROMOTIONS, type PromotionRule } from "@/server/promotions/promotionEngine";

const PROMOTIONS_STORAGE_KEY = "amburax_active_promotions_v1";

/**
 * Loads current promotional schemes from localStorage or default configurations.
 */
export function getSavedPromotions(): PromotionRule[] {
  if (typeof window === "undefined") return DEFAULT_PROMOTIONS;
  try {
    const raw = window.localStorage.getItem(PROMOTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_PROMOTIONS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.error("Failed to parse promotions from localStorage", err);
  }
  return DEFAULT_PROMOTIONS;
}

/**
 * Saves current promotional schemes to localStorage and dispatches a window event so all open tabs and PosTerminal update.
 */
export function savePromotions(promos: PromotionRule[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROMOTIONS_STORAGE_KEY, JSON.stringify(promos));
    window.dispatchEvent(new Event("promotions_updated"));
  } catch (err) {
    console.error("Failed to save promotions to localStorage", err);
  }
}

/**
 * React hook for live syncing active promotions across tabs and between OffersManager and PosTerminal.
 */
export function useActivePromotions(): [PromotionRule[], (newRules: PromotionRule[]) => void] {
  const [promotions, setPromotions] = useState<PromotionRule[]>(() => getSavedPromotions());

  useEffect(() => {
    function handleUpdate() {
      setPromotions(getSavedPromotions());
    }

    window.addEventListener("promotions_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      window.removeEventListener("promotions_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const update = (newRules: PromotionRule[]) => {
    setPromotions(newRules);
    savePromotions(newRules);
  };

  return [promotions, update];
}
