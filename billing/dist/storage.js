"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storage = void 0;
const pg_1 = require("pg");
const stripeClient_1 = require("./stripeClient");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
exports.storage = {
    async listProductsWithPrices() {
        const stripe = await (0, stripeClient_1.getUncachableStripeClient)();
        const products = await stripe.products.list({ active: true, limit: 20 });
        const rows = [];
        for (const product of products.data) {
            const prices = await stripe.prices.list({ product: product.id, active: true });
            if (prices.data.length === 0) {
                rows.push({
                    product_id: product.id, product_name: product.name,
                    product_description: product.description, product_active: product.active,
                    product_metadata: product.metadata, price_id: null,
                    unit_amount: null, currency: null, recurring: null, price_active: null,
                });
            }
            else {
                for (const price of prices.data) {
                    rows.push({
                        product_id: product.id, product_name: product.name,
                        product_description: product.description, product_active: product.active,
                        product_metadata: product.metadata, price_id: price.id,
                        unit_amount: price.unit_amount, currency: price.currency,
                        recurring: price.recurring, price_active: price.active,
                    });
                }
            }
        }
        return rows;
    },
    async getSubscriptionByCustomerId(customerId) {
        const stripe = await (0, stripeClient_1.getUncachableStripeClient)();
        const subs = await stripe.subscriptions.list({
            customer: customerId, status: 'active', limit: 1,
        });
        return subs.data[0] || null;
    },
    async getSubscriptionById(subscriptionId) {
        const stripe = await (0, stripeClient_1.getUncachableStripeClient)();
        return await stripe.subscriptions.retrieve(subscriptionId);
    },
    async getAgencyStripeInfo(agencyId) {
        const result = await pool.query(`SELECT stripe_customer_id, stripe_subscription_id FROM agency_billing WHERE agency_id = $1`, [agencyId]);
        return result.rows[0] || null;
    },
    async upsertAgencyStripeInfo(agencyId, stripeCustomerId, stripeSubscriptionId) {
        await pool.query(`
      INSERT INTO agency_billing (agency_id, stripe_customer_id, stripe_subscription_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (agency_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, agency_billing.stripe_subscription_id),
        updated_at = NOW()
    `, [agencyId, stripeCustomerId, stripeSubscriptionId || null]);
    },
};
