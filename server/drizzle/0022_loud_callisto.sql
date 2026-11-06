CREATE TABLE `challan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_id` integer NOT NULL,
	`event` text NOT NULL,
	`note` text,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`challan_id`) REFERENCES `challans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `challan_events_challan_idx` ON `challan_events` (`challan_id`);--> statement-breakpoint
CREATE TABLE `dispatch_challan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_id` integer NOT NULL,
	`event` text NOT NULL,
	`note` text,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`challan_id`) REFERENCES `dispatch_challans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dispatch_challan_events_challan_idx` ON `dispatch_challan_events` (`challan_id`);--> statement-breakpoint
CREATE TABLE `qc_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taka_id` integer NOT NULL,
	`kind` text NOT NULL,
	`result` text NOT NULL,
	`changes` text NOT NULL,
	`done_by_role` text NOT NULL,
	`done_by_user_id` integer,
	`undone_at` text,
	`undone_by_role` text,
	`undone_by_user_id` integer,
	`undone_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `qc_runs_taka_idx` ON `qc_runs` (`taka_id`);--> statement-breakpoint
ALTER TABLE `challan_takas` ADD `lost_at` text;--> statement-breakpoint
ALTER TABLE `challan_takas` ADD `lost_by` text;--> statement-breakpoint
ALTER TABLE `challans` ADD `transport` text;--> statement-breakpoint
ALTER TABLE `challans` ADD `vehicle_no` text;--> statement-breakpoint
ALTER TABLE `challans` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `dispatch_challans` ADD `vehicle_no` text;--> statement-breakpoint
ALTER TABLE `dispatch_challans` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `dispatch_challans` ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE `dispatch_challans` ADD `cancelled_by` text;--> statement-breakpoint
ALTER TABLE `dispatch_challans` ADD `cancelled_reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `fg_type` text DEFAULT 'saree' NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `stage_before_rework` text;