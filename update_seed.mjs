import fs from 'fs';

const newCatalogue = `export const DEMO_CATALOGUE: SeedProduct[] = [
  {
    name: "Cotton Formal Shirt",
    category: "Shirts",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "SHIRT-WHT-M", barcode: "8901234500011", size: "M", colour: "White", priceMinor: 129900, mrpMinor: 159900, openingStock: 24 },
      { sku: "SHIRT-WHT-L", barcode: "8901234500028", size: "L", colour: "White", priceMinor: 129900, mrpMinor: 159900, openingStock: 18 },
      { sku: "SHIRT-BLU-M", barcode: "8901234500035", size: "M", colour: "Blue", priceMinor: 134900, mrpMinor: 164900, openingStock: 12 },
      { sku: "SHIRT-BLU-L", barcode: "8901234500042", size: "L", colour: "Blue", priceMinor: 134900, mrpMinor: 164900, openingStock: 7 },
    ],
  },
  {
    name: "Slim Fit Denim Jeans",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "JEAN-IND-32", barcode: "8901234500059", size: "32", colour: "Indigo", priceMinor: 249900, mrpMinor: 299900, openingStock: 15 },
      { sku: "JEAN-IND-34", barcode: "8901234500066", size: "34", colour: "Indigo", priceMinor: 249900, mrpMinor: 299900, openingStock: 9 },
      { sku: "JEAN-BLK-32", barcode: "8901234500073", size: "32", colour: "Black", priceMinor: 259900, mrpMinor: 309900, openingStock: 6 },
    ],
  },
  {
    name: "Printed Cotton Kurta",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "KURTA-GRN-M", barcode: "8901234500080", size: "M", colour: "Green", priceMinor: 179900, mrpMinor: 219900, openingStock: 20 },
      { sku: "KURTA-GRN-L", barcode: "8901234500097", size: "L", colour: "Green", priceMinor: 179900, mrpMinor: 219900, openingStock: 11 },
    ],
  },
  {
    name: "Leather Belt",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "BELT-BRN-FS", barcode: "8901234500103", size: null, colour: "Brown", priceMinor: 89900, mrpMinor: 109900, openingStock: 30 },
    ],
  },
  {
    name: "Canvas Tote Bag",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "TOTE-NAT-FS", barcode: "8901234500110", size: null, colour: "Natural", priceMinor: 49900, mrpMinor: 59900, openingStock: 40 },
    ],
  },
  {
    name: "Men's Casual Shirt",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "SH-001-M", barcode: "8901234500200", size: "M", colour: "Olive", priceMinor: 119900, mrpMinor: 149900, openingStock: 5 },
      { sku: "SH-001-L", barcode: "8901234500201", size: "L", colour: "Olive", priceMinor: 119900, mrpMinor: 149900, openingStock: 0 },
    ],
  },
  {
    name: "Men's Printed Shirt",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "SH-002-M", barcode: "8901234500202", size: "M", colour: "Navy", priceMinor: 149900, mrpMinor: 179900, openingStock: 12 },
    ],
  },
  {
    name: "Men's Polo T-Shirt",
    category: "Shirts",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "TS-001-L", barcode: "8901234500203", size: "L", colour: "Red", priceMinor: 79900, mrpMinor: 99900, openingStock: 48 },
      { sku: "TS-001-XL", barcode: "8901234500204", size: "XL", colour: "Red", priceMinor: 79900, mrpMinor: 99900, openingStock: 62 },
    ],
  },
  {
    name: "Women's Kurti",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "KR-010-S", barcode: "8901234500205", size: "S", colour: "Beige", priceMinor: 109900, mrpMinor: 129900, openingStock: 16 },
      { sku: "KR-010-M", barcode: "8901234500206", size: "M", colour: "Beige", priceMinor: 109900, mrpMinor: 129900, openingStock: 8 },
    ],
  },
  {
    name: "Women's Top",
    category: "Tops",
    brand: "Amburax Studio",
    taxRateBp: 500,
    variants: [
      { sku: "TP-220-S", barcode: "8901234500207", size: "S", colour: "White", priceMinor: 89900, mrpMinor: 109900, openingStock: 0 },
      { sku: "TP-220-M", barcode: "8901234500208", size: "M", colour: "White", priceMinor: 89900, mrpMinor: 109900, openingStock: 3 },
    ],
  },
  {
    name: "Kids T-Shirt",
    category: "Kids",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "KD-012-XS", barcode: "8901234500209", size: "XS", colour: "Blue", priceMinor: 49900, mrpMinor: 59900, openingStock: 40 },
    ],
  },
  {
    name: "Men's Chino Pant",
    category: "Trousers",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "PT-001-32", barcode: "8901234500210", size: "32", colour: "Beige", priceMinor: 179900, mrpMinor: 249900, openingStock: 24 },
      { sku: "PT-001-34", barcode: "8901234500211", size: "34", colour: "Beige", priceMinor: 179900, mrpMinor: 249900, openingStock: 16 },
    ],
  },
  {
    name: "Men's Hoodie",
    category: "Outerwear",
    brand: "Amburax Urban",
    taxRateBp: 1200,
    variants: [
      { sku: "HD-001-L", barcode: "8901234500212", size: "L", colour: "Black", priceMinor: 249900, mrpMinor: 349900, openingStock: 5 },
    ],
  },
  {
    name: "Men's Jacket",
    category: "Outerwear",
    brand: "Amburax Urban",
    taxRateBp: 1200,
    variants: [
      { sku: "JK-001-M", barcode: "8901234500213", size: "M", colour: "Olive", priceMinor: 349900, mrpMinor: 499900, openingStock: 0 },
    ],
  },
  {
    name: "Women's Jeans",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "WJ-250-30", barcode: "8901234500214", size: "30", colour: "Blue", priceMinor: 199900, mrpMinor: 299900, openingStock: 12 },
    ],
  },
  {
    name: "Men's Blazer",
    category: "Outerwear",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "BL-001-L", barcode: "8901234500215", size: "L", colour: "Navy", priceMinor: 499900, mrpMinor: 699900, openingStock: 3 },
    ],
  },
  {
    name: "Running Shoes",
    category: "Footwear",
    brand: "Amburax Sports",
    taxRateBp: 1800,
    variants: [
      { sku: "RS-001-9", barcode: "8901234500216", size: "9", colour: "Black", priceMinor: 299900, mrpMinor: 399900, openingStock: 8 },
    ],
  },
  {
    name: "Leather Wallet",
    category: "Accessories",
    brand: "Amburax Classic",
    taxRateBp: 1800,
    variants: [
      { sku: "LW-001", barcode: "8901234500217", size: null, colour: "Brown", priceMinor: 89900, mrpMinor: 119900, openingStock: 30 },
    ],
  },
  {
    name: "Sunglasses",
    category: "Accessories",
    brand: "Amburax Studio",
    taxRateBp: 1800,
    variants: [
      { sku: "SG-001", barcode: "8901234500218", size: null, colour: "Black", priceMinor: 149900, mrpMinor: 199900, openingStock: 15 },
    ],
  },
  {
    name: "Printed Summer Dress",
    category: "Dresses",
    brand: "Amburax Studio",
    taxRateBp: 500,
    variants: [
      { sku: "DR-001-M", barcode: "8901234500219", size: "M", colour: "White", priceMinor: 179900, mrpMinor: 229900, openingStock: 8 },
    ],
  }
];`;

const filePath = 'apps/web/prisma/seedCatalogue.ts';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/export const DEMO_CATALOGUE: SeedProduct\[\] = \[\s*\{[\s\S]*?\];/m, newCatalogue);

fs.writeFileSync(filePath, content);
console.log("Updated seedCatalogue.ts successfully!");
