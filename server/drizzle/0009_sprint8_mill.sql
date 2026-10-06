-- Sprint 8: generic challans (butta + mill), mill parties, damage images, partial damage resolve.
-- Hand-written on top of the generated diff so every existing butta challan keeps its id, number, received data and
-- cancelled flag. The whole file runs in ONE transaction: if the check below fails, nothing is changed.

CREATE TABLE `challans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'butta' NOT NULL,
	`challan_no` integer NOT NULL,
	`party_id` integer NOT NULL,
	`challan_date` text NOT NULL,
	`eway_no` text,
	`status` text DEFAULT 'active' NOT NULL,
	`cancelled_at` text,
	`cancelled_by` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challans_kind_challan_no_unique` ON `challans` (`kind`,`challan_no`);--> statement-breakpoint
CREATE INDEX `challans_party_idx` ON `challans` (`kind`,`party_id`);--> statement-breakpoint
CREATE INDEX `challans_status_idx` ON `challans` (`status`);--> statement-breakpoint
CREATE TABLE `challan_takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_id` integer NOT NULL,
	`kind` text DEFAULT 'butta' NOT NULL,
	`taka_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`meters` real,
	`pcs` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`received_at` text,
	`received_by` text,
	`qc_done_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`challan_id`) REFERENCES `challans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `challan_takas_challan_idx` ON `challan_takas` (`challan_id`);--> statement-breakpoint
CREATE INDEX `challan_takas_order_idx` ON `challan_takas` (`order_id`);--> statement-breakpoint
CREATE INDEX `challan_takas_taka_idx` ON `challan_takas` (`taka_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `challan_takas_taka_kind_active_unique` ON `challan_takas` (`taka_id`,`kind`) WHERE "challan_takas"."is_active" = 1;--> statement-breakpoint
-- Copy the butta challans (ids, numbers, received data and cancelled flags are kept as they are).
INSERT INTO `challans` (`id`, `kind`, `challan_no`, `party_id`, `challan_date`, `eway_no`, `status`, `cancelled_at`, `cancelled_by`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, 'butta', `challan_no`, `party_id`, `challan_date`, `eway_no`, `status`, `cancelled_at`, `cancelled_by`, `created_by`, `created_at`, `updated_at` FROM `butta_challans`;--> statement-breakpoint
INSERT INTO `challan_takas` (`id`, `challan_id`, `kind`, `taka_id`, `order_id`, `meters`, `pcs`, `is_active`, `received_at`, `received_by`, `qc_done_at`, `created_at`, `updated_at`)
SELECT `id`, `challan_id`, 'butta', `taka_id`, `order_id`, `meters`, `pcs`, `is_active`, `received_at`, `received_by`, `qc_done_at`, `created_at`, `updated_at` FROM `butta_challan_takas`;--> statement-breakpoint
-- Check: counts before (old tables) and after (new tables) must match, or the whole migration is rolled back.
CREATE TABLE `__s8_check` (`ok` integer NOT NULL);--> statement-breakpoint
INSERT INTO `__s8_check` (`ok`) SELECT CASE WHEN
	(SELECT COUNT(*) FROM `challans`) = (SELECT COUNT(*) FROM `butta_challans`)
	AND (SELECT COUNT(*) FROM `challans` WHERE `status` = 'cancelled') = (SELECT COUNT(*) FROM `butta_challans` WHERE `status` = 'cancelled')
	AND (SELECT COALESCE(MAX(`challan_no`), 0) FROM `challans`) = (SELECT COALESCE(MAX(`challan_no`), 0) FROM `butta_challans`)
	AND (SELECT COUNT(*) FROM `challan_takas`) = (SELECT COUNT(*) FROM `butta_challan_takas`)
	AND (SELECT COUNT(*) FROM `challan_takas` WHERE `is_active` = 1) = (SELECT COUNT(*) FROM `butta_challan_takas` WHERE `is_active` = 1)
	AND (SELECT COUNT(*) FROM `challan_takas` WHERE `received_at` IS NOT NULL) = (SELECT COUNT(*) FROM `butta_challan_takas` WHERE `received_at` IS NOT NULL)
	AND (SELECT COUNT(*) FROM `challan_takas` WHERE `qc_done_at` IS NOT NULL) = (SELECT COUNT(*) FROM `butta_challan_takas` WHERE `qc_done_at` IS NOT NULL)
	THEN 1 ELSE NULL END;--> statement-breakpoint
DROP TABLE `__s8_check`;--> statement-breakpoint
-- taka_events: its challan_id now points at `challans`; new column taka_damage_id (the damage a damage event is about).
CREATE TABLE `__new_taka_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taka_id` integer NOT NULL,
	`event` text NOT NULL,
	`challan_id` integer,
	`taka_damage_id` integer,
	`note` text,
	`role` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challan_id`) REFERENCES `challans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_damage_id`) REFERENCES `taka_damages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_taka_events` (`id`, `taka_id`, `event`, `challan_id`, `note`, `role`, `created_at`, `updated_at`)
SELECT `id`, `taka_id`, `event`, `challan_id`, `note`, `role`, `created_at`, `updated_at` FROM `taka_events`;--> statement-breakpoint
DROP TABLE `taka_events`;--> statement-breakpoint
ALTER TABLE `__new_taka_events` RENAME TO `taka_events`;--> statement-breakpoint
CREATE INDEX `taka_events_taka_idx` ON `taka_events` (`taka_id`);--> statement-breakpoint
DROP TABLE `butta_challan_takas`;--> statement-breakpoint
DROP TABLE `butta_challans`;--> statement-breakpoint
CREATE TABLE `mill_parties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`mobile` text,
	`gstin` text,
	`notes` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mill_parties_name_active_unique` ON `mill_parties` (lower("name")) WHERE "mill_parties"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `taka_damage_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taka_damage_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`thumb_url` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`taka_damage_id`) REFERENCES `taka_damages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `taka_damage_images_damage_idx` ON `taka_damage_images` (`taka_damage_id`);--> statement-breakpoint
ALTER TABLE `taka_damages` ADD `resolved_pcs` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Damages that were resolved before this sprint were resolved in full.
UPDATE `taka_damages` SET `resolved_pcs` = COALESCE(`pcs`, 0) WHERE `status` = 'resolved';
