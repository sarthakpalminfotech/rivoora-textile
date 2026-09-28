/**
 * Demo data. Safe to run more than once:
 * - customers / materials / designs / variations are matched by name / code and only inserted when missing;
 * - orders are only seeded when the orders table is empty.
 */
import { and, count, eq } from 'drizzle-orm';
import { format, subDays } from 'date-fns';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { STATUS, variationCode, type OrderStatusKey, type Unit } from '@rivoora/shared';
import { env } from '../env';
import { storage } from '../storage';
import { db, libsql } from './client';
import { PATTERNS, type Palette, type PatternName } from './patterns';
import { customers, designVariations, designs, materials, orderStatusHistory, orders } from './schema';

const CUSTOMERS = [
  { name: 'Ramesh Patel', phone: '9824012345', city: 'Surat', gstNumber: '24ABCPP1234F1Z5', address: 'Ring Road, Surat' },
  { name: 'Suresh Mehta', phone: '9898123456', city: 'Ahmedabad', address: 'Maskati Market, Ahmedabad' },
  { name: 'Priya Shah', phone: '9712345678', email: 'priya.shah@example.com', city: 'Surat' },
  { name: 'Anil Agarwal', phone: '9829098765', city: 'Jaipur', gstNumber: '08AAGFA5678K1Z2' },
  { name: 'Kavita Desai', phone: '9974455667', city: 'Vadodara' },
  { name: 'Mahesh Jain', phone: '9820011223', city: 'Mumbai', address: 'Kalbadevi Road, Mumbai' },
  { name: 'Nilesh Chauhan', phone: '9737788990', city: 'Rajkot' },
  { name: 'Deepa Iyer', phone: '9840066554', email: 'deepa.iyer@example.com', city: 'Chennai' },
];

const MATERIALS = [
  { name: 'Georgette', code: 'GEO' },
  { name: 'Chiffon', code: 'CHF' },
  { name: 'Silk', code: 'SLK' },
  { name: 'Cotton', code: 'COT' },
  { name: 'Crepe', code: 'CRP' },
  { name: 'Rayon', code: 'RAY' },
];

const P = {
  maroon: { base: '#FBF3E4', main: '#8B1E3F', accent: '#C9A227', light: '#E8C3A0' },
  green: { base: '#F4F1E1', main: '#1F6F4A', accent: '#C9A227', light: '#9FD3B5' },
  navy: { base: '#EEF1F8', main: '#1E3A8A', accent: '#D4A017', light: '#93C5FD' },
  magenta: { base: '#FDF0F6', main: '#B0126B', accent: '#E0B000', light: '#F9A8D4' },
  teal: { base: '#EAF7F6', main: '#0F766E', accent: '#E07A1F', light: '#99E2DA' },
  orange: { base: '#FFF5E8', main: '#C2410C', accent: '#7C2D12', light: '#FDBA74' },
  purple: { base: '#F5F0FB', main: '#5B21B6', accent: '#C9A227', light: '#C4B5FD' },
  black: { base: '#F5F5F4', main: '#1C1917', accent: '#C9A227', light: '#A8A29E' },
} satisfies Record<string, Palette>;

const DESIGNS: { code: string; name: string; pattern: PatternName; palette: Palette; variations: Palette[] }[] = [
  { code: 'D101', name: 'Zari Stripes', pattern: 'stripes', palette: P.maroon, variations: [P.navy, P.green, P.black] },
  { code: 'D102', name: 'Madras Checks', pattern: 'checks', palette: P.teal, variations: [P.maroon, P.orange] },
  { code: 'D103', name: 'Paisley Buta', pattern: 'paisley', palette: P.maroon, variations: [P.purple, P.green, P.navy] },
  { code: 'D104', name: 'Temple Border', pattern: 'border', palette: P.green, variations: [P.maroon, P.magenta] },
  { code: 'D105', name: 'Chevron Lehar', pattern: 'chevron', palette: P.magenta, variations: [P.teal, P.orange] },
  { code: 'D106', name: 'Floral Butti', pattern: 'butti', palette: P.purple, variations: [P.maroon, P.teal, P.orange] },
];

async function demoImage(name: string, svg: string) {
  const file = join(env.uploadsDir, 'demo', `${name}.webp`);
  const thumb = join(env.uploadsDir, 'demo', `${name}-thumb.webp`);
  if (existsSync(file) && existsSync(thumb)) {
    return { url: `/uploads/demo/${name}.webp`, thumbUrl: `/uploads/demo/${name}-thumb.webp` };
  }
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return storage.saveImage(png, { folder: 'demo', baseName: name });
}

async function seedCustomers() {
  const ids: number[] = [];
  for (const c of CUSTOMERS) {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.name, c.name), eq(customers.isDeleted, false)));
    if (existing) ids.push(existing.id);
    else ids.push((await db.insert(customers).values(c).returning({ id: customers.id }))[0].id);
  }
  return ids;
}

async function seedMaterials() {
  const ids: number[] = [];
  for (const m of MATERIALS) {
    const [existing] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.name, m.name), eq(materials.isDeleted, false)));
    if (existing) ids.push(existing.id);
    else ids.push((await db.insert(materials).values(m).returning({ id: materials.id }))[0].id);
  }
  return ids;
}

