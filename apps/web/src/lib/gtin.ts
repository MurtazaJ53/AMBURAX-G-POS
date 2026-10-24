/**
 * GS1 GTIN check digits (EAN-8, UPC-A, EAN-13). The weights run 3, 1, 3, … from the digit
 * next to the check digit, so one function serves every length.
 */
export function gtinCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const fromRight = payload.length - 1 - i;
    sum += Number(payload[i]) * (fromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True for an all-digit code of `length` whose last digit is its GS1 check digit. */
export function isValidGtin(code: string, length: 8 | 12 | 13): boolean {
  if (code.length !== length || !/^\d+$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}
