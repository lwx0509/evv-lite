import { getStripeSync } from '../stripeClient';

async function main() {
  const sync = await getStripeSync();
  console.log('Syncing Stripe data...');
  await sync.syncBackfill();
  console.log('Done.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
