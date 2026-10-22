import type { PrismaClient } from "@prisma/client";

export function normalizeMasterCode(val: string): string | null {
  if (!val) return null;
  const cleaned = val.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned === "" ? null : cleaned;
}

export const PRESET_GARMENT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "Free Size"];

export const PRESET_GARMENT_COLOURS = [
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Navy", hex: "#000080" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Sky Blue", hex: "#38BDF8" },
  { name: "Royal Blue", hex: "#1D4ED8" },
  { name: "Red", hex: "#DC2626" },
  { name: "Maroon", hex: "#800000" },
  { name: "Wine", hex: "#722F37" },
  { name: "Green", hex: "#16A34A" },
  { name: "Olive", hex: "#808000" },
  { name: "Bottle Green", hex: "#004225" },
  { name: "Mint", hex: "#6EE7B7" },
  { name: "Grey", hex: "#6B7280" },
  { name: "Dark Grey", hex: "#374151" },
  { name: "Beige", hex: "#D4B996" },
  { name: "Cream", hex: "#FFFDD0" },
  { name: "Brown", hex: "#78350F" },
  { name: "Tan", hex: "#D2B48C" },
  { name: "Khaki", hex: "#C3B091" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Baby Pink", hex: "#FBCFE8" },
  { name: "Peach", hex: "#FDBA74" },
  { name: "Yellow", hex: "#EAB308" },
  { name: "Mustard", hex: "#D97706" },
  { name: "Orange", hex: "#F97316" },
  { name: "Purple", hex: "#9333EA" },
  { name: "Lavender", hex: "#C084FC" },
];

export const PRESET_SIZE_GROUPS = [
  {
    name: "Shirt S–XXL",
    code: "SHIRT_S_XXL",
    sizes: ["S", "M", "L", "XL", "XXL"],
  },
  {
    name: "T-Shirt S–3XL",
    code: "TSHIRT_S_3XL",
    sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
  },
  {
    name: "Free Size Only",
    code: "FREE_SIZE",
    sizes: ["Free Size"],
  },
];

/**
 * Ensures default garment attribute definitions (SIZE & COLOUR), preset values,
 * and size groups exist for a tenant. Idempotent and safe to run multiple times.
 */
export async function seedGarmentMasters(
  db: PrismaClient,
  tenantId: string
): Promise<{ definitions: number; values: number; sizeGroups: number }> {
  // 1. Attribute Definitions: Size & Colour
  const sizeDef = await db.attributeDefinition.upsert({
    where: { tenantId_code: { tenantId, code: "SIZE" } },
    update: {},
    create: {
      tenantId,
      name: "Size",
      code: "SIZE",
      sortOrder: 1,
      isSystem: true,
      isMandatory: false,
    },
  });

  const colourDef = await db.attributeDefinition.upsert({
    where: { tenantId_code: { tenantId, code: "COLOUR" } },
    update: {},
    create: {
      tenantId,
      name: "Colour",
      code: "COLOUR",
      sortOrder: 2,
      isSystem: true,
      isMandatory: false,
    },
  });

  // 2. Preset Sizes into attribute_values
  const sizeValueMap = new Map<string, string>(); // code -> id
  for (let i = 0; i < PRESET_GARMENT_SIZES.length; i++) {
    const sz = PRESET_GARMENT_SIZES[i]!;
    const code = normalizeMasterCode(sz);
    if (!code) continue;

    const val = await db.attributeValue.upsert({
      where: {
        tenantId_definitionId_code: {
          tenantId,
          definitionId: sizeDef.id,
          code,
        },
      },
      update: { sortOrder: i + 1 },
      create: {
        tenantId,
        definitionId: sizeDef.id,
        value: sz,
        code,
        sortOrder: i + 1,
        isActive: true,
      },
    });
    sizeValueMap.set(code, val.id);
  }

  // 3. Preset Colours into attribute_values (with hex swatches)
  for (let i = 0; i < PRESET_GARMENT_COLOURS.length; i++) {
    const clr = PRESET_GARMENT_COLOURS[i]!;
    const code = normalizeMasterCode(clr.name);
    if (!code) continue;

    await db.attributeValue.upsert({
      where: {
        tenantId_definitionId_code: {
          tenantId,
          definitionId: colourDef.id,
          code,
        },
      },
      update: { colorHex: clr.hex, sortOrder: i + 1 },
      create: {
        tenantId,
        definitionId: colourDef.id,
        value: clr.name,
        code,
        colorHex: clr.hex,
        sortOrder: i + 1,
        isActive: true,
      },
    });
  }

  // 4. Preset Size Groups & Items
  for (let gIdx = 0; gIdx < PRESET_SIZE_GROUPS.length; gIdx++) {
    const groupDef = PRESET_SIZE_GROUPS[gIdx]!;
    const sizeGroup = await db.sizeGroup.upsert({
      where: { tenantId_code: { tenantId, code: groupDef.code } },
      update: { name: groupDef.name, sortOrder: gIdx + 1 },
      create: {
        tenantId,
        name: groupDef.name,
        code: groupDef.code,
        sortOrder: gIdx + 1,
      },
    });

    for (let sIdx = 0; sIdx < groupDef.sizes.length; sIdx++) {
      const szName = groupDef.sizes[sIdx]!;
      const code = normalizeMasterCode(szName);
      if (!code) continue;
      const attrValId = sizeValueMap.get(code);
      if (!attrValId) continue;

      await db.sizeGroupItem.upsert({
        where: {
          sizeGroupId_attributeValueId: {
            sizeGroupId: sizeGroup.id,
            attributeValueId: attrValId,
          },
        },
        update: { sortOrder: sIdx + 1 },
        create: {
          tenantId,
          sizeGroupId: sizeGroup.id,
          attributeValueId: attrValId,
          sortOrder: sIdx + 1,
        },
      });
    }
  }

  return {
    definitions: 2,
    values: PRESET_GARMENT_SIZES.length + PRESET_GARMENT_COLOURS.length,
    sizeGroups: PRESET_SIZE_GROUPS.length,
  };
}
