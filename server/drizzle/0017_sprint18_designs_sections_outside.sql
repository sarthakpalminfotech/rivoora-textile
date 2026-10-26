-- Sprint 18: design qualities, variations become designs, sections per beam, outside order.
-- Generated DDL first (additive), then the ONE data change, hand-written. The whole file runs in ONE transaction: if a
-- check below fails (it inserts NULL into a NOT NULL column), nothing at all is changed.
CREATE TABLE `design_qualities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`design_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_qualities_design_material_unique` ON `design_qualities` (`design_id`,`material_id`);--> statement-breakpoint
CREATE INDEX `design_qualities_material_idx` ON `design_qualities` (`material_id`);--> statement-breakpoint
CREATE TABLE `design_variation_map` (
	`variation_id` integer PRIMARY KEY NOT NULL,
	`new_design_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`variation_id`) REFERENCES `design_variations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`new_design_id`) REFERENCES `designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `jobsheets` ADD `sections` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `is_outside_order` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `outside_party_name` text;--> statement-breakpoint
-- What the database looked like before the data change (used by the checks below).
CREATE TABLE `__s18_state` (`max_design_id` integer NOT NULL, `variations` integer NOT NULL, `orders_on_variation` integer NOT NULL);--> statement-breakpoint
INSERT INTO `__s18_state` (`max_design_id`, `variations`, `orders_on_variation`)
SELECT (SELECT COALESCE(MAX(`id`), 0) FROM `designs`), (SELECT COUNT(*) FROM `design_variations`),
	(SELECT COUNT(*) FROM `orders` WHERE `variation_id` IS NOT NULL);--> statement-breakpoint
-- 1. One NEW design per variation (in variation id order): the variation's code + image, the parent's name, notes,
--    butta cutting and (deprecated) material. A variation of a deleted design becomes a deleted design.
INSERT INTO `designs` (`code`, `name`, `image_url`, `thumb_url`, `notes`, `material_id`, `butta_cutting`, `is_deleted`, `created_at`, `updated_at`)
SELECT v.`code`, d.`name`, v.`image_url`, v.`thumb_url`, d.`notes`, d.`material_id`, d.`butta_cutting`, d.`is_deleted`, v.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `design_variations` v JOIN `designs` d ON d.`id` = v.`design_id`
ORDER BY v.`id`;--> statement-breakpoint
-- 2. The map: the n-th variation (by id) ↔ the n-th new design (by id). Check 3 confirms every pair has the same code.
INSERT INTO `design_variation_map` (`variation_id`, `new_design_id`)
SELECT v.`id`, n.`id`
FROM (SELECT `id`, ROW_NUMBER() OVER (ORDER BY `id`) AS rn FROM `design_variations`) v
JOIN (SELECT `id`, ROW_NUMBER() OVER (ORDER BY `id`) AS rn FROM `designs` WHERE `id` > (SELECT `max_design_id` FROM `__s18_state`)) n ON n.rn = v.rn;--> statement-breakpoint
-- 3. Orders on a variation now point to the design it became.
UPDATE `orders`
SET `design_id` = (SELECT m.`new_design_id` FROM `design_variation_map` m WHERE m.`variation_id` = `orders`.`variation_id`),
	`variation_id` = NULL
WHERE `variation_id` IS NOT NULL;--> statement-breakpoint
-- 4. Every design's (old, single) material becomes its first quality (the new designs carry their parent's).
INSERT INTO `design_qualities` (`design_id`, `material_id`)
SELECT `id`, `material_id` FROM `designs` WHERE `material_id` IS NOT NULL;--> statement-breakpoint
-- Checks: any mismatch inserts NULL into a NOT NULL column and the whole migration is rolled back.
CREATE TABLE `__s18_check` (`ok` integer NOT NULL);--> statement-breakpoint
INSERT INTO `__s18_check` (`ok`) SELECT CASE WHEN
	-- new designs = variations, and the map has one row per variation
	(SELECT COUNT(*) FROM `designs` WHERE `id` > (SELECT `max_design_id` FROM `__s18_state`)) = (SELECT `variations` FROM `__s18_state`)
	AND (SELECT COUNT(*) FROM `design_variation_map`) = (SELECT `variations` FROM `__s18_state`)
	-- every mapped design carries its variation's code and image
	AND (SELECT COUNT(*) FROM `design_variation_map` m
		JOIN `design_variations` v ON v.`id` = m.`variation_id`
		JOIN `designs` n ON n.`id` = m.`new_design_id`
		WHERE n.`code` = v.`code` AND n.`image_url` IS v.`image_url`) = (SELECT `variations` FROM `__s18_state`)
	-- orders on a variation before = orders on the mapped designs after; none left on a variation
	AND (SELECT COUNT(*) FROM `orders` WHERE `variation_id` IS NOT NULL) = 0
	AND (SELECT COUNT(*) FROM `orders` WHERE `design_id` IN (SELECT `new_design_id` FROM `design_variation_map`)) = (SELECT `orders_on_variation` FROM `__s18_state`)
	-- no duplicate design codes among active designs
	AND (SELECT COUNT(*) FROM (SELECT `code` FROM `designs` WHERE `is_deleted` = 0 GROUP BY `code` HAVING COUNT(*) > 1)) = 0
	-- every design with a material has exactly that quality
	AND (SELECT COUNT(*) FROM `design_qualities`) = (SELECT COUNT(*) FROM `designs` WHERE `material_id` IS NOT NULL)
	THEN 1 ELSE NULL END;--> statement-breakpoint
DROP TABLE `__s18_check`;--> statement-breakpoint
DROP TABLE `__s18_state`;
