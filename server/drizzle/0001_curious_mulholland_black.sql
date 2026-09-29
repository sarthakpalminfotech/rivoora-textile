ALTER TABLE `designs` ADD `material_id` integer REFERENCES materials(id);--> statement-breakpoint
CREATE INDEX `designs_material_idx` ON `designs` (`material_id`);