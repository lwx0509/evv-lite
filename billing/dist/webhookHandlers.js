"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookHandlers = void 0;
const stripeClient_1 = require("./stripeClient");
class WebhookHandlers {
    static async processWebhook(payload, signature) {
        if (!Buffer.isBuffer(payload)) {
            throw new Error('STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
                'Received type: ' + typeof payload + '. ' +
                'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).');
        }
        const sync = await (0, stripeClient_1.getStripeSync)();
        await sync.processWebhook(payload, signature);
    }
}
exports.WebhookHandlers = WebhookHandlers;
