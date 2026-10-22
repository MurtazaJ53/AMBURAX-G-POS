/**
 * Pure TypeScript Code-128 (Subset B) SVG Barcode Generator.
 * Zero external runtime dependencies.
 * Produces crisp, resolution-independent SVG barcodes ideal for thermal label printers.
 */

// Code 128 pattern widths (each pattern consists of 3 bars and 3 spaces totaling 11 units, stop pattern is 13 units)
const CODE128_PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", // 40-49
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", // 50-59
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", // 60-69
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", // 70-79
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", // 80-89
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", // 90-99
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112" // 100-106 (104 is Start B, 106 is Stop)
];

const START_B_INDEX = 104;
const STOP_INDEX = 106;

/**
 * Encodes ASCII string into Code-128 binary modules (1 for bar, 0 for space)
 */
export function encodeCode128B(text: string): string {
  const codes: number[] = [START_B_INDEX];
  let checksum = START_B_INDEX;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    // ASCII 32 to 126 maps to Code 128 values 0 to 94
    const value = charCode - 32;
    if (value >= 0 && value <= 95) {
      codes.push(value);
      checksum += value * (i + 1);
    }
  }

  const checkDigit = checksum % 103;
  codes.push(checkDigit);
  codes.push(STOP_INDEX);

  let binary = "";
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) continue;
    let isBar = true;
    for (const widthChar of pattern) {
      const width = parseInt(widthChar, 10);
      binary += (isBar ? "1" : "0").repeat(width);
      isBar = !isBar;
    }
  }

  return binary;
}

/**
 * Returns an SVG element representation of the barcode
 */
export function generateBarcodeSvgString(text: string, options?: { height?: number; barWidth?: number }): string {
  const height = options?.height ?? 40;
  const barWidth = options?.barWidth ?? 1.5;
  const binary = encodeCode128B(text);

  let pathD = "";
  let x = 0;

  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === "1") {
      pathD += `M${x},0h${barWidth}v${height}h-${barWidth}Z `;
    }
    x += barWidth;
  }

  const totalWidth = x;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}" preserveAspectRatio="none">${pathD ? `<path d="${pathD.trim()}" fill="currentColor" />` : ""}</svg>`;
}
