CREATE TABLE `login_limit_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`note` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_limit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`phone` text,
	`event` text NOT NULL,
	`reason` text NOT NULL,
	`distance_m` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_limit_log_created_idx` ON `login_limit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `login_limit_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`from_time` text DEFAULT '08:30' NOT NULL,
	`to_time` text DEFAULT '19:20' NOT NULL,
	`days` text DEFAULT '1,2,3,4,5,6,7' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by_user_id` integer
);
--> statement-breakpoint
CREATE TABLE `login_locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`radius_m` integer DEFAULT 200 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_time_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`grant_date` text NOT NULL,
	`until_time` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` integer,
	`cancelled_at` text,
	`cancelled_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `login_time_grants_user_idx` ON `login_time_grants` (`user_id`,`grant_date`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `valid_until` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_lat` real;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_lng` real;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_heartbeat_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `outside_strikes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ended_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ended_reason` text;