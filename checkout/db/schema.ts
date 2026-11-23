import { sql } from 'drizzle-orm';
import { index, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const settings = sqliteTable('payment_settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const orders = sqliteTable('payment_orders', {
 id: text('id').primaryKey(), requestId: text('request_id').notNull().unique(), amount: integer('amount').notNull(),
 provider: text('provider').notNull().default('buckpay'), payloadHash: text('payload_hash'), transactionId: text('transaction_id'),
 sellerName: text('seller_name'), state: text('state').notNull(), pixCode: text('pix_code'), qr: text('qr'), createdAt: integer('created_at').notNull(), checkedAt: integer('checked_at').notNull().default(0)
 , origin: text('origin'), attendantId: text('attendant_id')
}, table => [
 index('payment_orders_portal_state_created').on(table.state, table.createdAt).where(sql`${table.attendantId} IS NOT NULL`),
]);
export const checkoutSaleDeliveries = sqliteTable('checkout_sale_deliveries', {
 orderId: text('order_id').primaryKey().notNull().references(() => orders.id),
 proof: text('proof').notNull(),
 retryAt: integer('retry_at').notNull().default(0),
 attempts: integer('attempts').notNull().default(0),
 deliveredAt: integer('delivered_at'),
});
export const partners = sqliteTable('partners', {
 slug: text('slug').primaryKey(), name: text('name').notNull(), active: integer('active', { mode: 'boolean' }).notNull().default(true),
 createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull()
 });
