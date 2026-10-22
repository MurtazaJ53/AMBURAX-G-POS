/** Display labels and badge tones for a transfer's status, shared by the list and detail pages. */
export const STATUS_TONE = { IN_TRANSIT: "warning", RECEIVED: "success", CANCELLED: "neutral" } as const;
export const STATUS_LABEL = { IN_TRANSIT: "In transit", RECEIVED: "Received", CANCELLED: "Cancelled" } as const;
