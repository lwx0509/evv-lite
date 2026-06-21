"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const webhookHandlers_1 = require("./webhookHandlers");
const stripe_1 = __importDefault(require("./routes/stripe"));
const app = (0, express_1.default)();
app.post('/api/stripe/webhook', express_1.default.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature)
        return res.status(400).json({ error: 'Missing stripe-signature' });
    try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        await webhookHandlers_1.WebhookHandlers.processWebhook(req.body, sig);
        res.status(200).json({ received: true });
    }
    catch (err) {
        console.error('Webhook error:', err.message);
        res.status(400).json({ error: 'Webhook processing error' });
    }
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api', async (req, _res, next) => {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
        req.agencyId = null;
        req.agencyEmail = null;
        return next();
    }
    try {
        const token = auth.slice(7);
        const [headerB64, payloadB64] = token.split('.');
        if (!headerB64 || !payloadB64)
            throw new Error('bad token');
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        req.agencyId = payload.agency_id ?? null;
        req.agencyEmail = payload.email ?? null;
    }
    catch {
        req.agencyId = null;
        req.agencyEmail = null;
    }
    next();
});
app.use('/api', stripe_1.default);
exports.default = app;