async function seedDesigns() {
  const result: { designId: number; variationIds: number[] }[] = [];
  for (const d of DESIGNS) {
    const img = await demoImage(d.code.toLowerCase(), PATTERNS[d.pattern](d.palette));
    let [design] = await db
      .select({ id: designs.id })
      .from(designs)
      .where(and(eq(designs.code, d.code), eq(designs.isDeleted, false)));
    if (!design) {
      [design] = await db
        .insert(designs)
        .values({ code: d.code, name: d.name, imageUrl: img.url, thumbUrl: img.thumbUrl, notes: 'Demo design' })
        .returning({ id: designs.id });
    }
    const variationIds: number[] = [];
    for (let i = 0; i < d.variations.length; i++) {
      const no = i + 1;
      const code = variationCode(d.code, no);
      const vImg = await demoImage(code.toLowerCase(), PATTERNS[d.pattern](d.variations[i]));
      let [variation] = await db
        .select({ id: designVariations.id })
        .from(designVariations)
        .where(and(eq(designVariations.designId, design.id), eq(designVariations.variationNo, no)));
      if (!variation) {
        [variation] = await db
          .insert(designVariations)
          .values({ designId: design.id, variationNo: no, code, imageUrl: vImg.url, thumbUrl: vImg.thumbUrl })
          .returning({ id: designVariations.id });
      }
      variationIds.push(variation.id);
    }
    result.push({ designId: design.id, variationIds });
  }
  return result;
}

async function seedOrders(customerIds: number[], materialIds: number[], designRefs: Awaited<ReturnType<typeof seedDesigns>>) {
  const [{ existing }] = await db.select({ existing: count() }).from(orders);
  if (existing > 0) {
    console.log(`  orders: ${existing} already exist — skipping demo orders`);
    return;
  }

  const units: Unit[] = ['meters', 'meters', 'kg', 'pcs', 'meters', 'g'];
  // [customerIdx, materialIdx, designIdx | -1, variationIdx | -1, qty, unitIdx, rate | null, daysAgo, ready?]
  const plan: [number, number, number, number, number, number, number | null, number, boolean][] = [
    [0, 0, 0, -1, 250, 0, 185, 44, true],
    [1, 2, 2, 0, 120, 0, 640, 42, true],
    [2, 1, 1, -1, 40, 3, 950, 40, true],
    [0, 0, 0, -1, 300, 0, 180, 38, true], // repeat D101 for Ramesh
    [3, 3, 3, 1, 12.5, 2, 420, 36, true],
    [4, 4, 4, -1, 500, 0, 140, 33, true],
    [5, 5, 5, 2, 75, 3, 780, 31, true],
    [0, 2, 2, 0, 150, 0, 650, 29, true],
    [6, 0, 0, 1, 220, 0, 190, 27, true],
    [7, 1, 5, -1, 60, 3, 880, 25, true],
    [1, 2, 2, 0, 180, 0, 660, 23, true], // repeat D103N1 for Suresh
    [2, 3, -1, -1, 8, 2, null, 21, false],
    [3, 4, 1, 1, 400, 0, 155, 19, true],
    [0, 0, 0, 1, 260, 0, 188, 17, false], // D101N2 for Ramesh
    [4, 5, 3, -1, 35, 3, 720, 15, true],
    [5, 1, 4, 0, 900, 5, 2.5, 13, false],
    [6, 2, 5, 1, 110, 0, 690, 11, true],
    [7, 0, 0, 2, 140, 0, 195, 9, false],
    [0, 3, 3, 0, 20, 2, 410, 7, false],
    [1, 2, 2, -1, 90, 0, 640, 6, false],
    [2, 1, 1, -1, 45, 3, 960, 5, false], // repeat D102 for Priya
    [3, 4, 4, 1, 350, 0, 150, 3, false],
    [4, 0, -1, -1, 200, 0, 175, 2, false],
    [5, 5, 5, -1, 60, 3, 800, 1, false],
    [0, 0, 0, -1, 275, 0, 185, 0, false], // third D101 for Ramesh
  ];

  const today = new Date();
  for (let i = 0; i < plan.length; i++) {
    const [ci, mi, di, vi, quantity, ui, rate, daysAgo, ready] = plan[i];
    const design = di >= 0 ? designRefs[di] : null;
    const orderDate = format(subDays(today, daysAgo), 'yyyy-MM-dd');
    const createdAt = subDays(today, daysAgo).toISOString();
    const sentAt = ready ? subDays(today, Math.max(daysAgo - 1, 0)).toISOString() : null;
    const status: OrderStatusKey = ready ? STATUS.READY_PRODUCTION : STATUS.PENDING_PRODUCTION;
    const [order] = await db
      .insert(orders)
      .values({
        orderNo: i + 1,
        customerId: customerIds[ci],
        materialId: materialIds[mi],
        designId: design?.designId ?? null,
        variationId: design && vi >= 0 ? (design.variationIds[vi] ?? null) : null,
        quantity,
        unit: units[ui],
        rate,
        orderDate,
        notes: i % 4 === 0 ? 'Deliver in two lots. Pack each lot separately.' : null,
        status,
        sentToProductionAt: sentAt,
        createdAt,
        updatedAt: sentAt ?? createdAt,
      })
      .returning({ id: orders.id });
    await db.insert(orderStatusHistory).values({
      orderId: order.id,
      fromStatus: null,
      toStatus: STATUS.PENDING_PRODUCTION,
      role: 'jemish',
      changedAt: createdAt,
    });
    if (ready && sentAt) {
      await db.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: STATUS.PENDING_PRODUCTION,
        toStatus: STATUS.READY_PRODUCTION,
        role: 'jemish',
        changedAt: sentAt,
      });
    }
  }
  console.log(`  orders: ${plan.length} created`);
}

async function main() {
  console.log('Seeding demo data…');
  const customerIds = await seedCustomers();
  console.log(`  customers: ${customerIds.length}`);
  const materialIds = await seedMaterials();
  console.log(`  materials: ${materialIds.length}`);
  const designRefs = await seedDesigns();
  console.log(`  designs: ${designRefs.length} (with variations)`);
  await seedOrders(customerIds, materialIds, designRefs);
  console.log('Done.');
  libsql.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
