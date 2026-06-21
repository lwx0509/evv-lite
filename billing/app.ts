import express from 'express';
import cors from 'cors';
import { WebhookHandlers } from './webhookHandlers';
import stripeRouter from './routes/stripe';

const app = express();

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing stripe-signature' });
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error('Webhook error:', err.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(cors());
app.use(express.json());

app.use('/api', async (req: any, _res, next) => {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) { req.agencyId = null; req.agencyEmail = null; return next(); }
  try {
    const token = auth.slice(7);
    const [headerB64, payloadB64] = token.split('.');
    if (!headerB64 || !payloadB64) throw new Error('bad token');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    req.agencyId = payload.agency_id ?? null;
    req.agencyEmail = payload.email ?? null;
  } catch {
    req.agencyId = null;
    req.agencyEmail = null;
  }
  next();
});

app.use('/api', stripeRouter);

export default app;
