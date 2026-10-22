/**
 * Number to Indian Rupees Words Converter
 * Conforms to standard banking & statutory GST tax invoice format (Rule 46)
 * E.g., 149950 paise -> "Rupees One Thousand Four Hundred Ninety-Nine and Fifty Paise Only"
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function convertTwoDigits(num: number): string {
  if (num === 0) return "";
  if (num < 20) return ONES[num] ?? "";
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  const tenWord = TENS[tens] ?? "";
  const oneWord = ones > 0 ? (ONES[ones] ?? "") : "";
  return `${tenWord}${oneWord ? " " + oneWord : ""}`.trim();
}

function convertThreeDigits(num: number): string {
  const hundreds = Math.floor(num / 100);
  const remainder = num % 100;
  const parts: string[] = [];

  if (hundreds > 0) {
    const hWord = ONES[hundreds] ?? "";
    if (hWord) parts.push(`${hWord} Hundred`);
  }
  if (remainder > 0) {
    parts.push(convertTwoDigits(remainder));
  }
  return parts.join(" ").trim();
}

export function amountInWords(minorAmount: number, currency: string = "INR"): string {
  if (minorAmount <= 0) return "Zero Rupees Only";

  const rupees = Math.floor(minorAmount / 100);
  const paise = minorAmount % 100;

  if (rupees === 0 && paise > 0) {
    return `${convertTwoDigits(paise)} Paise Only`;
  }

  // Indian numbering grouping: Crores (10,000,000), Lakhs (100,000), Thousands (1,000), Hundreds
  const crores = Math.floor(rupees / 10_000_000);
  let rem = rupees % 10_000_000;

  const lakhs = Math.floor(rem / 100_000);
  rem = rem % 100_000;

  const thousands = Math.floor(rem / 1_000);
  rem = rem % 1_000;

  const hundreds = rem;

  const parts: string[] = [];

  if (crores > 0) {
    parts.push(`${convertTwoDigits(crores)} Crore`);
  }
  if (lakhs > 0) {
    parts.push(`${convertTwoDigits(lakhs)} Lakh`);
  }
  if (thousands > 0) {
    parts.push(`${convertTwoDigits(thousands)} Thousand`);
  }
  if (hundreds > 0) {
    parts.push(convertThreeDigits(hundreds));
  }

  let words = `Rupees ${parts.join(" ").trim()}`;

  if (paise > 0) {
    words += ` and ${convertTwoDigits(paise)} Paise`;
  }

  return `${words} Only`;
}
