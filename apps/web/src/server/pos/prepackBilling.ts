/**
 * Prepack & Ratio Set Billing Engine
 * Allows wholesale billing by prepack bundles (e.g. 1:2:2:1 size-ratio packs, bales, or lots)
 * automatically exploding into component inventory items upon invoice confirmation.
 */

export interface PrepackRatioItem {
  size: string;
  ratio: number; // e.g. S:1, M:2, L:2, XL:1 => total 6 pieces per pack
  color?: string;
  sku: string;
}

export interface PrepackDefinition {
  id: string;
  code: string;
  designNumber: string;
  name: string;
  items: PrepackRatioItem[];
  piecesPerPack: number;
  ratePerPiece: number;
  packPrice: number;
}

export interface ExplodedPrepackLine {
  prepackCode: string;
  sku: string;
  size: string;
  color?: string;
  quantityPieces: number;
  ratePerPiece: number;
  totalAmount: number;
}

export function createPrepack(
  code: string,
  designNumber: string,
  name: string,
  items: PrepackRatioItem[],
  ratePerPiece: number
): PrepackDefinition {
  const piecesPerPack = items.reduce((sum, it) => sum + it.ratio, 0);
  if (piecesPerPack <= 0) {
    throw new Error("Total ratio pieces in a prepack must be greater than zero");
  }

  const packPrice = Math.round(piecesPerPack * ratePerPiece * 100) / 100;

  return {
    id: `PREPACK-${code}`,
    code,
    designNumber,
    name,
    items,
    piecesPerPack,
    ratePerPiece,
    packPrice,
  };
}

export function explodePrepackOrder(
  prepack: PrepackDefinition,
  packsOrdered: number
): {
  explodedLines: ExplodedPrepackLine[];
  totalPieces: number;
  totalAmount: number;
} {
  if (packsOrdered <= 0) {
    throw new Error("Packs ordered must be at least 1");
  }

  const explodedLines: ExplodedPrepackLine[] = prepack.items.map((item) => {
    const qty = item.ratio * packsOrdered;
    const lineTotal = Math.round(qty * prepack.ratePerPiece * 100) / 100;
    return {
      prepackCode: prepack.code,
      sku: item.sku,
      size: item.size,
      color: item.color,
      quantityPieces: qty,
      ratePerPiece: prepack.ratePerPiece,
      totalAmount: lineTotal,
    };
  });

  const totalPieces = packsOrdered * prepack.piecesPerPack;
  const totalAmount = Math.round(packsOrdered * prepack.packPrice * 100) / 100;

  return {
    explodedLines,
    totalPieces,
    totalAmount,
  };
}
