"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const stripe_replit_sync_1 = require("stripe-replit-sync");
const stripeClient_1 = require("./stripeClient");
const pg_1 = require("pg");
const app_1 = __importDefault(require("./app"));
async function createAppTables() {
    const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_billing (
      agency_id        INTEGER PRIMARY KEY,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )
  `);
    await pool.end();
    console.log('App tables ready');
}
async function initStripe() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl)
        throw new Error('DATABASE_URL is required');
    console.log('Running Stripe migrations...');
    await (0, stripe_replit_sync_1.runMigrations)({ databaseUrl });
    console.log('Stripe schema ready');
    await createAppTables();
    const stripeSync = await (0, stripeClient_1.getStripeSync)();
    const domains = process.env.REPLIT_DOMAINS?.split(',')[0];
    if (domains) {
        const webhookUrl = `https://${domains}/api/stripe/webhook`;
        console.log('Setting up webhook at', webhookUrl);
        await stripeSync.findOrCreateManagedWebhook(webhookUrl);
        console.log('Webhook configured');
    }
    stripeSync.syncBackfill()
        .then(() => console.log('Stripe data synced'))
        .catch((err) => console.error('Stripe backfill error:', err.message));
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
