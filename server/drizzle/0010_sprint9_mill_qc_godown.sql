ALTER TABLE `challan_takas` ADD `is_refinish` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `refinish_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `parent_taka_id` integer REFERENCES takas(id);--> statement-breakpoint
ALTER TABLE `takas` ADD `actual_pcs` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `godown_checked_at` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `godown_checked_by` text;--> statement-breakpoint
CREATE INDEX `takas_parent_idx` ON `takas` (`parent_taka_id`);