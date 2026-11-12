/**
 * Sprint 26 — demo master data: names that read like a Surat power-loom business. Index 0 entries with long names are
 * the deliberate 60+ character edge cases.
 */

/** [name, city, weight] — weight = how much they order (the top three carry about half the value). */
export const DEMO_CUSTOMERS: [string, string, number][] = [
  ['Shree Ambica Saree Emporium and Wholesale Textile Traders Private Limited', 'Surat', 6],
  ['Laxmi Narayan Silk Mills', 'Surat', 5],
  ['Rajhans Fashions', 'Mumbai', 4],
  ['Gokuldham Creations', 'Ahmedabad', 1.4],
  ['Patel Brothers Textiles', 'Surat', 1.3],
  ['Mahalaxmi Saree Centre', 'Jaipur', 1.2],
  ['Bhagwati Fabrics', 'Surat', 1.2],
  ['Om Sai Textiles', 'Indore', 1.1],
  ['Kesariya Sarees', 'Kolkata', 1.1],
  ['Jai Ambe Fashion House', 'Surat', 1],
  ['Navkar Silk Palace', 'Mumbai', 1],
  ['Radhe Krishna Prints', 'Surat', 1],
  ['Shubh Laxmi Collections', 'Hyderabad', 0.9],
  ['Ganesh Textile Agency', 'Pune', 0.9],
  ['Sanskruti Sarees', 'Vadodara', 0.9],
  ['Vrundavan Fabrics', 'Rajkot', 0.8],
  ['Mangalam Silk House', 'Chennai', 0.8],
  ['Arihant Saree Bhandar', 'Delhi', 0.8],
  ['Kanchan Fashions', 'Lucknow', 0.7],
  ['Parvati Textiles', 'Surat', 0.7],
  // the next four order regularly and then stop ("Clients gone quiet")
  ['Hari Om Saree Mart', 'Bhiwandi', 1],
  ['Nilkanth Creations', 'Ahmedabad', 1],
  ['Sai Darshan Textiles', 'Nagpur', 1],
  ['Dwarkesh Silk Mills', 'Surat', 1],
  ['Chamunda Fabrics', 'Bhopal', 0.6],
];
/** Indexes of the customers that went quiet. */
export const QUIET_CUSTOMERS = [20, 21, 22, 23];

/** [customer index, broker name] — 8 brokers. */
export const DEMO_BROKERS: [number, string][] = [
  [0, 'Kishorbhai Dalal'],
  [0, 'Jayesh Agency'],
  [1, 'Manoj Shah & Co.'],
  [2, 'Vinod Kothari'],
  [4, 'Pankaj Brokers'],
  [6, 'Hitesh Bhai'],
  [9, 'Dilip Textile Agency'],
  [12, 'Ramesh Brokers'],
];

const QUALITY_BASE = [
  'Georgette', 'Chiffon', 'Silk', 'Cotton', 'Crepe', 'Rayon', 'Dola Silk', 'Vichitra', 'Chanderi', 'Banarasi',
  'Linen', 'Satin', 'Organza', 'Tissue', 'Moss Chiffon', 'Bemberg', 'Jacquard', 'Brasso', 'Lycra', 'Net',
  'Kota Doria', 'Tussar', 'Muslin', 'Viscose', 'Poly Silk', 'Art Silk', 'Pure Crepe', 'Barfi Silk', 'Rangoli', 'Zari Weave',
  'Sana Silk', 'Dupion', 'Khadi', 'Modal', 'Silk Cotton', 'Shimmer', 'Velvet', 'Cotton Silk',
];
/** 40 qualities: 38 plain + one 60+ character name + one that ends up with zero stock. */
export const DEMO_QUALITIES: string[] = [
  ...QUALITY_BASE,
  'Premium Heavy Georgette with Golden Zari Border and Pallu Weave 60 GSM',
  'Old Tissue (no stock)',
];
/** Index of the quality whose orders are all dispatched (zero stock on the inventory screen). */
export const ZERO_STOCK_QUALITY = 39;

export const DESIGN_NAMES = [
  'Paisley', 'Peacock', 'Lotus', 'Kalka', 'Bandhani', 'Leheriya', 'Ikat', 'Patola', 'Zari Butta', 'Floral Jaal',
  'Temple Border', 'Mango Buti', 'Checks', 'Stripes', 'Chevron', 'Polka', 'Rose Vine', 'Elephant', 'Mor Pankh', 'Kairi',
];

export const BUTTA_PARTIES = [
  'Shree Ganesh Butta Cutting and Hand Finishing Works, Udhna Magdalla Road, Surat',
  'Maa Khodiyar Butta Works',
  'Jalaram Cutting Centre',
  'Bapa Sitaram Butta',
  'Umiya Finishing',
  'Krishna Butta Cutting',
];
export const MILL_PARTIES = ['Anupam Dyeing Mills', 'Laxmipati Process House', 'Sachin GIDC Dyers', 'Pandesara Prints', 'Reliable Process'];
/** [name, short code] */
export const WEAVERS: [string, string][] = [
  ['Shree Textiles', 'S'],
  ['Mahadev Weaving', 'M'],
  ['Kiran Looms', 'K'],
  ['Bhavani Weavers', 'B'],
  ['Rachana Fabrics', 'R'],
  ['Tulsi Looms', 'T'],
  ['Prakash Weaving Works', 'P'],
  ['Navrang Looms', 'N'],
];
export const FG_SUPPLIERS = ['Varanasi Handloom House', 'Kanchipuram Silk Traders', 'Bhagalpur Tussar Co.', 'Maheshwari Weaves'];

export const DAMAGE_NAMES = [
  'Hole', 'Oil stain', 'Missing pick', 'Broken warp', 'Float', 'Colour bleed', 'Uneven dye', 'Cut mark', 'Shade variation',
  'Thread pull', 'Reed mark', 'Starting mark', 'Butta missing', 'Patch',
];

export const YARN_PARTIES = [
  'Reliance Polyester Yarn Depot', 'Garden Silk Mills', 'Sangam Yarns', 'Vardhman Filaments', 'Sumilon Industries',
  'Nahar Spinning', 'Bhilosa Yarns', 'JBF Traders', 'Indorama Agency', 'Raj Yarn Merchants',
];
/** [name, denier, filament, min kg | null] */
export const YARN_QUALITIES: [string, string, string, number | null][] = [
  ['75D Poly', '75', '36', 400],
  ['150D Poly', '150', '48', 300],
  ['100D Viscose', '100', '40', 250],
  ['120D Viscose', '120', '30', null],
  ['50D Nylon', '50', '24', 200],
  ['70D Nylon', '70', '24', null],
  ['30s Cotton', '30', '1', 500],
  ['40s Cotton', '40', '1', null],
  ['Zari Gold', '120', '1', 80],
  ['Zari Silver', '120', '1', null],
  ['80D Semi-dull', '80', '36', null],
  ['300D Poly', '300', '96', null],
  ['20D Lycra', '20', '1', null],
  ['60D Silk Feel', '60', '24', null],
  ['Bamboo 40s', '40', '1', null],
];
export const WARPING_QUALITIES = [
  '75/36 Poly 75D-600-S', '75/36 Poly 75D-600-Z', '100/40 Viscose 100D-800-S', '150/48 Poly 150D-400-S', '50/24 Nylon 50D-900-Z',
  '70/24 Nylon 70D-700-S', '80/36 Semi-dull 80D-600-S', '120/30 Viscose 120D-500-Z', 'Cotton warp 30s', 'Zari warp',
];
