CREATE TABLE `butta_challan_takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_id` integer NOT NULL,
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
	FOREIGN KEY (`challan_id`) REFERENCES `butta_challans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `butta_challan_takas_challan_idx` ON `butta_challan_takas` (`challan_id`);--> statement-breakpoint
CREATE INDEX `butta_challan_takas_order_idx` ON `butta_challan_takas` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `butta_challan_takas_taka_active_unique` ON `butta_challan_takas` (`taka_id`) WHERE "butta_challan_takas"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `butta_challans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_no` integer NOT NULL,
	`party_id` integer NOT NULL,
	`challan_date` text NOT NULL,
	`eway_no` text,
	`status` text DEFAULT 'active' NOT NULL,
	`cancelled_at` text,
	`cancelled_by` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `butta_parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `butta_challans_challan_no_unique` ON `butta_challans` (`challan_no`);--> statement-breakpoint
CREATE INDEX `butta_challans_party_idx` ON `butta_challans` (`party_id`);--> statement-breakpoint
CREATE INDEX `butta_challans_status_idx` ON `butta_challans` (`status`);--> statement-breakpoint
CREATE TABLE `butta_parties` (
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
CREATE UNIQUE INDEX `butta_parties_name_active_unique` ON `butta_parties` (lower("name")) WHERE "butta_parties"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `taka_damages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taka_id` integer NOT NULL,
	`damage_id` integer,
	`found_at` text DEFAULT 'machine' NOT NULL,
	`pcs` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`resolved_stage` text,
	`created_by` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`damage_id`) REFERENCES `damages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `taka_damages_taka_idx` ON `taka_damages` (`taka_id`);--> statement-breakpoint
CREATE INDEX `taka_damages_status_idx` ON `taka_damages` (`status`,`found_at`);--> statement-breakpoint
CREATE TABLE `taka_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taka_id` integer NOT NULL,
	`event` text NOT NULL,
	`challan_id` integer,
	`note` text,
	`role` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challan_id`) REFERENCES `butta_challans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `taka_events_taka_idx` ON `taka_events` (`taka_id`);--> statement-breakpoint
DROP INDEX `takas_jobsheet_taka_no_active_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `takas_taka_no_active_unique` ON `takas` (`taka_no`) WHERE "takas"."is_deleted" = 0;--> statement-breakpoint
ALTER TABLE `designs` ADD `butta_cutting` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Backfill: every existing design goes for butta cutting (the ADD COLUMN default already set it; kept explicit).
UPDATE `designs` SET `butta_cutting` = 1;--> statement-breakpoint
-- Damages become a list per taka: one OPEN row for every existing damaged taka (found_at = the old damage_type).
INSERT INTO `taka_damages` (`taka_id`, `damage_id`, `found_at`, `pcs`, `status`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, `damage_id`, COALESCE(`damage_type`, 'machine'), NULL, 'open', `entered_by`, `created_at`, `updated_at`
FROM `takas` WHERE `is_damaged` = 1 AND `is_deleted` = 0;--> statement-breakpoint
-- History: an "entered" event for every existing taka.
INSERT INTO `taka_events` (`taka_id`, `event`, `role`, `created_at`, `updated_at`)
SELECT `id`, 'entered', `entered_by`, `created_at`, `created_at` FROM `takas` WHERE `is_deleted` = 0;--> statement-breakpoint
-- The old "butta_done" taka stage became "waiting_mill".
UPDATE `takas` SET `stage` = 'waiting_mill' WHERE `stage` = 'butta_done';
