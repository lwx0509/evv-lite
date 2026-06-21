import { Router } from 'express';
import { storage } from '../storage';
import { getUncachableStripeClient } from '../stripeClient';

const router = Router();

router.get('/billing/plans', async (_req, res) => {
  try {
    const rows = await storage.listProductsWithPrices();
    const productsMap = new Map<string, any>();
    for (const row of rows) {
      if (!productsMap.has(row.product_id)) {
        productsMap.set(row.product_id, {
          id: row.product_id,
          name: row.product_name,
          description: row.product_description,
          prices: [],
        });
      }
      if (row.price_id) {
        productsMap.get(row.product_id).prices.push({
          id: row.price_id,
          unit_amount: row.unit_amount,
          currency: row.currency,
          recurring: row.recurring,
        });
      }
    }
    res.json({ plans: Array.from(productsMap.values()) });
  } catch (err: any) {
    console.error('GET /billing/plans error:', err.message);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

router.get('/billing/subscription', async (req: any, res) => {
  try {
    const agencyId = req.agencyId;
    const info = await storage.getAgencyStripeInfo(agencyId);
    if (!info?.stripe_customer_id) {
      return res.json({ subscription: null });
    }
    const sub = await storage.getSubscriptionByCustomerId(info.stripe_customer_id);
    res.json({ subscription: sub });
  } catch (err: any) {
    console.error('GET /billing/subscription error:', err.message);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

router.post('/billing/checkout', async (req: any, res) => {
  try {
    const { priceId } = req.body;
    if (!priceId) return res.status(400).json({ error: 'priceId required' });

    const agencyId = req.agencyId;
    const agencyEmail = req.agencyEmail;

    const stripe = await getUncachableStripeClient();

    let info = await storage.getAgencyStripeInfo(agencyId);
    let customerId = info?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: agencyEmail,
        metadata: { agencyId: String(agencyId) },
      });
      customerId = customer.id;
      await storage.upsertAgencyStripeInfo(agencyId, customerId);
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/dashboard?billing=success`,
      cancel_url: `${baseUrl}/dashboard?billing=cancel`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('POST /billing/checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/billing/portal', async (req: any, res) => {
  try {
    const agencyId = req.agencyId;
    const info = await storage.getAgencyStripeInfo(agencyId);
    if (!info?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    const stripe = await getUncachableStripeClient();
    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: info.stripe_customer_id,
      return_url: `${baseUrl}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('POST /billing/portal error:', err.message);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

export default router;
