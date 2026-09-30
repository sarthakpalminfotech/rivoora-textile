ALTER TABLE `takas` ADD `stage` text DEFAULT 'entered' NOT NULL;--> statement-breakpoint
-- Backfill: every existing taka is at Taka entry done (waiting for butta cutting).
UPDATE `takas` SET `stage` = 'entered' WHERE `stage` IS NULL OR `stage` = '';--> statement-breakpoint
CREATE INDEX `takas_stage_idx` ON `takas` (`stage`);
