"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookHandlers = void 0;
const stripeClient_1 = require("./stripeClient");
const pg_1 = require("pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
class WebhookHandlers {
    static async processWebhook(payload, signature) {
        if (!Buffer.isBuffer(payload)) {
            throw new Error('STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
                'Received type: ' + typeof payload + '. ' +
                'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).');
        }
        const stripe = (0, stripeClient_1.getStripeClient)();
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        let event;
        if (webhookSecret) {
            event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
        }
        else {
            event = JSON.parse(payload.toString());
            console.warn('No STRIPE_WEBHOOK_SECRET set — skipping signature verification');
        }
        const data = event.data.object;
        switch (event.type) {
            case 'product.created':
            case 'product.updated':
                await pool.query(`
          INSERT INTO stripe.products (id, name, description, metadata, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (id) DO UPDATE SET
            name=$2, description=$3, metadata=$4, updated_at=NOW()
        `, [data.id, data.name, data.description, JSON.stringify(data.metadata)]);
                break;
            case 'product.deleted':
                await pool.query(`UPDATE stripe.products SET updated_at=NOW() WHERE id=$1`, [data.id]);
                break;
            case 'price.created':
            case 'price.updated':
                await pool.query(`
          INSERT INTO stripe.prices (id, product, unit_amount, currency, recurring, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (id) DO UPDATE SET
            product=$2, unit_amount=$3, currency=$4, recurring=$5, updated_at=NOW()
        `, [data.id, data.product, data.unit_amount, data.currency,
                    JSON.stringify(data.recurring)]);
                break;
            case 'price.deleted':
                await pool.query(`UPDATE stripe.prices SET updated_at=NOW() WHERE id=$1`, [data.id]);
                break;
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await pool.query(`
          INSERT INTO stripe.subscriptions
            (id, customer, status, current_period_start, current_period_end,
             cancel_at_period_end, price_id, updated_at)
          VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($5), $6, $7, NOW())
          ON CONFLICT (id) DO UPDATE SET
            customer=$2, status=$3,
            current_period_start=to_timestamp($4),
            current_period_end=to_timestamp($5),
            cancel_at_period_end=$6, price_id=$7, updated_at=NOW()
        `, [
                    data.id, data.customer, data.status,
                    data.current_period_start, data.current_period_end,
                    data.cancel_at_period_end,
                    data.items?.data?.[0]?.price?.id ?? null,
                ]);
                break;
            case 'customer.subscription.deleted':
                await pool.query(`UPDATE stripe.subscriptions SET status='canceled', updated_at=NOW() WHERE id=$1`, [data.id]);
                break;
            case 'customer.created':
            case 'customer.updated':
                await pool.query(`
          INSERT INTO stripe.customers (id, email, name, metadata, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (id) DO UPDATE SET
            email=$2, name=$3, metadata=$4, updated_at=NOW()
        `, [data.id, data.email, data.name, JSON.stringify(data.metadata)]);
                break;
            default:
                break;
        }
    }
}
exports.WebhookHandlers = WebhookHandlers;
