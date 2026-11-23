CREATE TABLE `checkout_sale_deliveries` (
	`order_id` text PRIMARY KEY NOT NULL,
	`proof` text NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`delivered_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_orders_portal_state_created` ON `payment_orders` (`state`,`created_at`) WHERE "payment_orders"."attendant_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO payment_settings (key,value)
VALUES ('portal_checkout_auto_started_at',CAST(CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS TEXT))
ON CONFLICT(key) DO NOTHING;
