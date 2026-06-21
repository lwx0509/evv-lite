import { getUncachableStripeClient } from '../stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();
  console.log('Creating EVV-lite subscription plans...');

  const plans = [
    {
      name: 'Starter',
      description: 'Up to 3 caregivers. GPS check-in/out, visit scheduling, basic reporting.',
      monthly: 4900,
      yearly: 47000,
    },
    {
      name: 'Professional',
      description: 'Up to 15 caregivers. Everything in Starter plus payroll export, automated alerts, invoicing.',
      monthly: 9900,
      yearly: 95000,
    },
    {
      name: 'Agency',
      description: 'Unlimited caregivers. Everything in Professional plus priority support and custom branding.',
      monthly: 19900,
      yearly: 190000,
    },
  ];

  for (const plan of plans) {
    const existing = await stripe.products.search({ query: `name:'${plan.name}' AND active:'true'` });
    if (existing.data.length > 0) {
      console.log(`  ${plan.name} already exists (${existing.data[0].id}) — skipping`);
      continue;
    }

    const product = await stripe.products.create({ name: plan.name, description: plan.description });
    console.log(`  Created product: ${product.name} (${product.id})`);

    const monthly = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.monthly,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
    console.log(`    Monthly: $${plan.monthly / 100}/mo (${monthly.id})`);

    const yearly = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.yearly,
      currency: 'usd',
      recurring: { interval: 'year' },
    });
    console.log(`    Yearly:  $${plan.yearly / 100}/yr (${yearly.id})`);
  }

  console.log('\nDone. Webhooks will sync products to the database automatically.');
}

createProducts().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
