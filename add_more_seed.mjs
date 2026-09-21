import fs from 'fs';
import path from 'path';

const seedFile = path.resolve('apps/web/prisma/seedDemoCatalogue.ts');
let content = fs.readFileSync(seedFile, 'utf-8');

const newProducts = `
  {
    name: "Summer Graphic Tee",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "SGT-001", barcode: "8900000002001", size: "M", colour: "Yellow", priceMinor: 59900, mrpMinor: 79900, openingStock: 24 },
    ],
  },
  {
    name: "Relaxed Fit Chinos",
    category: "Trousers",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "RFC-001", barcode: "8900000002002", size: "32", colour: "Khaki", priceMinor: 169900, mrpMinor: 219900, openingStock: 15 },
      { sku: "RFC-002", barcode: "8900000002003", size: "34", colour: "Khaki", priceMinor: 169900, mrpMinor: 219900, openingStock: 8 },
    ],
  },
  {
    name: "Vintage Denim Jacket",
    category: "Outerwear",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "VDJ-001", barcode: "8900000002004", size: "M", colour: "Blue", priceMinor: 299900, mrpMinor: 399900, openingStock: 10 },
      { sku: "VDJ-002", barcode: "8900000002005", size: "L", colour: "Blue", priceMinor: 299900, mrpMinor: 399900, openingStock: 0 },
    ],
  },
  {
    name: "Cotton Maxi Dress",
    category: "Dresses",
    brand: "Amburax Studio",
    taxRateBp: 500,
    variants: [
      { sku: "CMD-001", barcode: "8900000002006", size: "S", colour: "Floral", priceMinor: 249900, mrpMinor: 299900, openingStock: 18 },
      { sku: "CMD-002", barcode: "8900000002007", size: "M", colour: "Floral", priceMinor: 249900, mrpMinor: 299900, openingStock: 5 },
    ],
  },
  {
    name: "Kids Winter Beanie",
    category: "Kids",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "KWB-001", barcode: "8900000002008", size: "S", colour: "Red", priceMinor: 39900, mrpMinor: 49900, openingStock: 30 },
      { sku: "KWB-002", barcode: "8900000002009", size: "M", colour: "Navy", priceMinor: 39900, mrpMinor: 49900, openingStock: 20 },
    ],
  },
  {
    name: "Silk Blend Kurta",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 1200,
    variants: [
      { sku: "SBK-001", barcode: "8900000002010", size: "L", colour: "Maroon", priceMinor: 199900, mrpMinor: 249900, openingStock: 12 },
    ],
  },
  {
    name: "Running Shorts",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "RST-001", barcode: "8900000002011", size: "M", colour: "Black", priceMinor: 89900, mrpMinor: 119900, openingStock: 25 },
      { sku: "RST-002", barcode: "8900000002012", size: "L", colour: "Grey", priceMinor: 89900, mrpMinor: 119900, openingStock: 15 },
    ],
  },
  {
    name: "Casual Crossbody Bag",
    category: "Accessories",
    brand: "Amburax Studio",
    taxRateBp: 1800,
    variants: [
      { sku: "CCB-001", barcode: "8900000002013", size: null, colour: "Brown", priceMinor: 149900, mrpMinor: 199900, openingStock: 10 },
    ],
  },
  {
    name: "Linen Blend Shirt",
    category: "Shirts",
    brand: "Amburax Classic",
    taxRateBp: 500,
    variants: [
      { sku: "LBS-001", barcode: "8900000002014", size: "M", colour: "White", priceMinor: 129900, mrpMinor: 179900, openingStock: 20 },
      { sku: "LBS-002", barcode: "8900000002015", size: "L", colour: "Beige", priceMinor: 129900, mrpMinor: 179900, openingStock: 15 },
    ],
  },
  {
    name: "Skinny Fit Jeans",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "SFJ-001", barcode: "8900000002016", size: "30", colour: "Black", priceMinor: 189900, mrpMinor: 249900, openingStock: 12 },
      { sku: "SFJ-002", barcode: "8900000002017", size: "32", colour: "Black", priceMinor: 189900, mrpMinor: 249900, openingStock: 8 },
    ],
  },
  {
    name: "Embroidered Kurti",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "EK-001", barcode: "8900000002018", size: "M", colour: "Pink", priceMinor: 159900, mrpMinor: 209900, openingStock: 22 },
    ],
  },
  {
    name: "Performance Hoodie",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 1200,
    variants: [
      { sku: "PHD-001", barcode: "8900000002019", size: "L", colour: "Navy", priceMinor: 219900, mrpMinor: 279900, openingStock: 14 },
    ],
  },
  {
    name: "Kids Floral Frock",
    category: "Kids",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "KFF-001", barcode: "8900000002020", size: "4Y", colour: "Yellow", priceMinor: 89900, mrpMinor: 119900, openingStock: 25 },
    ],
  },
  {
    name: "Premium Leather Wallet",
    category: "Accessories",
    brand: "Amburax Classic",
    taxRateBp: 1800,
    variants: [
      { sku: "PLW-001", barcode: "8900000002021", size: null, colour: "Black", priceMinor: 119900, mrpMinor: 159900, openingStock: 18 },
    ],
  },
  {
    name: "Corduroy Overshirt",
    category: "Outerwear",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "COS-001", barcode: "8900000002022", size: "L", colour: "Brown", priceMinor: 249900, mrpMinor: 319900, openingStock: 10 },
    ],
  }
`;

content = content.replace(/\];\r?\n\r?\n\/\*\*/, ',\n' + newProducts.trim() + '\n];\n\n/**');
fs.writeFileSync(seedFile, content);
console.log("Added 15 more unique products.");
