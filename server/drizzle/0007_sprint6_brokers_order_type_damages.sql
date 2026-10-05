CREATE TABLE `customer_brokers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customer_brokers_customer_idx` ON `customer_brokers` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_brokers_name_active_unique` ON `customer_brokers` (`customer_id`,lower("name")) WHERE "customer_brokers"."is_deleted" = 0;--> statement-breakpoint
CREATE TABLE `damages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `damages_name_active_unique` ON `damages` (lower("name")) WHERE "damages"."is_deleted" = 0;--> statement-breakpoint
ALTER TABLE `orders` ADD `broker_id` integer REFERENCES customer_brokers(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `order_type` text DEFAULT 'pcs_to_pcs' NOT NULL;--> statement-breakpoint
-- Backfill: existing orders are Pcs to pcs (they can be changed by editing the order).
UPDATE `orders` SET `order_type` = 'pcs_to_pcs' WHERE `order_type` IS NULL OR `order_type` = '';--> statement-breakpoint
CREATE INDEX `orders_broker_idx` ON `orders` (`broker_id`);--> statement-breakpoint
ALTER TABLE `takas` ADD `pcs` integer;--> statement-breakpoint
ALTER TABLE `takas` ADD `damage_id` integer REFERENCES damages(id);--> statement-breakpoint
CREATE INDEX `takas_damage_idx` ON `takas` (`damage_id`);