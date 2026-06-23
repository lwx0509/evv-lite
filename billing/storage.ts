import { Pool } from 'pg';
import { getUncachableStripeClient } from './stripeClient';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const storage = {
  async listProductsWithPrices() {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true, limit: 20 });
    const rows: any[] = [];
    for (const product of products.data) {
      const prices = await stripe.prices.list({ product: product.id, active: true });
      if (prices.data.length === 0) {
        rows.push({
          product_id: product.id, product_name: product.name,
          product_description: product.description, product_active: product.active,
          product_metadata: product.metadata, price_id: null,
          unit_amount: null, currency: null, recurring: null, price_active: null,
        });
      } else {
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

  async getSubscriptionByCustomerId(customerId: string) {
    const stripe = await getUncachableStripeClient();
    const subs = await stripe.subscriptions.list({
      customer: customerId, status: 'active', limit: 1,
    });
    return subs.data[0] || null;
  },

  async getSubscriptionById(subscriptionId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.subscriptions.retrieve(subscriptionId);
  },

  async getAgencyStripeInfo(agencyId: number) {
    const result = await pool.query(
      `SELECT stripe_customer_id, stripe_subscription_id FROM agency_billing WHERE agency_id = $1`,
      [agencyId]
    );
    return result.rows[0] || null;
  },

  async upsertAgencyStripeInfo(agencyId: number, stripeCustomerId: string, stripeSubscriptionId?: string) {
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
