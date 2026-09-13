import type { SeedProduct, SeedCustomer } from "./seedCatalogue";

/**
 * The richer demo catalogue and customer roster for `db:seed:demo`.
 *
 * Layered on top of `seedCatalogue.ts`'s minimal baseline (never duplicated with it — SKUs,
 * barcodes and phone numbers are all distinct ranges), applied through the same
 * `seedProductCatalogue`/`seedCustomerRoster` engine so this is not a second write path.
 *
 * Stock is deliberately distributed across every state the Inventory and Dashboard screens
 * need to demonstrate honestly: healthy (30+), medium (10-25), low (1-9), out of stock (0),
 * and never counted (`openingStock: null`, ADR-080's "no StockLevel row exists"). Nothing
 * here is negative — a demo must not start from corrupted inventory.
 */

export const DEMO_EXTRA_CATALOGUE: SeedProduct[] = [
  {
    name: "Men's Polo T-Shirt",
    category: "Shirts",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "POLO-WHT-M", barcode: "8901234500201", size: "M", colour: "White", priceMinor: 69900, mrpMinor: 89900, openingStock: 45 },
      { sku: "POLO-NVY-L", barcode: "8901234500202", size: "L", colour: "Navy", priceMinor: 69900, mrpMinor: 89900, openingStock: 18 },
      { sku: "POLO-MAR-M", barcode: "8901234500203", size: "M", colour: "Maroon", priceMinor: 69900, mrpMinor: 89900, openingStock: 4 },
    ],
  },
  {
    name: "Women's Top",
    category: "Tops",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "TOP-PNK-S", barcode: "8901234500204", size: "S", colour: "Pink", priceMinor: 79900, mrpMinor: 99900, openingStock: 20 },
      { sku: "TOP-WHT-M", barcode: "8901234500205", size: "M", colour: "White", priceMinor: 79900, mrpMinor: 99900, openingStock: 6 },
      { sku: "TOP-PNK-L", barcode: "8901234500206", size: "L", colour: "Pink", priceMinor: 79900, mrpMinor: 99900, openingStock: 0 },
    ],
  },
  {
    name: "Women's Dress",
    category: "Dresses",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "DRESS-FLR-M", barcode: "8901234500207", size: "M", colour: "Floral", priceMinor: 199900, mrpMinor: 249900, openingStock: 32 },
      { sku: "DRESS-BLK-L", barcode: "8901234500208", size: "L", colour: "Black", priceMinor: 199900, mrpMinor: 249900, openingStock: null },
    ],
  },
  {
    name: "Regular Fit Jeans",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "RJEAN-BLU-30", barcode: "8901234500209", size: "30", colour: "Blue", priceMinor: 199900, mrpMinor: 249900, openingStock: 14 },
      { sku: "RJEAN-BLU-32", barcode: "8901234500210", size: "32", colour: "Blue", priceMinor: 199900, mrpMinor: 249900, openingStock: 22 },
      { sku: "RJEAN-BLU-34", barcode: "8901234500211", size: "34", colour: "Blue", priceMinor: 199900, mrpMinor: 249900, openingStock: 5 },
    ],
  },
  {
    name: "Chinos",
    category: "Trousers",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "CHINO-BEG-30", barcode: "8901234500212", size: "30", colour: "Beige", priceMinor: 149900, mrpMinor: 179900, openingStock: 3 },
      { sku: "CHINO-BEG-32", barcode: "8901234500213", size: "32", colour: "Beige", priceMinor: 149900, mrpMinor: 179900, openingStock: 16 },
      { sku: "CHINO-GRY-32", barcode: "8901234500214", size: "32", colour: "Grey", priceMinor: 149900, mrpMinor: 179900, openingStock: 38 },
    ],
  },
  {
    name: "Formal Trousers",
    category: "Trousers",
    brand: "Amburax Basics",
    taxRateBp: 1200,
    variants: [
      { sku: "FTROUS-BLK-32", barcode: "8901234500215", size: "32", colour: "Black", priceMinor: 179900, mrpMinor: 219900, openingStock: 12 },
      { sku: "FTROUS-BLK-34", barcode: "8901234500216", size: "34", colour: "Black", priceMinor: 179900, mrpMinor: 219900, openingStock: 7 },
      { sku: "FTROUS-GRY-36", barcode: "8901234500217", size: "36", colour: "Grey", priceMinor: 179900, mrpMinor: 219900, openingStock: 0 },
    ],
  },
  {
    name: "Kids T-Shirt",
    category: "Kids",
    brand: "Amburax Kids",
    taxRateBp: 500,
    variants: [
      { sku: "KIDTEE-YLW-4Y", barcode: "8901234500218", size: "4Y", colour: "Yellow", priceMinor: 49900, mrpMinor: 59900, openingStock: 50 },
      { sku: "KIDTEE-BLU-6Y", barcode: "8901234500219", size: "6Y", colour: "Blue", priceMinor: 49900, mrpMinor: 59900, openingStock: 24 },
      { sku: "KIDTEE-YLW-8Y", barcode: "8901234500220", size: "8Y", colour: "Yellow", priceMinor: 49900, mrpMinor: 59900, openingStock: 8 },
    ],
  },
  {
    name: "Kids Denim Shorts",
    category: "Kids",
    brand: "Amburax Kids",
    taxRateBp: 500,
    variants: [
      { sku: "KIDSHORT-BLU-4Y", barcode: "8901234500221", size: "4Y", colour: "Blue", priceMinor: 69900, mrpMinor: 89900, openingStock: 15 },
      { sku: "KIDSHORT-BLU-6Y", barcode: "8901234500222", size: "6Y", colour: "Blue", priceMinor: 69900, mrpMinor: 89900, openingStock: 0 },
    ],
  },
  {
    name: "Hoodie",
    category: "Outerwear",
    brand: "Amburax Basics",
    taxRateBp: 1200,
    variants: [
      { sku: "HOOD-BLK-M", barcode: "8901234500223", size: "M", colour: "Black", priceMinor: 149900, mrpMinor: 179900, openingStock: 40 },
      { sku: "HOOD-GRY-L", barcode: "8901234500224", size: "L", colour: "Grey", priceMinor: 149900, mrpMinor: 179900, openingStock: 19 },
      { sku: "HOOD-BLK-XL", barcode: "8901234500225", size: "XL", colour: "Black", priceMinor: 149900, mrpMinor: 179900, openingStock: 6 },
    ],
  },
  {
    name: "Sweatshirt",
    category: "Outerwear",
    brand: "Amburax Basics",
    taxRateBp: 1200,
    variants: [
      { sku: "SWEAT-GRY-M", barcode: "8901234500226", size: "M", colour: "Grey", priceMinor: 119900, mrpMinor: 139900, openingStock: 17 },
      { sku: "SWEAT-GRY-L", barcode: "8901234500227", size: "L", colour: "Grey", priceMinor: 119900, mrpMinor: 139900, openingStock: null },
    ],
  },
  {
    name: "Jacket",
    category: "Outerwear",
    brand: "Amburax Basics",
    taxRateBp: 1200,
    variants: [
      { sku: "JACK-BLK-M", barcode: "8901234500228", size: "M", colour: "Black", priceMinor: 249900, mrpMinor: 299900, openingStock: 30 },
      { sku: "JACK-NVY-L", barcode: "8901234500229", size: "L", colour: "Navy", priceMinor: 249900, mrpMinor: 299900, openingStock: 13 },
      { sku: "JACK-BLK-XL", barcode: "8901234500230", size: "XL", colour: "Black", priceMinor: 249900, mrpMinor: 299900, openingStock: 2 },
    ],
  },
  {
    name: "Track Pants",
    category: "Activewear",
    brand: "Amburax Active",
    taxRateBp: 1200,
    variants: [
      { sku: "TRACK-BLK-M", barcode: "8901234500231", size: "M", colour: "Black", priceMinor: 99900, mrpMinor: 119900, openingStock: 55 },
      { sku: "TRACK-GRY-L", barcode: "8901234500232", size: "L", colour: "Grey", priceMinor: 99900, mrpMinor: 119900, openingStock: 21 },
      { sku: "TRACK-BLK-XL", barcode: "8901234500233", size: "XL", colour: "Black", priceMinor: 99900, mrpMinor: 119900, openingStock: 9 },
    ],
  },
  {
    name: "Leggings",
    category: "Activewear",
    brand: "Amburax Active",
    taxRateBp: 500,
    variants: [
      { sku: "LEGG-BLK-S", barcode: "8901234500234", size: "S", colour: "Black", priceMinor: 69900, mrpMinor: 89900, openingStock: 60 },
      { sku: "LEGG-BLK-M", barcode: "8901234500235", size: "M", colour: "Black", priceMinor: 69900, mrpMinor: 89900, openingStock: 48 },
      { sku: "LEGG-BLK-L", barcode: "8901234500236", size: "L", colour: "Black", priceMinor: 69900, mrpMinor: 89900, openingStock: 25 },
    ],
  },
  {
    name: "Scarf",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "SCARF-RED-FS", barcode: "8901234500237", size: null, colour: "Red", priceMinor: 49900, mrpMinor: 59900, openingStock: 11 },
      { sku: "SCARF-BEG-FS", barcode: "8901234500238", size: null, colour: "Beige", priceMinor: 49900, mrpMinor: 59900, openingStock: 4 },
      { sku: "SCARF-NVY-FS", barcode: "8901234500239", size: null, colour: "Navy", priceMinor: 49900, mrpMinor: 59900, openingStock: null },
    ],
  },
  {
    name: "Cap",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "CAP-BLK-FS", barcode: "8901234500240", size: null, colour: "Black", priceMinor: 49900, mrpMinor: 59900, openingStock: 34 },
      { sku: "CAP-NVY-FS", barcode: "8901234500241", size: null, colour: "Navy", priceMinor: 49900, mrpMinor: 59900, openingStock: 1 },
    ],
  },
  {
    name: "Socks (Pack of 3)",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "SOCKS-AST-FS", barcode: "8901234500242", size: null, colour: "Assorted", priceMinor: 19900, mrpMinor: 24900, openingStock: 100 },
    ],
  },
];

