CREATE TABLE `damaged_lot_takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_id` integer NOT NULL,
	`taka_id` integer NOT NULL,
	`pcs` integer,
	`meters` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `damaged_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `damaged_lot_takas_lot_idx` ON `damaged_lot_takas` (`lot_id`);--> statement-breakpoint
CREATE INDEX `damaged_lot_takas_taka_idx` ON `damaged_lot_takas` (`taka_id`);--> statement-breakpoint
CREATE TABLE `damaged_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_no` integer NOT NULL,
	`lot_date` text NOT NULL,
	`buyer` text,
	`amount` real,
	`note` text,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `damaged_lots_lot_no_unique` ON `damaged_lots` (`lot_no`);--> statement-breakpoint
CREATE TABLE `party_return_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`thumb_url` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `party_returns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `party_return_images_return_idx` ON `party_return_images` (`return_id`);--> statement-breakpoint
CREATE TABLE `party_return_line_damages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`type` text NOT NULL,
	`damage_id` integer,
	`other_name` text,
	`qty` real NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `party_return_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`damage_id`) REFERENCES `damages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `party_return_line_damages_line_idx` ON `party_return_line_damages` (`line_id`);--> statement-breakpoint
CREATE TABLE `party_return_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL,
	`taka_id` integer,
	`material_id` integer NOT NULL,
	`design_id` integer NOT NULL,
	`qty` real NOT NULL,
	`blouse_option` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `party_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `party_return_lines_return_idx` ON `party_return_lines` (`return_id`);--> statement-breakpoint
CREATE TABLE `party_return_takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL,
	`taka_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `party_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `party_return_takas_return_idx` ON `party_return_takas` (`return_id`);--> statement-breakpoint
CREATE TABLE `party_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_no` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`received_date` text NOT NULL,
	`received_as` text NOT NULL,
	`received_qty` real DEFAULT 0 NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` text,
	`completed_by_role` text,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_returns_no_unique` ON `party_returns` (`return_no`);--> statement-breakpoint
CREATE INDEX `party_returns_status_idx` ON `party_returns` (`status`);--> statement-breakpoint
CREATE INDEX `party_returns_customer_idx` ON `party_returns` (`customer_id`);