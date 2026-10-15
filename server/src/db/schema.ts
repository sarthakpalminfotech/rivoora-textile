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
import type {
  ChallanKind,
  BlouseOption,
  ChallanStatus,
  DamageRecordedAt,
  DamageStatus,
  DamageType,
  FreeStockReason,
  JobsheetEventKind,
  JobsheetStatusKey,
  OrderStatusKey,
  OrderType,
  RoleKey,
  TakaEventKind,
  TakaStage,
  Unit,
} from '@rivoora/shared';

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

/** Brokers of a customer — just names. Soft-deleted when removed (they stay on old orders). */
export const customerBrokers = sqliteTable(
  'customer_brokers',
  {
    id: id(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    name: text('name').notNull(),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customer_brokers_customer_idx').on(t.customerId),
    uniqueIndex('customer_brokers_name_active_unique')
      .on(t.customerId, sql`lower(${t.name})`)
      .where(sql`${t.isDeleted} = 0`),
  ],
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
    /** Goes for butta cutting? Decides the stage of takas entered from now on (existing designs were backfilled true). */
    buttaCutting: integer('butta_cutting', { mode: 'boolean' }).notNull().default(true),
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
    /** Optional broker — one of the customer's brokers. */
    brokerId: integer('broker_id').references(() => customerBrokers.id),
    /** `lump` | `pcs_to_pcs` — required on new orders; existing orders were backfilled as `pcs_to_pcs`. */
    orderType: text('order_type').$type<OrderType>().notNull().default('pcs_to_pcs'),
    /** Sprint 13: optional blouse option (`with_blouse` | `without_blouse`); null = not set. */
    blouseOption: text('blouse_option').$type<BlouseOption>(),
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
    index('orders_broker_idx').on(t.brokerId),
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
    /** Sprint 12: the real logged-in user. Null on older rows. */
    userId: integer('user_id'),
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
    /** Common note of the taka entry (appended on every entry, editable by Jenish / Gaurang). */
    takaNote: text('taka_note'),
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
    /** Sprint 12: the real logged-in user. Null on older rows. */
    userId: integer('user_id'),
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

/** Damage master: WHAT a damage is (Hole, Oil stain…). Names are unique (case-insensitive) among active rows. */
export const damages = sqliteTable(
  'damages',
  {
    id: id(),
    name: text('name').notNull(),
    notes: text('notes'),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('damages_name_active_unique').on(sql`lower(${t.name})`).where(sql`${t.isDeleted} = 0`)],
);

/**
 * Takas: numbered cloth pieces of a jobsheet, entered at the Taka entry desk. Since Sprint 7 a taka number is unique
 * across the whole system (a partial unique index on `taka_no` among active rows). Soft-deleted when removed in an edit.
 */
export const takas = sqliteTable(
  'takas',
  {
    id: id(),
    jobsheetId: integer('jobsheet_id')
      .notNull()
      .references(() => jobsheets.id),
    /** Denormalized for order-level queries. */
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    takaNo: text('taka_no').notNull(),
    /** Length of the taka in meters (optional, up to 2 decimals). */
    meters: real('meters'),
    /** Pieces in the taka (1–9999). Required by the API on new / edited takas; null on older takas. */
    pcs: integer('pcs'),
    /** Denormalized: the taka has at least one OPEN row in `taka_damages` (recomputed on every damage write). */
    isDamaged: integer('is_damaged', { mode: 'boolean' }).notNull().default(false),
    /** @deprecated Sprint 7: damages live in `taka_damages` now. Kept in the DB, no longer read or written. */
    damageType: text('damage_type').$type<DamageType>(),
    /** @deprecated Sprint 7: damages live in `taka_damages` now. Kept in the DB, no longer read or written. */
    damageId: integer('damage_id').references(() => damages.id),
    /** Where the taka is: `entered` today; later sprints move it on (TAKA_STAGES in shared/pipeline.ts). */
    stage: text('stage').$type<TakaStage>().notNull().default('entered'),
    /** How many times the taka was sent to refinish (Mill QC / godown). */
    refinishCount: integer('refinish_count').notNull().default(0),
    /** The taka this one was split from (godown split). */
    parentTakaId: integer('parent_taka_id').references((): AnySQLiteColumn => takas.id),
    /** Pcs counted by the godown supervisor; null = same as `pcs`. */
    actualPcs: integer('actual_pcs'),
    /** Ticked by the godown supervisor ("I have checked this taka"). */
    godownCheckedAt: text('godown_checked_at'),
    godownCheckedBy: text('godown_checked_by').$type<RoleKey>(),
    /** Sprint 12: how many times the owner sent the taka back to butta cutting. */
    reworkCount: integer('rework_count').notNull().default(0),
    /** Sprint 12: set when the taka came back from a customer (GR) — and from which dispatch challan. */
    returnedAt: text('returned_at'),
    returnedFromChallanId: integer('returned_from_challan_id'),
    /** Sprint 12: the one taka made for a pcs-to-pcs goods return (no taka numbers on such a challan). */
    isReturnLot: integer('is_return_lot', { mode: 'boolean' }).notNull().default(false),
    /** Sprint 12: the order the taka was first made for (set when it is moved to another order). */
    originOrderId: integer('origin_order_id').references(() => orders.id),
    /** Sprint 13: free stock = stock that belongs to no order (`order_id` stays the ORIGIN order). */
    isFreeStock: integer('is_free_stock', { mode: 'boolean' }).notNull().default(false),
    freeStockAt: text('free_stock_at'),
    freeStockBy: text('free_stock_by').$type<RoleKey>(),
    freeStockReason: text('free_stock_reason').$type<FreeStockReason>(),
    /** Sprint 13: the order a free-stock taka was assigned to (it then counts for that order, not the origin one). */
    allocatedOrderId: integer('allocated_order_id').references(() => orders.id),
    /** Sprint 13: the taka (or one of its ancestors through `parent_taka_id`) has been to the mill. */
    hasBeenToMill: integer('has_been_to_mill', { mode: 'boolean' }).notNull().default(false),
    enteredBy: text('entered_by').$type<RoleKey>().notNull(),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('takas_parent_idx').on(t.parentTakaId),
    index('takas_jobsheet_idx').on(t.jobsheetId),
    index('takas_order_idx').on(t.orderId),
    index('takas_taka_no_idx').on(t.takaNo),
    index('takas_stage_idx').on(t.stage),
    index('takas_free_stock_idx').on(t.isFreeStock),
    index('takas_allocated_order_idx').on(t.allocatedOrderId),
    index('takas_damage_idx').on(t.damageId),
    uniqueIndex('takas_taka_no_active_unique').on(t.takaNo).where(sql`${t.isDeleted} = 0`),
  ],
);

/**
 * Damages of a taka (the source of truth since Sprint 7). A taka can have several: where they were found
 * (machine / butta / mill), the damaged pcs, and whether they are still open or were resolved (e.g. at butta QC).
 */
export const takaDamages = sqliteTable(
  'taka_damages',
  {
    id: id(),
    takaId: integer('taka_id')
      .notNull()
      .references(() => takas.id),
    /** WHAT the damage is (Damage master). Null on an older damage recorded without a name. */
    damageId: integer('damage_id').references(() => damages.id),
    /**
     * The damage TYPE chosen by the person marking it (`machine` | `butta` | `mill`). `unmarked` = "Damage type not
     * marked" (goods return only; Sprint 13 — kept as a value, not NULL, so the column needs no rebuild).
     */
    foundAt: text('found_at').$type<DamageType>().notNull().default('machine'),
    /** Sprint 13: WHERE it was recorded (taka entry, butta QC, godown, …). Null on rows that could not be backfilled. */
    recordedAt: text('recorded_at').$type<DamageRecordedAt>(),
    /** Damaged pcs (1 to the taka's pcs). Null only on migrated rows. */
    pcs: integer('pcs'),
    /** Pcs resolved so far (a partial resolve keeps the damage open). Open pcs = pcs − resolved_pcs. */
    resolvedPcs: integer('resolved_pcs').notNull().default(0),
    status: text('status').$type<DamageStatus>().notNull().default('open'),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by').$type<RoleKey>(),
    /** e.g. `butta_qc` */
    resolvedStage: text('resolved_stage'),
    createdBy: text('created_by').$type<RoleKey>().notNull(),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('taka_damages_taka_idx').on(t.takaId), index('taka_damages_status_idx').on(t.status, t.foundAt)],
);

/** Photos of a damage (added at the Butta QC, shown in the taka details drawer and the damage details screen only). */
export const takaDamageImages = sqliteTable(
  'taka_damage_images',
  {
    id: id(),
    takaDamageId: integer('taka_damage_id')
      .notNull()
      .references(() => takaDamages.id),
    imageUrl: text('image_url').notNull(),
    thumbUrl: text('thumb_url').notNull(),
    createdBy: text('created_by').$type<RoleKey>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('taka_damage_images_damage_idx').on(t.takaDamageId)],
);

/** History of a taka: one row per taka action. */
export const takaEvents = sqliteTable(
  'taka_events',
  {
    id: id(),
    takaId: integer('taka_id')
      .notNull()
      .references(() => takas.id),
    event: text('event').$type<TakaEventKind>().notNull(),
    challanId: integer('challan_id').references((): AnySQLiteColumn => challans.id),
    /** The damage a damage event is about (the damage details timeline). */
    takaDamageId: integer('taka_damage_id').references((): AnySQLiteColumn => takaDamages.id),
    note: text('note'),
    role: text('role').$type<RoleKey>().notNull(),
    /** Sprint 12: the real logged-in user (the role may be an acted-as role). Null on older events. */
    userId: integer('user_id'),
    /** Sprint 12: the dispatch challan a dispatched / goods_returned event is about. */
    dispatchChallanId: integer('dispatch_challan_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('taka_events_taka_idx').on(t.takaId)],
);

/** Butta parties (outsourced butta cutting). The name is printed as "M/s. …" on the challan. */
export const buttaParties = sqliteTable(
  'butta_parties',
  {
    id: id(),
    name: text('name').notNull(),
    address: text('address'),
    mobile: text('mobile'),
    gstin: text('gstin'),
    notes: text('notes'),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('butta_parties_name_active_unique').on(sql`lower(${t.name})`).where(sql`${t.isDeleted} = 0`)],
);

/** Mill parties (dyeing / finishing). Same fields and rules as the butta parties. */
export const millParties = sqliteTable(
  'mill_parties',
  {
    id: id(),
    name: text('name').notNull(),
    address: text('address'),
    mobile: text('mobile'),
    gstin: text('gstin'),
    notes: text('notes'),
    isDeleted: isDeleted(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('mill_parties_name_active_unique').on(sql`lower(${t.name})`).where(sql`${t.isDeleted} = 0`)],
);

/**
 * Delivery challans — butta cutting (`GSM-n`) and mill (`MIL-n`) share this table (`kind`). `challan_no` comes from the
 * counter of its kind (never reused). `party_id` points to `butta_parties` or `mill_parties` by kind (no FK).
 */
export const challans = sqliteTable(
  'challans',
  {
    id: id(),
    kind: text('kind').$type<ChallanKind>().notNull().default('butta'),
    challanNo: integer('challan_no').notNull(),
    partyId: integer('party_id').notNull(),
    /** yyyy-MM-dd */
    challanDate: text('challan_date').notNull(),
    ewayNo: text('eway_no'),
    /** Mill challans: how many takas the godown supervisor counted as received (just a count; the QC finds out which). */
    receivedCount: integer('received_count').notNull().default(0),
    status: text('status').$type<ChallanStatus>().notNull().default('active'),
    cancelledAt: text('cancelled_at'),
    cancelledBy: text('cancelled_by').$type<RoleKey>(),
    createdBy: text('created_by').$type<RoleKey>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('challans_kind_challan_no_unique').on(t.kind, t.challanNo),
    index('challans_party_idx').on(t.kind, t.partyId),
    index('challans_status_idx').on(t.status),
  ],
);

/**
 * The takas of a challan with their meters / pcs AT THE TIME OF SENDING (the print never changes after QC edits).
 * `is_active` = the row counts (false once the challan is cancelled): one active challan per taka PER KIND.
 */
export const challanTakas = sqliteTable(
  'challan_takas',
  {
    id: id(),
    challanId: integer('challan_id')
      .notNull()
      .references(() => challans.id),
    /** Denormalized from the challan (the unique index below needs it). */
    kind: text('kind').$type<ChallanKind>().notNull().default('butta'),
    takaId: integer('taka_id')
      .notNull()
      .references(() => takas.id),
    /** Denormalized for order-level queries. */
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    meters: real('meters'),
    pcs: integer('pcs'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Mill: this trip is a refinish (the taka came from the refinish stage). */
    isRefinish: integer('is_refinish', { mode: 'boolean' }).notNull().default(false),
    receivedAt: text('received_at'),
    receivedBy: text('received_by').$type<RoleKey>(),
    /** Butta QC completed. */
    qcDoneAt: text('qc_done_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('challan_takas_challan_idx').on(t.challanId),
    index('challan_takas_order_idx').on(t.orderId),
    index('challan_takas_taka_idx').on(t.takaId),
    uniqueIndex('challan_takas_taka_kind_active_unique').on(t.takaId, t.kind).where(sql`${t.isActive} = 1`),
  ],
);

/* ------------------------------------------------------------------ */
/* Sprint 12: dispatch, goods return, users + sessions                  */
/* ------------------------------------------------------------------ */

/**
 * Dispatch challans (DC-n). Their own tables (not the generic challans): they go to a CLIENT (the order's customer),
 * and a goods return makes a REVISION of the same number (DC-12 then DC-12 R1), which the generic unique
 * (kind, challan_no) index would not allow. revision 0 = the original; a revised row stays for history.
 */
export const dispatchChallans = sqliteTable(
  'dispatch_challans',
  {
    id: id(),
    challanNo: integer('challan_no').notNull(),
    revision: integer('revision').notNull().default(0),
    parentChallanId: integer('parent_challan_id').references((): AnySQLiteColumn => dispatchChallans.id),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    /** yyyy-MM-dd */
    challanDate: text('challan_date').notNull(),
    transport: text('transport'),
    lrNo: text('lr_no'),
    ewayNo: text('eway_no'),
    /** active = the latest revision · revised = replaced by a later revision (kept for history). */
    status: text('status').$type<'active' | 'revised'>().notNull().default('active'),
    createdBy: text('created_by').$type<RoleKey>().notNull(),
    createdByUserId: integer('created_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('dispatch_challans_no_revision_unique').on(t.challanNo, t.revision),
    index('dispatch_challans_order_idx').on(t.orderId),
    index('dispatch_challans_status_idx').on(t.status),
  ],
);

/** The takas of a dispatch challan revision, with the taka number / meters / pcs AT THE TIME of dispatch. */
export const dispatchChallanTakas = sqliteTable(
  'dispatch_challan_takas',
  {
    id: id(),
    challanId: integer('challan_id')
      .notNull()
      .references(() => dispatchChallans.id),
    takaId: integer('taka_id')
      .notNull()
      .references(() => takas.id),
    takaNo: text('taka_no').notNull(),
    meters: real('meters'),
    pcs: integer('pcs'),
    createdAt: createdAt(),
  },
  (t) => [index('dispatch_challan_takas_challan_idx').on(t.challanId), index('dispatch_challan_takas_taka_idx').on(t.takaId)],
);

/** One goods return (GR): which challan it was made on, the revision it created, and the totals. */
export const goodsReturns = sqliteTable(
  'goods_returns',
  {
    id: id(),
    /** The revision that was returned against (now Revised). */
    challanId: integer('challan_id')
      .notNull()
      .references(() => dispatchChallans.id),
    /** The revision the GR created. */
    newChallanId: integer('new_challan_id').references(() => dispatchChallans.id),
    returnDate: text('return_date').notNull(),
    note: text('note'),
    role: text('role').$type<RoleKey>().notNull(),
    userId: integer('user_id'),
    returnedTakas: integer('returned_takas').notNull().default(0),
    returnedPcs: integer('returned_pcs').notNull().default(0),
    damagedPcs: integer('damaged_pcs').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('goods_returns_challan_idx').on(t.challanId)],
);

/** The takas a goods return brought back (a pcs-to-pcs GR lists its return-lot taka). */
export const goodsReturnTakas = sqliteTable(
  'goods_return_takas',
  {
    id: id(),
    goodsReturnId: integer('goods_return_id')
      .notNull()
      .references(() => goodsReturns.id),
    takaId: integer('taka_id')
      .notNull()
      .references(() => takas.id),
    pcs: integer('pcs'),
    damagedPcs: integer('damaged_pcs').notNull().default(0),
  },
  (t) => [index('goods_return_takas_gr_idx').on(t.goodsReturnId)],
);

/** Users who log in (phone + password). Roles are fixed in code; this table only holds who has which role. */
export const users = sqliteTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    /** 10 digits, unique among active users. */
    phone: text('phone').notNull(),
    role: text('role').$type<RoleKey>().notNull(),
    /** scrypt: scrypt$salt-hex$hash-hex. Never logged or returned. */
    passwordHash: text('password_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastLoginAt: text('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_phone_active_unique').on(t.phone).where(sql`${t.isActive} = 1`)],
);

/** Login sessions: id is the SHA-256 of the random 32-byte token held in the cookie. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull().default(nowIso),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/** Named running counters (e.g. `jobsheet_no`). Allocate inside the write transaction. */
export const counters = sqliteTable('counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull().default(0),
});
