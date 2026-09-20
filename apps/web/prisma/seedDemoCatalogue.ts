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
    imageUrl: "/products/men-s-polo-t-shirt.jpg",
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
    imageUrl: "/products/women-s-top.jpg",
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
    imageUrl: "/products/women-s-dress.jpg",
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
    imageUrl: "/products/regular-fit-jeans.jpg",
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
    imageUrl: "/products/chinos.jpg",
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
    imageUrl: "/products/formal-trousers.jpg",
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
    imageUrl: "/products/kids-t-shirt.jpg",
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
    imageUrl: "/products/kids-denim-shorts.jpg",
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
    imageUrl: "/products/hoodie.jpg",
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
    imageUrl: "/products/sweatshirt.jpg",
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
    imageUrl: "/products/jacket.jpg",
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
    imageUrl: "/products/track-pants.jpg",
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
    imageUrl: "/products/leggings.jpg",
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
    imageUrl: "/products/scarf.jpg",
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
    imageUrl: "/products/socks-pack-of-3.jpg",
    category: "Accessories",
    brand: "Amburax Basics",
    taxRateBp: 1800,
    variants: [
      { sku: "SOCKS-AST-FS", barcode: "8901234500242", size: null, colour: "Assorted", priceMinor: 19900, mrpMinor: 24900, openingStock: 100 },
    ],
  },

{
    name: "Men's Casual Shirt",
    imageUrl: "/products/men-s-casual-shirt.jpg",
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
    imageUrl: "/products/men-s-printed-shirt.jpg",
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
    imageUrl: "/products/women-s-kurti.jpg",
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
    imageUrl: "/products/men-s-chino-pant.jpg",
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
    imageUrl: "/products/leather-belt.jpg",
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
    imageUrl: "/products/printed-cotton-kurta.jpg",
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
    imageUrl: "/products/slim-fit-denim-jeans.jpg",
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
    imageUrl: "/products/women-s-jumpsuit.jpg",
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
    imageUrl: "/products/men-s-graphic-tee.jpg",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "MGT-001", barcode: "8900000001024", size: "L", colour: "White", priceMinor: 59900, mrpMinor: 79900, openingStock: 40 },
    ],
  },
  {
    name: "Sports Leggings",
    imageUrl: "/products/sports-leggings.jpg",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 1200,
    variants: [
      { sku: "SLG-001", barcode: "8900000001025", size: "S", colour: "Black", priceMinor: 119900, mrpMinor: 149900, openingStock: 25 },
    ],
  },
  {
    name: "Winter Puffer Jacket",
    imageUrl: "/products/winter-puffer-jacket.jpg",
    category: "Outerwear",
    brand: "Amburax Basics",
    taxRateBp: 1200,
    variants: [
      { sku: "WPJ-001", barcode: "8900000001026", size: "L", colour: "Navy", priceMinor: 349900, mrpMinor: 499900, openingStock: 10 },
    ],
  },
  {
    name: "Kids Denim Overalls",
    imageUrl: "/products/kids-denim-overalls.jpg",
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
    imageUrl: "/products/cotton-silk-saree.jpg",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "CSS-001", barcode: "8900000001029", size: null, colour: "Red", priceMinor: 499900, mrpMinor: 699900, openingStock: 5 },
    ],
  },
  {
    name: "V-Neck Sweater",
    imageUrl: "/products/v-neck-sweater.jpg",
    category: "Outerwear",
    brand: "Amburax Classic",
    taxRateBp: 1200,
    variants: [
      { sku: "VNS-001", barcode: "8900000001030", size: "M", colour: "Navy", priceMinor: 149900, mrpMinor: 199900, openingStock: 18 },
    ],
  },
  {
    name: "Pleated Skirt",
    imageUrl: "/products/pleated-skirt.jpg",
    category: "Dresses",
    brand: "Amburax Studio",
    taxRateBp: 500,
    variants: [
      { sku: "PSK-001", barcode: "8900000001031", size: "S", colour: "White", priceMinor: 109900, mrpMinor: 149900, openingStock: 22 },
    ],
  },
  {
    name: "Workout Tank Top",
    imageUrl: "/products/workout-tank-top.jpg",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "WTT-001", barcode: "8900000001032", size: "M", colour: "Green", priceMinor: 49900, mrpMinor: 69900, openingStock: 35 },
    ],
  },
  {
    name: "Fleece Joggers",
    imageUrl: "/products/fleece-joggers.jpg",
    category: "Activewear",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "FJG-001", barcode: "8900000001033", size: "L", colour: "Black", priceMinor: 129900, mrpMinor: 179900, openingStock: 15 },
    ],
  }
