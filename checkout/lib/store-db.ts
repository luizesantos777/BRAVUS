import {database} from './payments';
export async function storeDb(){const db=database();await db.prepare(`CREATE TABLE IF NOT EXISTS store_orders (id TEXT PRIMARY KEY,payload TEXT NOT NULL,subtotal INTEGER NOT NULL,freight INTEGER,delivery TEXT,payment_url TEXT,created_at INTEGER NOT NULL)`).run();return db;}
