CREATE TABLE `dispatch_challan_takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_id` integer NOT NULL,
	`taka_id` integer NOT NULL,
	`taka_no` text NOT NULL,
	`meters` real,
	`pcs` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`challan_id`) REFERENCES `dispatch_challans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dispatch_challan_takas_challan_idx` ON `dispatch_challan_takas` (`challan_id`);--> statement-breakpoint
CREATE INDEX `dispatch_challan_takas_taka_idx` ON `dispatch_challan_takas` (`taka_id`);--> statement-breakpoint
CREATE TABLE `dispatch_challans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_no` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`parent_challan_id` integer,
	`order_id` integer NOT NULL,
	`challan_date` text NOT NULL,
	`transport` text,
	`lr_no` text,
	`eway_no` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_challan_id`) REFERENCES `dispatch_challans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_challans_no_revision_unique` ON `dispatch_challans` (`challan_no`,`revision`);--> statement-breakpoint
CREATE INDEX `dispatch_challans_order_idx` ON `dispatch_challans` (`order_id`);--> statement-breakpoint
CREATE INDEX `dispatch_challans_status_idx` ON `dispatch_challans` (`status`);--> statement-breakpoint
CREATE TABLE `goods_return_takas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goods_return_id` integer NOT NULL,
	`taka_id` integer NOT NULL,
	`pcs` integer,
	`damaged_pcs` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`goods_return_id`) REFERENCES `goods_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taka_id`) REFERENCES `takas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goods_return_takas_gr_idx` ON `goods_return_takas` (`goods_return_id`);--> statement-breakpoint
CREATE TABLE `goods_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challan_id` integer NOT NULL,
	`new_challan_id` integer,
	`return_date` text NOT NULL,
	`note` text,
	`role` text NOT NULL,
	`user_id` integer,
	`returned_takas` integer DEFAULT 0 NOT NULL,
	`returned_pcs` integer DEFAULT 0 NOT NULL,
	`damaged_pcs` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`challan_id`) REFERENCES `dispatch_challans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`new_challan_id`) REFERENCES `dispatch_challans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goods_returns_challan_idx` ON `goods_returns` (`challan_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_active_unique` ON `users` (`phone`) WHERE "users"."is_active" = 1;--> statement-breakpoint
ALTER TABLE `jobsheet_events` ADD `user_id` integer;--> statement-breakpoint
ALTER TABLE `order_status_history` ADD `user_id` integer;--> statement-breakpoint
ALTER TABLE `taka_events` ADD `user_id` integer;--> statement-breakpoint
ALTER TABLE `taka_events` ADD `dispatch_challan_id` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `rework_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `returned_at` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `returned_from_challan_id` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `is_return_lot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `origin_order_id` integer REFERENCES orders(id);