,
{
    name: "Summer Graphic Tee",
    imageUrl: "/products/summer-graphic-tee.jpg",
    category: "Shirts",
    brand: "Amburax Urban",
    taxRateBp: 500,
    variants: [
      { sku: "SGT-001", barcode: "8900000002001", size: "M", colour: "Yellow", priceMinor: 59900, mrpMinor: 79900, openingStock: 24 },
    ],
  },
  {
    name: "Relaxed Fit Chinos",
    imageUrl: "/products/relaxed-fit-chinos.jpg",
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
    imageUrl: "/products/vintage-denim-jacket.jpg",
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
    imageUrl: "/products/cotton-maxi-dress.jpg",
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
    imageUrl: "/products/kids-winter-beanie.jpg",
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
    imageUrl: "/products/silk-blend-kurta.jpg",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 1200,
    variants: [
      { sku: "SBK-001", barcode: "8900000002010", size: "L", colour: "Maroon", priceMinor: 199900, mrpMinor: 249900, openingStock: 12 },
    ],
  },
  {
    name: "Running Shorts",
    imageUrl: "/products/running-shorts.jpg",
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
    imageUrl: "/products/casual-crossbody-bag.jpg",
    category: "Accessories",
    brand: "Amburax Studio",
    taxRateBp: 1800,
    variants: [
      { sku: "CCB-001", barcode: "8900000002013", size: null, colour: "Brown", priceMinor: 149900, mrpMinor: 199900, openingStock: 10 },
    ],
  },
  {
    name: "Linen Blend Shirt",
    imageUrl: "/products/linen-blend-shirt.jpg",
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
    imageUrl: "/products/skinny-fit-jeans.jpg",
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
    imageUrl: "/products/embroidered-kurti.jpg",
    category: "Ethnic",
    brand: "Amburax Ethnic",
    taxRateBp: 500,
    variants: [
      { sku: "EK-001", barcode: "8900000002018", size: "M", colour: "Pink", priceMinor: 159900, mrpMinor: 209900, openingStock: 22 },
    ],
  },
  {
    name: "Performance Hoodie",
    imageUrl: "/products/performance-hoodie.jpg",
    category: "Activewear",
    brand: "Amburax Urban",
    taxRateBp: 1200,
    variants: [
      { sku: "PHD-001", barcode: "8900000002019", size: "L", colour: "Navy", priceMinor: 219900, mrpMinor: 279900, openingStock: 14 },
    ],
  },
  {
    name: "Kids Floral Frock",
    imageUrl: "/products/kids-floral-frock.jpg",
    category: "Kids",
    brand: "Amburax Basics",
    taxRateBp: 500,
    variants: [
      { sku: "KFF-001", barcode: "8900000002020", size: "4Y", colour: "Yellow", priceMinor: 89900, mrpMinor: 119900, openingStock: 25 },
    ],
  },
  {
    name: "Premium Leather Wallet",
    imageUrl: "/products/premium-leather-wallet.jpg",
    category: "Accessories",
    brand: "Amburax Classic",
    taxRateBp: 1800,
    variants: [
      { sku: "PLW-001", barcode: "8900000002021", size: null, colour: "Black", priceMinor: 119900, mrpMinor: 159900, openingStock: 18 },
    ],
  },
  {
    name: "Corduroy Overshirt",
    imageUrl: "/products/corduroy-overshirt.jpg",
    category: "Outerwear",
    brand: "Amburax Denim",
    taxRateBp: 1200,
    variants: [
      { sku: "COS-001", barcode: "8900000002022", size: "L", colour: "Brown", priceMinor: 249900, mrpMinor: 319900, openingStock: 10 },
    ],
  }
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
