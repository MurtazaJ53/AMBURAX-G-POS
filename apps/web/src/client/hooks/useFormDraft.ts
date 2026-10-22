"use client";

import { useEffect, useState, useRef } from "react";

/**
 * useFormDraft
 * Persists form inputs in browser localStorage automatically across page refreshes,
 * accidental browser closes, or offline interruptions.
 *
 * @param draftKey Unique key for this form (e.g. "gpos_purchase_new_draft")
 * @param initialValues Default initial state
 * @returns [values, setValues, resetDraft, hasRestoredDraft]
 */
export function useFormDraft<T extends Record<string, any>>(
  draftKey: string,
  initialValues: T
) {
  const [values, setValues] = useState<T>(initialValues);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const isLoaded = useRef(false);

  // Restore on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setValues((prev) => ({ ...prev, ...parsed }));
          setHasRestoredDraft(true);
        }
      }
    } catch (e) {
      console.warn(`[Draft] Failed to read draft for ${draftKey}`, e);
    } finally {
      isLoaded.current = true;
    }
  }, [draftKey]);

  // Save to localStorage on change with debouncing
  useEffect(() => {
    if (!isLoaded.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(values));
      } catch (e) {
        console.warn(`[Draft] Failed to write draft for ${draftKey}`, e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [draftKey, values]);

  // Clear draft on successful submit / reset
  const resetDraft = () => {
    try {
      localStorage.removeItem(draftKey);
      setValues(initialValues);
      setHasRestoredDraft(false);
    } catch (e) {
      console.warn(`[Draft] Failed to clear draft for ${draftKey}`, e);
    }
  };

  return [values, setValues, resetDraft, hasRestoredDraft] as const;
}
