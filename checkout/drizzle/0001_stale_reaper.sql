ALTER TABLE `payment_orders` ADD `provider` text DEFAULT 'buckpay' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_orders` ADD `payload_hash` text;--> statement-breakpoint
ALTER TABLE `payment_orders` ADD `transaction_id` text;