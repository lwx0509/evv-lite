"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stripeClient_1 = require("../stripeClient");
const pg_1 = require("pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
    const stripe = (0, stripeClient_1.getStripeClient)();
    console.log('Syncing Stripe data...');
    const products = await stripe.products.list({ limit: 100, active: true });
    for (const p of products.data) {
        await pool.query(`
      INSERT INTO stripe.products (id, name, description, metadata, active, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, metadata=$4, active=$5, updated_at=NOW()
    `, [p.id, p.name, p.description, JSON.stringify(p.metadata), p.active]);
    }
    const prices = await stripe.prices.list({ limit: 100, active: true });
    for (const pr of prices.data) {
        await pool.query(`
      INSERT INTO stripe.prices (id, product, unit_amount, currency, recurring, active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET product=$2, unit_amount=$3, currency=$4, recurring=$5, active=$6, updated_at=NOW()
    `, [pr.id, pr.product, pr.unit_amount, pr.currency, JSON.stringify(pr.recurring), pr.active]);
    }
    console.log('Done.');
    await pool.end();
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
