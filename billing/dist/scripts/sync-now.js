"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stripeClient_1 = require("../stripeClient");
async function main() {
    const sync = await (0, stripeClient_1.getStripeSync)();
    console.log('Syncing Stripe data...');
    await sync.syncBackfill();
    console.log('Done.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
