CREATE TABLE `tfo_pending_programs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raw_quality_id` integer NOT NULL,
	`lot_id` integer,
	`raw_g` integer NOT NULL,
	`output_quality_id` integer NOT NULL,
	`winding_meter` real,
	`denier_filament` text,
	`tpm` real NOT NULL,
	`direction` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_program_id` integer,
	`cancelled_at` text,
	`cancelled_by_user_id` integer,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`raw_quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `yarn_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`output_quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_program_id`) REFERENCES `tfo_programs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tfo_pending_programs_status_idx` ON `tfo_pending_programs` (`status`);--> statement-breakpoint
CREATE INDEX `tfo_pending_programs_lot_idx` ON `tfo_pending_programs` (`lot_id`,`raw_quality_id`);--> statement-breakpoint
CREATE TABLE `warping_pending_job_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`item` text NOT NULL,
	`quality_id` integer NOT NULL,
	`qty_g` integer NOT NULL,
	`lot_id` integer,
	`box_id` integer,
	`warping_quality_id` integer,
	FOREIGN KEY (`job_id`) REFERENCES `warping_pending_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `yarn_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`box_id`) REFERENCES `yarn_boxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warping_quality_id`) REFERENCES `warping_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warping_pending_job_inputs_job_idx` ON `warping_pending_job_inputs` (`job_id`);--> statement-breakpoint
CREATE TABLE `warping_pending_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taar` integer NOT NULL,
	`panna` real NOT NULL,
	`meters` real,
	`full_meter` integer DEFAULT false NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_job_id` integer,
	`cancelled_at` text,
	`cancelled_by_user_id` integer,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`started_job_id`) REFERENCES `warping_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warping_pending_jobs_status_idx` ON `warping_pending_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `warping_qualities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warping_qualities_name_active_unique` ON `warping_qualities` (lower("name")) WHERE "warping_qualities"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `yarn_boxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`box_no` text NOT NULL,
	`program_id` integer NOT NULL,
	`lot_id` integer,
	`warping_quality_id` integer NOT NULL,
	`rolls` integer NOT NULL,
	`gross_g` integer NOT NULL,
	`net_g` integer NOT NULL,
	`avg_g` integer NOT NULL,
	`zone` text NOT NULL,
	`status` text DEFAULT 'in_stock' NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `tfo_programs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `yarn_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warping_quality_id`) REFERENCES `warping_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_boxes_box_no_unique` ON `yarn_boxes` (lower("box_no"));--> statement-breakpoint
CREATE INDEX `yarn_boxes_zone_status_idx` ON `yarn_boxes` (`zone`,`status`);--> statement-breakpoint
CREATE INDEX `yarn_boxes_program_idx` ON `yarn_boxes` (`program_id`);--> statement-breakpoint
CREATE TABLE `yarn_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_no` text NOT NULL,
	`party_id` integer NOT NULL,
	`quality_id` integer NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `yarn_parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_lots_party_lot_no_unique` ON `yarn_lots` (`party_id`,lower("lot_no"));--> statement-breakpoint
CREATE INDEX `yarn_lots_quality_idx` ON `yarn_lots` (`quality_id`);--> statement-breakpoint
CREATE TABLE `yarn_receipt_line_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_line_id` integer NOT NULL,
	`zone` text NOT NULL,
	`qty_g` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`receipt_line_id`) REFERENCES `yarn_receipt_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `yarn_receipt_line_allocations_line_idx` ON `yarn_receipt_line_allocations` (`receipt_line_id`);--> statement-breakpoint
ALTER TABLE `beams` ADD `beam_code` text;--> statement-breakpoint
ALTER TABLE `beams` ADD `warping_quality_id` integer REFERENCES warping_qualities(id);--> statement-breakpoint
CREATE UNIQUE INDEX `beams_beam_code_unique` ON `beams` (lower("beam_code"));--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `lot_id` integer REFERENCES yarn_lots(id);--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `pending_program_id` integer REFERENCES tfo_pending_programs(id);--> statement-breakpoint
ALTER TABLE `warping_job_inputs` ADD `lot_id` integer REFERENCES yarn_lots(id);--> statement-breakpoint
ALTER TABLE `warping_job_inputs` ADD `box_id` integer REFERENCES yarn_boxes(id);--> statement-breakpoint
ALTER TABLE `warping_job_inputs` ADD `warping_quality_id` integer REFERENCES warping_qualities(id);--> statement-breakpoint
ALTER TABLE `warping_jobs` ADD `pending_job_id` integer REFERENCES warping_pending_jobs(id);--> statement-breakpoint
ALTER TABLE `yarn_qualities` ADD `is_system` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `yarn_receipt_lines` ADD `lot_id` integer REFERENCES yarn_lots(id);--> statement-breakpoint
ALTER TABLE `yarn_stock_moves` ADD `lot_id` integer REFERENCES yarn_lots(id);--> statement-breakpoint
ALTER TABLE `yarn_stock_moves` ADD `box_id` integer REFERENCES yarn_boxes(id);--> statement-breakpoint
ALTER TABLE `yarn_stock_moves` ADD `warping_quality_id` integer REFERENCES warping_qualities(id);--> statement-breakpoint
CREATE INDEX `yarn_stock_moves_lot_idx` ON `yarn_stock_moves` (`lot_id`);--> statement-breakpoint
CREATE INDEX `yarn_stock_moves_box_idx` ON `yarn_stock_moves` (`box_id`);--> statement-breakpoint
-- Sprint 20 (hand-written on top of the generated diff, additive only):
-- 1) Old beams get a text code so `beam_code` is always populated going forward ("BM-<n>", matching `beamLabel(n)`).
--    `beams_beam_no_unique` already guarantees beam_no is unique, so the derived codes can't collide.
UPDATE `beams` SET `beam_code` = 'BM-' || `beam_no` WHERE `beam_code` IS NULL;--> statement-breakpoint
-- 2) One reserved "system" yarn quality: `yarn_stock_moves.quality_id` / `warping_job_inputs.quality_id` /
--    `beams.quality_id` are NOT NULL FKs into yarn_qualities that pre-date the Warping qualities master. Every new
--    twisted-yarn row now carries its real identity in `warping_quality_id` instead and points `quality_id` at this
--    row only to satisfy the old constraint. It is flagged `is_system` so every picker / lookup excludes it.
INSERT INTO `yarn_qualities` (`name`, `notes`, `is_system`, `is_deleted`)
SELECT '— system (warping quality in use) —', 'Sprint 20 placeholder — never shown. The real quality is in warping_quality_id.', 1, 0
WHERE NOT EXISTS (SELECT 1 FROM `yarn_qualities` WHERE `is_system` = 1);