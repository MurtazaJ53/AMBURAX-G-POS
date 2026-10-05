/**
 * Bill and history timestamps.
 *
 * Locale and timezone are both fixed rather than taken from the device. A bill is a record
 * of when a sale happened at a particular counter, so two tablets in the same shop must
 * never print two different times for the same sale.
 *
 * The timezone matches the `Store.timezone` default in the schema. When per-store
 * timezones become configurable this takes the store's value — it is deliberately a single
 * call site so that change is one edit.
 */
export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

/**
 * Time alone, for lists where every row is from the same trading day and repeating the
 * date would be noise the operator has to read past.
 */
export function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export function formatDateOnly(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(value);
}
