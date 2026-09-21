import fs from 'fs';
import path from 'path';

const seedFile = path.resolve('apps/web/prisma/seedDemoCatalogue.ts');
let content = fs.readFileSync(seedFile, 'utf-8');

const newProducts = `
  {
    name: "Men's Casual Shirt",
    category: "Shirts",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "MCS-001", barcode: "8900000001001", size: "M", colour: "Blue", priceMinor: 89900, mrpMinor: 119900, openingStock: 24 },
      { sku: "MCS-002", barcode: "8900000001002", size: "L", colour: "Navy", priceMinor: 89900, mrpMinor: 119900, openingStock: 12 },
      { sku: "MCS-003", barcode: "8900000001003", size: "XL", colour: "Olive", priceMinor: 89900, mrpMinor: 119900, openingStock: 5 },
    ],
  },
  {
    name: "Men's Printed Shirt",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "MPS-001", barcode: "8900000001004", size: "M", colour: "White", priceMinor: 109900, mrpMinor: 149900, openingStock: 8 },
      { sku: "MPS-002", barcode: "8900000001005", size: "L", colour: "Black", priceMinor: 109900, mrpMinor: 149900, openingStock: 0 },
    ],
  },
  {
    name: "Women's Kurti",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "WK-001", barcode: "8900000001006", size: "S", colour: "Green", priceMinor: 129900, mrpMinor: 179900, openingStock: 16 },
      { sku: "WK-002", barcode: "8900000001007", size: "M", colour: "Red", priceMinor: 129900, mrpMinor: 179900, openingStock: 30 },
    ],
  },
  {
    name: "Kids T-Shirt",
    category: "Kids",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "KTS-001", barcode: "8900000001008", size: "S", colour: "Blue", priceMinor: 49900, mrpMinor: 69900, openingStock: 40 },
      { sku: "KTS-002", barcode: "8900000001009", size: "M", colour: "White", priceMinor: 49900, mrpMinor: 69900, openingStock: 62 },
    ],
  },
  {
    name: "Men's Chino Pant",
    category: "Trousers",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "MCP-001", barcode: "8900000001010", size: "32", colour: "Beige", priceMinor: 149900, mrpMinor: 199900, openingStock: 15 },
      { sku: "MCP-002", barcode: "8900000001011", size: "34", colour: "Olive", priceMinor: 149900, mrpMinor: 199900, openingStock: 8 },
      { sku: "MCP-003", barcode: "8900000001012", size: "36", colour: "Brown", priceMinor: 149900, mrpMinor: 199900, openingStock: 0 },
    ],
  },
  {
    name: "Canvas Tote Bag",
    category: "Accessories",
    brand: "Amburax Studio",
    taxRateBp: 1800,
    variants: [
      { sku: "CTB-001", barcode: "8900000001013", size: null, colour: "White", priceMinor: 69900, mrpMinor: 99900, openingStock: 48 },
      { sku: "CTB-002", barcode: "8900000001014", size: null, colour: "Black", priceMinor: 69900, mrpMinor: 99900, openingStock: 24 },
    ],
  },
  {
    name: "Leather Belt",
    category: "Accessories",
    brand: "Amburax Classic",
    taxRateBp: 1800,
    variants: [
      { sku: "LB-001", barcode: "8900000001015", size: "M", colour: "Brown", priceMinor: 79900, mrpMinor: 109900, openingStock: 12 },
      { sku: "LB-002", barcode: "8900000001016", size: "L", colour: "Black", priceMinor: 79900, mrpMinor: 109900, openingStock: 5 },
    ],
  },
  {
    name: "Printed Cotton Kurta",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "PCK-001", barcode: "8900000001017", size: "M", colour: "Navy", priceMinor: 149900, mrpMinor: 249900, openingStock: 18 },
      { sku: "PCK-002", barcode: "8900000001018", size: "L", colour: "Olive", priceMinor: 149900, mrpMinor: 249900, openingStock: 3 },
    ],
  },
  {
    name: "Slim Fit Denim Jeans",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "SFD-001", barcode: "8900000001019", size: "30", colour: "Blue", priceMinor: 179900, mrpMinor: 249900, openingStock: 20 },
      { sku: "SFD-002", barcode: "8900000001020", size: "32", colour: "Navy", priceMinor: 179900, mrpMinor: 249900, openingStock: 0 },
      { sku: "SFD-003", barcode: "8900000001021", size: "34", colour: "Black", priceMinor: 179900, mrpMinor: 249900, openingStock: 8 },
    ],
  },
  {
    name: "Women's Jumpsuit",
    category: "Dresses",
    brand: "Amburax Studio",
    taxRateBp: 1200,
    variants: [
      { sku: "WJS-001", barcode: "8900000001022", size: "S", colour: "Olive", priceMinor: 249900, mrpMinor: 349900, openingStock: 12 },
      { sku: "WJS-002", barcode: "8900000001023", size: "M", colour: "Black", priceMinor: 249900, mrpMinor: 349900, openingStock: 5 },
    ],
  },
  {
    name: "Men's Graphic Tee",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "MGT-001", barcode: "8900000001024", size: "L", colour: "White", priceMinor: 59900, mrpMinor: 79900, openingStock: 40 },
    ],
  },
  {
    name: "Sports Leggings",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 1200,
    variants: [
      { sku: "SLG-001", barcode: "8900000001025", size: "S", colour: "Black", priceMinor: 119900, mrpMinor: 149900, openingStock: 25 },
    ],
  },
  {
    name: "Winter Puffer Jacket",
    category: "Outerwear",
    brand: "Amburax Basics",
    taxRateBp: 1200,
    variants: [
      { sku: "WPJ-001", barcode: "8900000001026", size: "L", colour: "Navy", priceMinor: 349900, mrpMinor: 499900, openingStock: 10 },
    ],
  },
  {
    name: "Kids Denim Overalls",
    category: "Kids",
    brand: "Amburax Denim",
    taxRateBp: 500,
    variants: [
      { sku: "KDO-001", barcode: "8900000001027", size: "M", colour: "Blue", priceMinor: 129900, mrpMinor: 179900, openingStock: 14 },
    ],
  },
  {
    name: "Formal Trousers",
    category: "Trousers",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "FT-001", barcode: "8900000001028", size: "34", colour: "Black", priceMinor: 179900, mrpMinor: 249900, openingStock: 8 },
    ],
  },
  {
    name: "Cotton Silk Saree",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "CSS-001", barcode: "8900000001029", size: null, colour: "Red", priceMinor: 499900, mrpMinor: 699900, openingStock: 5 },
    ],
  },
  {
    name: "V-Neck Sweater",
    category: "Outerwear",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "VNS-001", barcode: "8900000001030", size: "M", colour: "Navy", priceMinor: 149900, mrpMinor: 199900, openingStock: 18 },
    ],
  },
  {
    name: "Pleated Skirt",
    category: "Dresses",
    brand: "Amburax Studio",
    taxRateBp: 500,
    variants: [
      { sku: "PSK-001", barcode: "8900000001031", size: "S", colour: "White", priceMinor: 109900, mrpMinor: 149900, openingStock: 22 },
    ],
  },
  {
    name: "Workout Tank Top",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "WTT-001", barcode: "8900000001032", size: "M", colour: "Green", priceMinor: 49900, mrpMinor: 69900, openingStock: 35 },
    ],
  },
  {
    name: "Fleece Joggers",
    category: "Activewear",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "FJG-001", barcode: "8900000001033", size: "L", colour: "Black", priceMinor: 129900, mrpMinor: 179900, openingStock: 15 },
    ],
  }
`;

if (!content.includes("Men's Casual Shirt")) {
  content = content.replace(/\];\r?\n\r?\n\/\*\*/, '\n' + newProducts.trim() + '\n];\n\n/**');
  fs.writeFileSync(seedFile, content);
  console.log("Added new products.");
} else {
  console.log("Products already exist.");
}
