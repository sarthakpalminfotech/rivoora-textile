CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by_user_id` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_layouts` (
	`dashboard` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`updated_by_user_id` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `promised_date` text;--> statement-breakpoint
ALTER TABLE `outside_pos` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `yarn_qualities` ADD `min_g` integer;--> statement-breakpoint
CREATE INDEX `dispatch_challans_date_idx` ON `dispatch_challans` (`challan_date`);--> statement-breakpoint
CREATE INDEX `jobsheets_completed_idx` ON `jobsheets` (`completed_at`);--> statement-breakpoint
CREATE INDEX `order_status_history_changed_idx` ON `order_status_history` (`order_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `taka_damages_created_idx` ON `taka_damages` (`created_at`);--> statement-breakpoint
CREATE INDEX `taka_events_created_idx` ON `taka_events` (`created_at`);