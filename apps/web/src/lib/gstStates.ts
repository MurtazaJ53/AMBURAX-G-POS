/**
 * GST state codes (the first two digits of a GSTIN), as published by GSTN. Used to decide whether a
 * purchase is intra-state (CGST + SGST) or inter-state (IGST) — IGST Act ss. 7, 8 and 10: for goods,
 * the place of supply is where the movement ends, i.e. the receiving store's state.
 */
const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01",
  "himachal pradesh": "02",
  punjab: "03",
  chandigarh: "04",
  uttarakhand: "05",
  haryana: "06",
  delhi: "07",
  rajasthan: "08",
  "uttar pradesh": "09",
  bihar: "10",
  sikkim: "11",
  "arunachal pradesh": "12",
  nagaland: "13",
  manipur: "14",
  mizoram: "15",
  tripura: "16",
  meghalaya: "17",
  assam: "18",
  "west bengal": "19",
  jharkhand: "20",
  odisha: "21",
  chhattisgarh: "22",
  "madhya pradesh": "23",
  gujarat: "24",
  "dadra and nagar haveli and daman and diu": "26",
  maharashtra: "27",
  karnataka: "29",
  goa: "30",
  lakshadweep: "31",
  kerala: "32",
  "tamil nadu": "33",
  puducherry: "34",
  "andaman and nicobar islands": "35",
  telangana: "36",
  "andhra pradesh": "37",
  ladakh: "38",
};

/** State and union-territory names for pickers, in title case and alphabetical order. */
export const INDIAN_STATES: string[] = Object.keys(STATE_CODES)
  .map((n) => n.replace(/(and)|([a-z])/g, (m, and: string | undefined) => (and ? and : m.toUpperCase())))
  .sort((a, b) => a.localeCompare(b));

const ALIASES: Record<string, string> = {
  "new delhi": "delhi",
  "nct of delhi": "delhi",
  orissa: "odisha",
  pondicherry: "puducherry",
  "andaman and nicobar": "andaman and nicobar islands",
  "daman and diu": "dadra and nagar haveli and daman and diu",
  "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
  // The usual two-letter abbreviations (as on vehicle plates), since stores often type these.
  jk: "jammu and kashmir",
  hp: "himachal pradesh",
  pb: "punjab",
  ch: "chandigarh",
  uk: "uttarakhand",
  hr: "haryana",
  dl: "delhi",
  rj: "rajasthan",
  up: "uttar pradesh",
  br: "bihar",
  sk: "sikkim",
  ar: "arunachal pradesh",
  nl: "nagaland",
  mn: "manipur",
  mz: "mizoram",
  tr: "tripura",
  ml: "meghalaya",
  as: "assam",
  wb: "west bengal",
  jh: "jharkhand",
  od: "odisha",
  cg: "chhattisgarh",
  mp: "madhya pradesh",
  gj: "gujarat",
  dd: "dadra and nagar haveli and daman and diu",
  mh: "maharashtra",
  ka: "karnataka",
  ga: "goa",
  ld: "lakshadweep",
  kl: "kerala",
  tn: "tamil nadu",
  py: "puducherry",
  an: "andaman and nicobar islands",
  ts: "telangana",
  tg: "telangana",
  ap: "andhra pradesh",
  la: "ladakh",
};

/** The GST state code for a state name as typed at store setup, or null when it is not recognised. */
export function gstStateCode(stateName: string | null | undefined): string | null {
  if (!stateName) return null;
  const key = stateName.trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ");
  return STATE_CODES[ALIASES[key] ?? key] ?? null;
}

/**
 * Why a GST-registered business can't open a store in this state, or null when it can. One GSTIN is
 * one state, and one GSTIN is one ERPNext company: a store in another state needs its own GST
 * registration, so it can't join this business. A business without a GSTIN can open stores anywhere.
 */
export function storeStateOutsideGstin(gstin: string | null | undefined, stateName: string): string | null {
  const registered = gstinStateCode(gstin);
  if (!registered) return null;
  if (gstStateCode(stateName) === registered) return null;
  const home = stateNameForCode(registered);
  return `Your GSTIN is registered in ${home}, so every store in this business must be in ${home}. A store in another state needs its own GST registration and a separate business.`;
}

/**
 * Why a business can't take this GSTIN while it has these stores, or null when every store is in
 * the GSTIN's state. Same rule as storeStateOutsideGstin, for stores that already exist.
 */
export function storesOutsideGstin(gstin: string, stores: { name: string; state: string }[]): string | null {
  const registered = gstinStateCode(gstin);
  if (!registered) return null;
  const outside = stores.filter((s) => gstStateCode(s.state) !== registered);
  if (outside.length === 0) return null;
  const home = stateNameForCode(registered);
  const list = outside.map((s) => `${s.name} (${s.state})`).join(", ");
  return `Your GSTIN is registered in ${home}, but ${list} ${outside.length === 1 ? "is" : "are"} in another state. Every store in a GST-registered business must be in ${home}; a store in another state needs its own GST registration and a separate business.`;
}

function stateNameForCode(code: string): string {
  const key = Object.keys(STATE_CODES).find((name) => STATE_CODES[name] === code);
  return key ? key.replace(/\b(?!and\b)[a-z]/g, (c) => c.toUpperCase()) : `state ${code}`;
}

/** The state code a GSTIN belongs to, or null for a malformed one. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  const code = gstin?.trim().slice(0, 2) ?? "";
  return /^\d{2}$/.test(code) ? code : null;
}
