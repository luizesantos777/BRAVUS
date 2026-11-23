CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`amount` integer NOT NULL,
	`state` text NOT NULL,
	`pix_code` text,
	`qr` text,
	`created_at` integer NOT NULL,
	`checked_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_orders_request_id_unique` ON `payment_orders` (`request_id`);--> statement-breakpoint
CREATE TABLE `payment_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
