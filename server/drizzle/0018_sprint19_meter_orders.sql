-- Sprint 19: meter (all-over) orders + manual finished-goods stock adjustment.
-- Generated DDL first (additive only: new table, new nullable/defaulted columns, new indexes), then the ONE data
-- change, hand-written. The whole file runs in ONE transaction: if the check below fails (it inserts NULL into a
-- NOT NULL column), nothing at all is changed.
CREATE TABLE `stock_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`design_id` integer,
	`material_id` integer NOT NULL,
	`unit` text NOT NULL,
	`qty` real NOT NULL,
	`condition` text,
	`taka_id` integer,
	`remark` text NOT NULL,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_adjustments_design_idx` ON `stock_adjustments` (`design_id`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_material_idx` ON `stock_adjustments` (`material_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `is_system` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_is_system_unique` ON `customers` (`is_system`) WHERE "customers"."is_system" = 1;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `meters` real;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `completed_meters` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `meters_per_jobsheet` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `is_stock_holder` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_is_stock_holder_idx` ON `orders` (`is_stock_holder`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_holder_orders_key_unique` ON `orders` (COALESCE("design_id", -1),`material_id`,`unit`,COALESCE("blouse_option", '')) WHERE "orders"."is_stock_holder" = 1;--> statement-breakpoint
ALTER TABLE `taka_damages` ADD `meters` real;--> statement-breakpoint
ALTER TABLE `taka_damages` ADD `resolved_meters` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `actual_meters` real;--> statement-breakpoint
ALTER TABLE `takas` ADD `removed_reason` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `removed_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `removed_at` text;--> statement-breakpoint
-- Data step (§1.4 of the spec): existing METER orders without a dispatch and without a goods return get
-- order_type = 'lump' (meter orders are always lump from this sprint on). kg / g orders are never touched.
-- Checked against the live DB before writing this: 0 orders have unit != 'pcs' today, so this updates nothing yet —
-- kept so it is correct the day the first meter order is created and later re-migrated from an older snapshot.
UPDATE `orders`
SET `order_type` = 'lump'
WHERE `unit` = 'meters' AND `order_type` <> 'lump'
	AND NOT EXISTS (SELECT 1 FROM `dispatch_challans` dc WHERE dc.`order_id` = `orders`.`id`)
	AND NOT EXISTS (SELECT 1 FROM `goods_returns` gr JOIN `dispatch_challans` dc2 ON dc2.`id` = gr.`challan_id` WHERE dc2.`order_id` = `orders`.`id`);--> statement-breakpoint
-- Check: no meter order without a dispatch/GR is left as anything other than lump.
CREATE TABLE `__s19_check` (`ok` integer NOT NULL);--> statement-breakpoint
INSERT INTO `__s19_check` (`ok`) SELECT CASE WHEN
	(SELECT COUNT(*) FROM `orders` o WHERE o.`unit` = 'meters' AND o.`order_type` <> 'lump'
		AND NOT EXISTS (SELECT 1 FROM `dispatch_challans` dc WHERE dc.`order_id` = o.`id`)
		AND NOT EXISTS (SELECT 1 FROM `goods_returns` gr JOIN `dispatch_challans` dc2 ON dc2.`id` = gr.`challan_id` WHERE dc2.`order_id` = o.`id`)) = 0
	THEN 1 ELSE NULL END;--> statement-breakpoint
DROP TABLE `__s19_check`;
