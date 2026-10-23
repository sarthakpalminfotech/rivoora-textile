-- Sprint 16: order steps (Production · Butta cutting · Mill), outside POs + receipts, direct FG purchase, Close order.
-- ADDITIVE ONLY: new tables, new columns with defaults, new indexes, and one backfill that only fills a NEW column.
-- No table rebuild, nothing dropped or renamed.
CREATE TABLE `weavers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`short_code` text NOT NULL,
	`mobile` text,
	`address` text,
	`gstin` text,
	`notes` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weavers_short_code_active_unique` ON `weavers` (`short_code`) WHERE "weavers"."is_deleted" = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `weavers_name_active_unique` ON `weavers` (lower("name")) WHERE "weavers"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `outside_pos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_no` integer NOT NULL,
	`order_id` integer NOT NULL,
	`weaver_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`order_type` text NOT NULL,
	`rate` real,
	`po_date` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'open' NOT NULL,
	`received_qty` real DEFAULT 0 NOT NULL,
	`received_takas` integer DEFAULT 0 NOT NULL,
	`closed_at` text,
	`closed_by_user_id` integer,
	`close_reason` text,
	`cancelled_at` text,
	`created_by` text NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`weaver_id`) REFERENCES `weavers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outside_pos_po_no_unique` ON `outside_pos` (`po_no`);--> statement-breakpoint
CREATE INDEX `outside_pos_order_idx` ON `outside_pos` (`order_id`);--> statement-breakpoint
CREATE INDEX `outside_pos_weaver_idx` ON `outside_pos` (`weaver_id`);--> statement-breakpoint
CREATE INDEX `outside_pos_status_idx` ON `outside_pos` (`status`);--> statement-breakpoint
CREATE TABLE `outside_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`po_id` integer,
	`order_id` integer NOT NULL,
	`weaver_id` integer,
	`supplier_name` text,
	`challan_no` text NOT NULL,
	`receipt_date` text NOT NULL,
	`notes` text,
	`takas` integer DEFAULT 0 NOT NULL,
	`pcs` integer DEFAULT 0 NOT NULL,
	`meters` real DEFAULT 0 NOT NULL,
	`damaged_pcs` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `outside_pos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`weaver_id`) REFERENCES `weavers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outside_receipts_order_idx` ON `outside_receipts` (`order_id`);--> statement-breakpoint
CREATE INDEX `outside_receipts_po_idx` ON `outside_receipts` (`po_id`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`event` text NOT NULL,
	`note` text,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`);--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `is_external` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `has_production` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `has_butta` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `has_mill` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `is_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `closed_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `close_note` text;--> statement-breakpoint
CREATE INDEX `orders_is_closed_idx` ON `orders` (`is_closed`);--> statement-breakpoint
ALTER TABLE `takas` ADD `source` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `weaver_taka_no` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `weaver_id` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `has_own_number` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `outside_receipt_id` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `is_received_lot` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `takas_receipt_idx` ON `takas` (`outside_receipt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `takas_weaver_no_active_unique` ON `takas` (`weaver_id`,`weaver_taka_no`) WHERE "takas"."is_deleted" = 0 AND "takas"."weaver_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `takas_weaver_taka_no_idx` ON `takas` (`weaver_taka_no`);--> statement-breakpoint
-- Backfill (fills the NEW column only): existing orders keep their routing exactly — has_production = 1 and has_mill = 1
-- come from the defaults; has_butta = the design's CURRENT "Goes for butta cutting" (the rule taka entry used until now),
-- 1 when the order has no design. A variation order's design_id is its parent design.
UPDATE `orders` SET `has_butta` = COALESCE((SELECT d.`butta_cutting` FROM `designs` d WHERE d.`id` = `orders`.`design_id`), 1);
