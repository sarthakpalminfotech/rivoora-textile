CREATE TABLE `jobsheet_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jobsheet_id` integer NOT NULL,
	`event` text NOT NULL,
	`machine_id` integer,
	`frames` integer,
	`note` text,
	`role` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`jobsheet_id`) REFERENCES `jobsheets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobsheet_events_jobsheet_idx` ON `jobsheet_events` (`jobsheet_id`);--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `running_machine_id` integer REFERENCES machines(id);--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `completed_frames` integer;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `parent_jobsheet_id` integer REFERENCES jobsheets(id);--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `suggested_machine_id` integer REFERENCES machines(id);--> statement-breakpoint
CREATE INDEX `jobsheets_status_idx` ON `jobsheets` (`status`);--> statement-breakpoint
CREATE INDEX `jobsheets_running_machine_idx` ON `jobsheets` (`running_machine_id`);--> statement-breakpoint
UPDATE `jobsheets` SET `status` = 'pending' WHERE `status` IS NULL OR `status` = '';--> statement-breakpoint
INSERT INTO `jobsheet_events` (`jobsheet_id`, `event`, `role`, `created_at`, `updated_at`) SELECT `id`, 'created', `created_by`, `created_at`, `created_at` FROM `jobsheets` WHERE `id` NOT IN (SELECT `jobsheet_id` FROM `jobsheet_events`);
