"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const stripeClient_1 = require("./stripeClient");
const app_1 = __importDefault(require("./app"));
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
async function createAppTables() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_billing (
      agency_id              INTEGER PRIMARY KEY,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      created_at             TIMESTAMP DEFAULT NOW(),
      updated_at             TIMESTAMP DEFAULT NOW()
    )
  `);
    console.log('App tables ready');
}
async function findOrCreateWebhook(webhookUrl) {
    const stripe = (0, stripeClient_1.getStripeClient)();
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    const existing = list.data.find(w => w.url === webhookUrl && w.status === 'enabled');
    if (existing) {
        console.log('Webhook already configured');
        return;
    }
    const webhook = await stripe.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: [
            'product.created', 'product.updated', 'product.deleted',
            'price.created', 'price.updated', 'price.deleted',
            'customer.created', 'customer.updated',
            'customer.subscription.created',
            'customer.subscription.updated',
            'customer.subscription.deleted',
        ],
    });
    if (webhook.secret) {
        console.log(`Webhook created. Set this in Railway Variables: STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
    }
}
async function initStripe() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl)
        throw new Error('DATABASE_URL is required');
    await createAppTables();
    const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
    const rawAppUrl = process.env.APP_URL?.replace(/\/$/, '');
    const appUrl = rawAppUrl
        ? (rawAppUrl.startsWith('http') ? rawAppUrl : `https://${rawAppUrl}`)
        : undefined;
    const publicBase = replitDomain ? `https://${replitDomain}` : appUrl;
    if (publicBase) {
        const webhookUrl = `${publicBase}/api/stripe/webhook`;
        console.log('Setting up webhook at', webhookUrl);
        try {
            await findOrCreateWebhook(webhookUrl);
        }
        catch (err) {
            console.error('Webhook setup failed (non-fatal):', err.message);
        }
    }
    else {
        console.log('No public domain set — skipping webhook setup (set APP_URL on Railway)');
    }
}
const port = Number(process.env.BILLING_PORT) || 8081;
initStripe()
    .then(() => {
    app_1.default.listen(port, () => console.log(`Billing server running on port ${port}`));
})
    .catch((err) => {
    console.error('Failed to start billing server:', err);
    process.exit(1);
});
