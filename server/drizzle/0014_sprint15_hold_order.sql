CREATE TABLE `order_hold_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`event` text NOT NULL,
	`note` text,
	`role` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_hold_events_order_idx` ON `order_hold_events` (`order_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `is_on_hold` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `held_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `held_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `hold_note` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `released_at` text;--> statement-breakpoint
CREATE INDEX `orders_is_on_hold_idx` ON `orders` (`is_on_hold`);