/**
 * Synthetic demo identities only — clearly fictional, never real customer data. Phone
 * numbers continue the +9190000001xx range the baseline seed starts (…101, …102), so the
 * two rosters can never collide.
 */
export const DEMO_EXTRA_CUSTOMERS: SeedCustomer[] = [
  { name: "Aarav Mehta", phone: "+919000000103" },
  { name: "Neha Shah", phone: "+919000000104" },
  { name: "Rahul Patel", phone: "+919000000105" },
  { name: "Aisha Khan", phone: "+919000000106" },
  { name: "Rohan Desai", phone: "+919000000107" },
  { name: "Kavya Joshi", phone: "+919000000108" },
  { name: "Aditya Shah", phone: "+919000000109" },
  { name: "Meera Patel", phone: "+919000000110" },
  { name: "Zoya Khan", phone: "+919000000111" },
  { name: "Arjun Mehta", phone: "+919000000112" },
  { name: "Ishita Desai", phone: "+919000000113" },
  { name: "Vikram Nair", phone: "+919000000114" },
  { name: "Sneha Reddy", phone: "+919000000115" },
  { name: "Karan Malhotra", phone: "+919000000116" },
  { name: "Ananya Iyer", phone: "+919000000117" },
  { name: "Rajesh Kumar", phone: "+919000000118" },
  { name: "Divya Menon", phone: "+919000000119" },
];
