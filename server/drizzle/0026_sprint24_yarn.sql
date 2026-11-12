CREATE TABLE `palti_run_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`zone` text NOT NULL,
	`item` text NOT NULL,
	`quality_id` integer NOT NULL,
	`qty_g` integer NOT NULL,
	`lot_id` integer,
	`box_id` integer,
	`warping_quality_id` integer,
	FOREIGN KEY (`run_id`) REFERENCES `palti_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `yarn_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`box_id`) REFERENCES `yarn_boxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warping_quality_id`) REFERENCES `warping_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `palti_run_inputs_run_idx` ON `palti_run_inputs` (`run_id`);--> statement-breakpoint
CREATE TABLE `palti_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_date` text NOT NULL,
	`box_id` integer,
	`input_g` integer NOT NULL,
	`waste_g` integer DEFAULT 0 NOT NULL,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `palti_runs_date_idx` ON `palti_runs` (`run_date`);--> statement-breakpoint
CREATE TABLE `tfo_program_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`kind` text NOT NULL,
	`rolls_made` integer,
	`rolls_left` integer,
	`rolls` integer,
	`twisted_g` integer,
	`sections` text,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `tfo_programs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tfo_program_events_program_idx` ON `tfo_program_events` (`program_id`);--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `rolls_made` integer;--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `rolls_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `held_at` text;--> statement-breakpoint
ALTER TABLE `warping_jobs` ADD `denier` real;--> statement-breakpoint
ALTER TABLE `warping_jobs` ADD `used_g` integer;--> statement-breakpoint
ALTER TABLE `warping_jobs` ADD `leftover_g` integer;--> statement-breakpoint
ALTER TABLE `yarn_boxes` ADD `kind` text DEFAULT 'tfo' NOT NULL;--> statement-breakpoint
ALTER TABLE `yarn_boxes` ADD `program_event_id` integer;--> statement-breakpoint
ALTER TABLE `yarn_boxes` ADD `source_job_id` integer;--> statement-breakpoint
ALTER TABLE `yarn_boxes` ADD `palti_run_id` integer;--> statement-breakpoint
ALTER TABLE `yarn_withdrawals` ADD `purpose` text DEFAULT 'in_house' NOT NULL;--> statement-breakpoint
ALTER TABLE `yarn_withdrawals` ADD `party_name` text;--> statement-breakpoint
ALTER TABLE `yarn_withdrawals` ADD `rate_paise` integer;--> statement-breakpoint
-- Sprint 24 (CR-25): Palti boxes are yarn_boxes rows, whose program_id is NOT NULL (+ FK) and pre-dates boxes without a
-- TFO program. As with the Sprint 20 system yarn quality, ONE system row keeps that constraint satisfied (making the column
-- nullable would need a table rebuild): a DELETED machine 0 and a program with status 'system' on it. Every machine
-- query filters is_deleted = 0 and every program query filters by a real status, so neither ever shows.
INSERT INTO `tfo_machines` (`machine_no`, `name`, `is_active`, `is_deleted`)
SELECT 0, 'System (Palti)', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM `tfo_machines` WHERE `machine_no` = 0 AND `name` = 'System (Palti)' AND `is_deleted` = 1);--> statement-breakpoint
INSERT INTO `tfo_programs` (`machine_id`, `section`, `raw_quality_id`, `raw_g`, `output_quality_id`, `tpm`, `direction`, `note`, `status`, `started_at`)
SELECT
  (SELECT `id` FROM `tfo_machines` WHERE `machine_no` = 0 AND `name` = 'System (Palti)' AND `is_deleted` = 1 ORDER BY `id` LIMIT 1),
  'A',
  (SELECT `id` FROM `yarn_qualities` WHERE `is_system` = 1 ORDER BY `id` LIMIT 1),
  0,
  (SELECT `id` FROM `yarn_qualities` WHERE `is_system` = 1 ORDER BY `id` LIMIT 1),
  0, 'S', 'System row for Palti boxes (Sprint 24) — never shown', 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM `tfo_programs` WHERE `status` = 'system');
