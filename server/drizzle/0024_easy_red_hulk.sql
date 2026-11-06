DROP INDEX `beams_beam_no_unique`;--> statement-breakpoint
DROP INDEX `beams_beam_code_unique`;--> statement-breakpoint
ALTER TABLE `beams` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `beams_beam_no_unique` ON `beams` (`fy`,`beam_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `beams_beam_code_unique` ON `beams` (`fy`,lower("beam_code"));--> statement-breakpoint
DROP INDEX `challans_kind_challan_no_unique`;--> statement-breakpoint
ALTER TABLE `challans` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `challans_kind_challan_no_unique` ON `challans` (`kind`,`fy`,`challan_no`);--> statement-breakpoint
DROP INDEX `damaged_lots_lot_no_unique`;--> statement-breakpoint
ALTER TABLE `damaged_lots` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `damaged_lots_lot_no_unique` ON `damaged_lots` (`fy`,`lot_no`);--> statement-breakpoint
DROP INDEX `dispatch_challans_no_revision_unique`;--> statement-breakpoint
ALTER TABLE `dispatch_challans` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_challans_no_revision_unique` ON `dispatch_challans` (`fy`,`challan_no`,`revision`);--> statement-breakpoint
DROP INDEX `jobsheets_jobsheet_no_unique`;--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `jobsheets_jobsheet_no_unique` ON `jobsheets` (`fy`,`jobsheet_no`);--> statement-breakpoint
DROP INDEX `orders_order_no_unique`;--> statement-breakpoint
ALTER TABLE `orders` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`fy`,`order_no`);--> statement-breakpoint
DROP INDEX `outside_pos_po_no_unique`;--> statement-breakpoint
ALTER TABLE `outside_pos` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `outside_pos_po_no_unique` ON `outside_pos` (`fy`,`po_no`);--> statement-breakpoint
DROP INDEX `party_returns_no_unique`;--> statement-breakpoint
ALTER TABLE `party_returns` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `party_returns_no_unique` ON `party_returns` (`fy`,`return_no`);--> statement-breakpoint
DROP INDEX `takas_taka_no_active_unique`;--> statement-breakpoint
ALTER TABLE `takas` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `takas_taka_no_active_unique` ON `takas` (`fy`,`taka_no`) WHERE "takas"."is_deleted" = 0;--> statement-breakpoint
DROP INDEX `warping_jobs_job_no_unique`;--> statement-breakpoint
ALTER TABLE `warping_jobs` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `warping_jobs_job_no_unique` ON `warping_jobs` (`fy`,`job_no`);--> statement-breakpoint
DROP INDEX `yarn_boxes_box_no_unique`;--> statement-breakpoint
ALTER TABLE `yarn_boxes` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_boxes_box_no_unique` ON `yarn_boxes` (`fy`,lower("box_no"));--> statement-breakpoint
DROP INDEX `yarn_pos_po_no_unique`;--> statement-breakpoint
ALTER TABLE `yarn_pos` ADD `fy` text DEFAULT '2026-27' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `yarn_pos_po_no_unique` ON `yarn_pos` (`fy`,`po_no`);

-- Sprint 23 backfill (the ONLY row rewrite): every existing row gets the financial year (India, 1 Apr – 31 Mar, IST) of its created_at.
-- The number columns are NOT touched: the live data keeps its numbering, and the current FY continues the existing sequence.
--> statement-breakpoint
UPDATE `orders` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `jobsheets` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `takas` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `party_returns` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `damaged_lots` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `challans` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `dispatch_challans` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `outside_pos` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `yarn_boxes` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `yarn_pos` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `warping_jobs` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `beams` SET `fy` = CASE WHEN CAST(strftime('%m', `created_at`, '+330 minutes') AS INTEGER) >= 4 THEN strftime('%Y', `created_at`, '+330 minutes') || '-' || substr(CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) + 1 AS TEXT), 3, 2) ELSE CAST(CAST(strftime('%Y', `created_at`, '+330 minutes') AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', `created_at`, '+330 minutes'), 3, 2) END WHERE `created_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `dispatch_challans` SET `fy` = COALESCE((SELECT p.`fy` FROM `dispatch_challans` p WHERE p.`challan_no` = `dispatch_challans`.`challan_no` AND p.`revision` = 0 LIMIT 1), `fy`) WHERE `revision` > 0;
