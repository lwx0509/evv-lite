import { Pool } from 'pg';
import { getUncachableStripeClient } from './stripeClient';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function hasStripeData(): Promise<boolean> {
  try {
    const result = await pool.query(`SELECT COUNT(*) FROM stripe.products`);
    return parseInt(result.rows[0].count) > 0;
  } catch {
    return false;
  }
}

export const storage = {
  async listProductsWithPrices() {
    if (await hasStripeData()) {
      const result = await pool.query(`
        WITH paginated_products AS (
          SELECT id, name, description, metadata, active
          FROM stripe.products
          WHERE active = true
          ORDER BY name
        )
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.description AS product_description,
          p.active AS product_active,
          p.metadata AS product_metadata,
          pr.id AS price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active AS price_active
        FROM paginated_products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        ORDER BY p.name, pr.unit_amount
      `);
      return result.rows;
    }

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
    if (await hasStripeData()) {
      const result = await pool.query(
        `SELECT * FROM stripe.subscriptions WHERE customer = $1 AND status IN ('active','trialing','past_due') ORDER BY created DESC LIMIT 1`,
        [customerId]
      );
      return result.rows[0] || null;
    }
    const stripe = await getUncachableStripeClient();
    const subs = await stripe.subscriptions.list({
      customer: customerId, status: 'active', limit: 1,
    });
    return subs.data[0] || null;
  },

  async getSubscriptionById(subscriptionId: string) {
    if (await hasStripeData()) {
      const result = await pool.query(
        `SELECT * FROM stripe.subscriptions WHERE id = $1`,
        [subscriptionId]
      );
      return result.rows[0] || null;
    }
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
