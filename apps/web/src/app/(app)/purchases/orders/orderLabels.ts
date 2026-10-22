import type { OrderProgress } from "@/server/purchasing/purchaseOrders";

/** Labels and badge tones for an order's progress, shared by the list and detail pages. */
export const PROGRESS_LABEL: Record<OrderProgress, string> = {
  open: "Ordered",
  part_received: "Part received",
  received: "Received",
  cancelled: "Cancelled",
};
export const PROGRESS_TONE: Record<OrderProgress, "info" | "warning" | "success" | "neutral"> = {
  open: "info",
  part_received: "warning",
  received: "success",
  cancelled: "neutral",
};
