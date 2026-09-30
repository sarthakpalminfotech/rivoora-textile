import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type { JobsheetEventKind, JobsheetStatusKey, OrderStatusKey, RoleKey, Unit } from '@rivoora/shared';

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () => text('created_at').notNull().default(nowIso);
const updatedAt = () =>
  text('updated_at')
    .notNull()
    .default(nowIso)
    .$onUpdate(() => new Date().toISOString());
const isDeleted = () => integer('is_deleted', { mode: 'boolean' }).notNull().default(false);

export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    name: text('name').notNull(),
    phone: text('phone'),
    alternatePhone: text('alternate_phone'),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    gstNumber: text('gst_number'),
    notes: text('notes'),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('customers_name_idx').on(t.name)],
);

export const materials = sqliteTable(
  'materials',
  {
    id: id(),
    name: text('name').notNull(),
    code: text('code'),
    notes: text('notes'),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('materials_name_idx').on(t.name),
    uniqueIndex('materials_name_active_unique')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.isDeleted} = 0`),
  ],
);

export const designs = sqliteTable(
  'designs',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name'),
    imageUrl: text('image_url'),
    thumbUrl: text('thumb_url'),
    notes: text('notes'),
    /** Optional fixed material — pre-selected on new orders using this design. */
    materialId: integer('material_id').references(() => materials.id),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('designs_code_idx').on(t.code),
    index('designs_material_idx').on(t.materialId),
    uniqueIndex('designs_code_active_unique').on(t.code).where(sql`${t.isDeleted} = 0`),
  ],
);

export const designVariations = sqliteTable(
  'design_variations',
  {
    id: id(),
    designId: integer('design_id')
      .notNull()
      .references(() => designs.id),
    variationNo: integer('variation_no').notNull(),
    code: text('code').notNull(),
    imageUrl: text('image_url'),
    thumbUrl: text('thumb_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('design_variations_design_idx').on(t.designId),
    index('design_variations_code_idx').on(t.code),
    uniqueIndex('design_variations_design_no_unique').on(t.designId, t.variationNo),
  ],
);

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    orderNo: integer('order_no').notNull(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    materialId: integer('material_id')
      .notNull()
      .references(() => materials.id),
    designId: integer('design_id').references(() => designs.id),
    variationId: integer('variation_id').references(() => designVariations.id),
    quantity: real('quantity').notNull(),
    unit: text('unit').$type<Unit>().notNull(),
    rate: real('rate'),
    orderDate: text('order_date').notNull(),
    notes: text('notes'),
    status: text('status').$type<OrderStatusKey>().notNull(),
    sentToProductionAt: text('sent_to_production_at'),
    /** Jobsheet plan: total pieces planned across all jobsheet runs ("jobsheet quantity"). */
    jobsheetPieces: integer('jobsheet_pieces').notNull().default(0),
    /** Jobsheet plan: total frames the jobsheets should cover. */
    targetFrames: integer('target_frames').notNull().default(0),
    /** Jobsheet plan: frames per jobsheet of the latest multi-jobsheet run (used when splitting). */
    framesPerJobsheet: integer('frames_per_jobsheet'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_order_no_unique').on(t.orderNo),
    index('orders_status_idx').on(t.status),
    index('orders_order_date_idx').on(t.orderDate),
    index('orders_customer_idx').on(t.customerId),
    index('orders_material_idx').on(t.materialId),
    index('orders_design_idx').on(t.designId),
  ],
);

export const orderNoteImages = sqliteTable(
  'order_note_images',
  {
    id: id(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    imageUrl: text('image_url').notNull(),
    thumbUrl: text('thumb_url').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('order_note_images_order_idx').on(t.orderId)],
);

export const orderStatusHistory = sqliteTable(
  'order_status_history',
  {
    id: id(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').$type<OrderStatusKey>(),
    toStatus: text('to_status').$type<OrderStatusKey>().notNull(),
    role: text('role').$type<RoleKey>().notNull(),
    changedAt: text('changed_at').notNull().default(nowIso),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('order_status_history_order_idx').on(t.orderId)],
);

export const machines = sqliteTable(
  'machines',
  {
    id: id(),
    machineNo: integer('machine_no').notNull(),
    name: text('name'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('machines_machine_no_active_unique').on(t.machineNo).where(sql`${t.isDeleted} = 0`)],
);

export const jobsheets = sqliteTable(
  'jobsheets',
  {
    id: id(),
    /** Global running number from the `counters` table — never reused, even after deletion. */
    jobsheetNo: integer('jobsheet_no').notNull(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    /** Assigned frames. */
    frames: integer('frames').notNull(),
    picks: text('picks'),
    createdBy: text('created_by').$type<RoleKey>().notNull(),
    /** pending → sent → ongoing → completed (see JOBSHEET_STATUSES in shared). */
    status: text('status').$type<JobsheetStatusKey>().notNull().default('pending'),
    sentAt: text('sent_at'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    /** The machine it was started on. */
    runningMachineId: integer('running_machine_id').references(() => machines.id),
    /** Actual frames made (set on Complete / Change machine). */
    completedFrames: integer('completed_frames'),
    /** Set on the new jobsheet created by Change machine. */
    parentJobsheetId: integer('parent_jobsheet_id').references((): AnySQLiteColumn => jobsheets.id),
    /** Machine chosen in Change machine — pre-selected at Start. */
    suggestedMachineId: integer('suggested_machine_id').references(() => machines.id),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('jobsheets_jobsheet_no_unique').on(t.jobsheetNo),
    index('jobsheets_order_idx').on(t.orderId),
    index('jobsheets_status_idx').on(t.status),
    index('jobsheets_running_machine_idx').on(t.runningMachineId),
  ],
);

/** Activity timeline of a jobsheet. One row per action. */
export const jobsheetEvents = sqliteTable(
  'jobsheet_events',
  {
    id: id(),
    jobsheetId: integer('jobsheet_id')
      .notNull()
      .references(() => jobsheets.id, { onDelete: 'cascade' }),
    event: text('event').$type<JobsheetEventKind>().notNull(),
    machineId: integer('machine_id').references(() => machines.id),
    frames: integer('frames'),
    note: text('note'),
    role: text('role').$type<RoleKey>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobsheet_events_jobsheet_idx').on(t.jobsheetId)],
);

export const jobsheetMachines = sqliteTable(
  'jobsheet_machines',
  {
    jobsheetId: integer('jobsheet_id')
      .notNull()
      .references(() => jobsheets.id, { onDelete: 'cascade' }),
    machineId: integer('machine_id')
      .notNull()
      .references(() => machines.id),
  },
  (t) => [primaryKey({ columns: [t.jobsheetId, t.machineId] }), index('jobsheet_machines_machine_idx').on(t.machineId)],
);

/** Named running counters (e.g. `jobsheet_no`). Allocate inside the write transaction. */
export const counters = sqliteTable('counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull().default(0),
});
