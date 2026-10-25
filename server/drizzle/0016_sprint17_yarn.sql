-- Sprint 17: yarn — Yarn parties / Yarn qualities / TFO machines masters, Yarn POs + receipts, the yarn stock ledger
-- (integer grams), transfers, withdrawals, beams, TFO programs, warping jobs.
-- ADDITIVE ONLY: 16 new tables and their indexes. No existing table is changed, nothing is dropped, renamed or backfilled.
CREATE TABLE `beam_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`beam_id` integer NOT NULL,
	`kind` text NOT NULL,
	`zone` text NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`beam_id`) REFERENCES `beams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beam_moves_beam_idx` ON `beam_moves` (`beam_id`);--> statement-breakpoint
CREATE INDEX `beam_moves_created_idx` ON `beam_moves` (`created_at`);--> statement-breakpoint
CREATE INDEX `beam_moves_ref_idx` ON `beam_moves` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `beams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`beam_no` integer NOT NULL,
	`zone` text NOT NULL,
	`quality_id` integer NOT NULL,
	`taar` integer NOT NULL,
	`panna` real NOT NULL,
	`meters` real NOT NULL,
	`status` text DEFAULT 'in_stock' NOT NULL,
	`warping_job_id` integer,
	`consumed_at` text,
	`consumed_by_user_id` integer,
	`consumed_note` text,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warping_job_id`) REFERENCES `warping_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `beams_beam_no_unique` ON `beams` (`beam_no`);--> statement-breakpoint
CREATE INDEX `beams_zone_status_idx` ON `beams` (`zone`,`status`);--> statement-breakpoint
CREATE TABLE `tfo_machines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_no` integer NOT NULL,
	`name` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tfo_machines_machine_no_active_unique` ON `tfo_machines` (`machine_no`) WHERE "tfo_machines"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `tfo_programs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` integer NOT NULL,
	`section` text NOT NULL,
	`raw_quality_id` integer NOT NULL,
	`raw_g` integer NOT NULL,
	`output_quality_id` integer NOT NULL,
	`winding_meter` real,
	`denier_filament` text,
	`tpm` real NOT NULL,
	`direction` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text NOT NULL,
	`started_by_user_id` integer,
	`started_role` text,
	`stopped_at` text,
	`stopped_by_user_id` integer,
	`stopped_role` text,
	`twisted_g` integer,
	`twisted_meters` real,
	`returned_raw_g` integer,
	`stop_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `tfo_machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`output_quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tfo_programs_running_unique` ON `tfo_programs` (`machine_id`,`section`) WHERE "tfo_programs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `tfo_programs_machine_idx` ON `tfo_programs` (`machine_id`,`section`);--> statement-breakpoint
CREATE INDEX `tfo_programs_status_idx` ON `tfo_programs` (`status`);--> statement-breakpoint
CREATE TABLE `warping_job_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`item` text NOT NULL,
	`quality_id` integer NOT NULL,
	`qty_g` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `warping_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warping_job_inputs_job_idx` ON `warping_job_inputs` (`job_id`);--> statement-breakpoint
CREATE TABLE `warping_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_no` integer NOT NULL,
	`status` text DEFAULT 'in_process' NOT NULL,
	`note` text,
	`started_at` text NOT NULL,
	`started_by_user_id` integer,
	`started_role` text,
	`done_at` text,
	`done_by_user_id` integer,
	`done_role` text,
	`done_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warping_jobs_job_no_unique` ON `warping_jobs` (`job_no`);--> statement-breakpoint
CREATE INDEX `warping_jobs_status_idx` ON `warping_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `yarn_parties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mobile` text,
	`address` text,
	`gstin` text,
	`notes` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_parties_name_active_unique` ON `yarn_parties` (lower("name")) WHERE "yarn_parties"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `yarn_po_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `yarn_pos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `yarn_po_events_po_idx` ON `yarn_po_events` (`po_id`);--> statement-breakpoint
CREATE TABLE `yarn_po_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`quality_id` integer NOT NULL,
	`qty_g` integer NOT NULL,
	`rate_paise` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `yarn_pos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `yarn_po_lines_po_idx` ON `yarn_po_lines` (`po_id`);--> statement-breakpoint
CREATE INDEX `yarn_po_lines_quality_idx` ON `yarn_po_lines` (`quality_id`);--> statement-breakpoint
CREATE TABLE `yarn_pos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_no` integer NOT NULL,
	`po_date` text NOT NULL,
	`party_id` integer NOT NULL,
	`remark` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_user_id` integer,
	`closed_at` text,
	`closed_by_user_id` integer,
	`cancelled_at` text,
	`cancelled_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `yarn_parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_pos_po_no_unique` ON `yarn_pos` (`po_no`);--> statement-breakpoint
CREATE INDEX `yarn_pos_party_idx` ON `yarn_pos` (`party_id`);--> statement-breakpoint
CREATE INDEX `yarn_pos_status_idx` ON `yarn_pos` (`status`);--> statement-breakpoint
CREATE INDEX `yarn_pos_date_idx` ON `yarn_pos` (`po_date`);--> statement-breakpoint
CREATE TABLE `yarn_qualities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`denier` text,
	`filament` text,
	`notes` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_qualities_name_active_unique` ON `yarn_qualities` (lower("name")) WHERE "yarn_qualities"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `yarn_receipt_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`po_line_id` integer NOT NULL,
	`quality_id` integer NOT NULL,
	`qty_g` integer NOT NULL,
	`boxes` integer,
	FOREIGN KEY (`receipt_id`) REFERENCES `yarn_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_line_id`) REFERENCES `yarn_po_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `yarn_receipt_lines_receipt_idx` ON `yarn_receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `yarn_receipt_lines_po_line_idx` ON `yarn_receipt_lines` (`po_line_id`);--> statement-breakpoint
CREATE TABLE `yarn_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`challan_no` text NOT NULL,
	`receipt_date` text NOT NULL,
	`zone` text NOT NULL,
	`notes` text,
	`received_by` text NOT NULL,
	`received_by_user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `yarn_pos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `yarn_receipts_po_idx` ON `yarn_receipts` (`po_id`);--> statement-breakpoint
CREATE TABLE `yarn_stock_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`zone` text NOT NULL,
	`item` text NOT NULL,
	`quality_id` integer NOT NULL,
	`qty_g` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`quality_id`) REFERENCES `yarn_qualities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `yarn_stock_moves_balance_idx` ON `yarn_stock_moves` (`zone`,`item`,`quality_id`);--> statement-breakpoint
CREATE INDEX `yarn_stock_moves_created_idx` ON `yarn_stock_moves` (`created_at`);--> statement-breakpoint
CREATE INDEX `yarn_stock_moves_ref_idx` ON `yarn_stock_moves` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `yarn_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_zone` text NOT NULL,
	`to_zone` text NOT NULL,
	`what` text NOT NULL,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `yarn_withdrawals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`zone` text NOT NULL,
	`what` text NOT NULL,
	`note` text,
	`role` text,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
