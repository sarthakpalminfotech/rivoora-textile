CREATE TABLE `tfo_program_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`machine_id` integer NOT NULL,
	`section` text NOT NULL,
	`is_running` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `tfo_programs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `tfo_machines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tfo_program_sections_running_unique` ON `tfo_program_sections` (`machine_id`,`section`) WHERE "tfo_program_sections"."is_running" = 1;--> statement-breakpoint
CREATE INDEX `tfo_program_sections_program_idx` ON `tfo_program_sections` (`program_id`);--> statement-breakpoint
ALTER TABLE `tfo_pending_programs` ADD `rolls` integer;--> statement-breakpoint
ALTER TABLE `tfo_pending_programs` ADD `winding_g` integer;--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `rolls` integer;--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `winding_g` integer;--> statement-breakpoint
ALTER TABLE `tfo_programs` ADD `roll_weight_g` integer;--> statement-breakpoint
-- Sprint 20b (hand-written on top of the generated diff):
-- 1) Every existing TFO program gets its section row (the running ones keep their section busy).
INSERT INTO `tfo_program_sections` (`program_id`, `machine_id`, `section`, `is_running`, `created_at`)
SELECT `id`, `machine_id`, `section`, CASE WHEN `status` = 'running' THEN 1 ELSE 0 END, `started_at` FROM `tfo_programs`;--> statement-breakpoint
-- 2) Yarn kg get 4 decimals: every yarn quantity moves from grams to tenths of a gram (× 10). Rates stay paise per kg.
UPDATE `yarn_stock_moves` SET `qty_g` = `qty_g` * 10;--> statement-breakpoint
UPDATE `yarn_po_lines` SET `qty_g` = `qty_g` * 10;--> statement-breakpoint
UPDATE `yarn_receipt_lines` SET `qty_g` = `qty_g` * 10;--> statement-breakpoint
UPDATE `yarn_receipt_line_allocations` SET `qty_g` = `qty_g` * 10;--> statement-breakpoint
UPDATE `warping_pending_job_inputs` SET `qty_g` = `qty_g` * 10;--> statement-breakpoint
UPDATE `warping_job_inputs` SET `qty_g` = `qty_g` * 10;--> statement-breakpoint
UPDATE `tfo_pending_programs` SET `raw_g` = `raw_g` * 10;--> statement-breakpoint
UPDATE `tfo_programs` SET `raw_g` = `raw_g` * 10, `twisted_g` = `twisted_g` * 10, `returned_raw_g` = `returned_raw_g` * 10;--> statement-breakpoint
UPDATE `yarn_boxes` SET `gross_g` = `gross_g` * 10, `net_g` = `net_g` * 10, `avg_g` = `avg_g` * 10;
