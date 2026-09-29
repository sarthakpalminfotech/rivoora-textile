CREATE TABLE `counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobsheet_machines` (
	`jobsheet_id` integer NOT NULL,
	`machine_id` integer NOT NULL,
	PRIMARY KEY(`jobsheet_id`, `machine_id`),
	FOREIGN KEY (`jobsheet_id`) REFERENCES `jobsheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobsheet_machines_machine_idx` ON `jobsheet_machines` (`machine_id`);--> statement-breakpoint
CREATE TABLE `jobsheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jobsheet_no` integer NOT NULL,
	`order_id` integer NOT NULL,
	`frames` integer NOT NULL,
	`picks` text,
	`created_by` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobsheets_jobsheet_no_unique` ON `jobsheets` (`jobsheet_no`);--> statement-breakpoint
CREATE INDEX `jobsheets_order_idx` ON `jobsheets` (`order_id`);--> statement-breakpoint
CREATE TABLE `machines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_no` integer NOT NULL,
	`name` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machines_machine_no_active_unique` ON `machines` (`machine_no`) WHERE "machines"."is_deleted" = 0;--> statement-breakpoint
ALTER TABLE `orders` ADD `jobsheet_pieces` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `target_frames` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `frames_per_jobsheet` integer;--> statement-breakpoint
INSERT INTO `counters` (`name`, `value`) VALUES ('jobsheet_no', 0) ON CONFLICT(`name`) DO NOTHING;
