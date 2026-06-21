"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUncachableStripeClient = getUncachableStripeClient;
exports.getStripeSync = getStripeSync;
const stripe_1 = __importDefault(require("stripe"));
const stripe_replit_sync_1 = require("stripe-replit-sync");
async function getStripeCredentials() {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
        ? "repl " + process.env.REPL_IDENTITY
        : process.env.WEB_REPL_RENEWAL
            ? "depl " + process.env.WEB_REPL_RENEWAL
            : null;
    if (!hostname || !xReplitToken) {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (secretKey)
            return { secretKey };
        throw new Error('Missing Replit environment variables. ' +
            'Ensure the Stripe integration is connected via the Integrations tab.');
    }
    const resp = await fetch(`https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`, {
        headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
        signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (secretKey)
            return { secretKey };
        throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
    }
    const data = await resp.json();
    const settings = data.items?.[0]?.settings;
    if (!settings?.secret_key) {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (secretKey)
            return { secretKey };
        throw new Error('Stripe integration not connected or missing secret key. ' +
            'Connect Stripe via the Integrations tab first.');
    }
    return {
        secretKey: settings.secret_key,
        webhookSecret: settings.webhook_secret,
    };
}
async function getUncachableStripeClient() {
    const { secretKey } = await getStripeCredentials();
    return new stripe_1.default(secretKey);
}
async function getStripeSync() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }
    const { secretKey, webhookSecret } = await getStripeCredentials();
    return new stripe_replit_sync_1.StripeSync({
        poolConfig: { connectionString: databaseUrl },
        stripeSecretKey: secretKey,
        stripeWebhookSecret: webhookSecret ?? '',
    });
}
