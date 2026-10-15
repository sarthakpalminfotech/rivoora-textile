ALTER TABLE `orders` ADD `blouse_option` text;--> statement-breakpoint
ALTER TABLE `taka_damages` ADD `recorded_at` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `is_free_stock` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `takas` ADD `free_stock_at` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `free_stock_by` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `free_stock_reason` text;--> statement-breakpoint
ALTER TABLE `takas` ADD `allocated_order_id` integer REFERENCES orders(id);--> statement-breakpoint
ALTER TABLE `takas` ADD `has_been_to_mill` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `takas_free_stock_idx` ON `takas` (`is_free_stock`);--> statement-breakpoint
CREATE INDEX `takas_allocated_order_idx` ON `takas` (`allocated_order_id`);--> statement-breakpoint
-- Backfill has_been_to_mill from history: any mill challan row, a received_mill / mill_qc_done event, or refinish_count > 0.
UPDATE `takas` SET `has_been_to_mill` = 1
WHERE `refinish_count` > 0
   OR EXISTS (SELECT 1 FROM `challan_takas` ct WHERE ct.`taka_id` = `takas`.`id` AND ct.`kind` = 'mill')
   OR EXISTS (SELECT 1 FROM `taka_events` e WHERE e.`taka_id` = `takas`.`id` AND e.`event` IN ('received_mill', 'mill_qc_done'));--> statement-breakpoint
-- Split parts inherit it from their ancestors (a few passes cover chains of splits of splits).
UPDATE `takas` SET `has_been_to_mill` = 1 WHERE `has_been_to_mill` = 0 AND `parent_taka_id` IN (SELECT `id` FROM `takas` WHERE `has_been_to_mill` = 1);--> statement-breakpoint
UPDATE `takas` SET `has_been_to_mill` = 1 WHERE `has_been_to_mill` = 0 AND `parent_taka_id` IN (SELECT `id` FROM `takas` WHERE `has_been_to_mill` = 1);--> statement-breakpoint
UPDATE `takas` SET `has_been_to_mill` = 1 WHERE `has_been_to_mill` = 0 AND `parent_taka_id` IN (SELECT `id` FROM `takas` WHERE `has_been_to_mill` = 1);--> statement-breakpoint
-- Backfill taka_damages.recorded_at (best effort) from where the damage was found.
UPDATE `taka_damages` SET `recorded_at` = CASE `found_at`
  WHEN 'machine' THEN 'taka_entry'
  WHEN 'butta' THEN 'butta_qc'
  WHEN 'mill' THEN 'mill_qc'
  WHEN 'godown' THEN 'godown'
  WHEN 'customer_return' THEN 'goods_return'
  ELSE NULL END
WHERE `recorded_at` IS NULL;
