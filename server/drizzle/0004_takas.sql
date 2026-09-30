CREATE TABLE `takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jobsheet_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`taka_no` text NOT NULL,
	`is_damaged` integer DEFAULT false NOT NULL,
	`damage_type` text,
	`entered_by` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`jobsheet_id`) REFERENCES `jobsheets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `takas_jobsheet_idx` ON `takas` (`jobsheet_id`);--> statement-breakpoint
CREATE INDEX `takas_order_idx` ON `takas` (`order_id`);--> statement-breakpoint
CREATE INDEX `takas_taka_no_idx` ON `takas` (`taka_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `takas_jobsheet_taka_no_active_unique` ON `takas` (`jobsheet_id`,`taka_no`) WHERE "takas"."is_deleted" = 0;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `taka_note` text;