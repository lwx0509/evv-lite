import Stripe from 'stripe';

function getSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is required');
  return key;
}

export function getStripeClient(): Stripe {
  return new Stripe(getSecretKey());
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  return getStripeClient();
}
