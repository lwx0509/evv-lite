import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

type Price = {
  id: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string } | null;
};

type Plan = {
  id: string;
  name: string;
  description: string;
  prices: Price[];
};

type Subscription = {
  id: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: { data: { price: { id: string; unit_amount: number; recurring: { interval: string } | null } }[] };
};

function useBillingApi() {
  const navigate = useNavigate();
  const token = localStorage.getItem('evv_token');
  return useCallback(async (path: string, opts: RequestInit = {}) => {
    const headers: Record<string, string> = { ...(opts.headers as any) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api${path}`, { ...opts, headers });
    if (res.status === 401) { navigate('/'); return null; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  }, [token, navigate]);
}

function formatAmount(unit_amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(unit_amount / 100);
}

function PlanCard({
  plan,
  onSubscribe,
  currentPriceId,
  loading,
  interval,
}: {
  plan: Plan;
  onSubscribe: (priceId: string) => void;
  currentPriceId?: string;
  loading: boolean;
  interval: 'month' | 'year';
}) {
  const price = plan.prices.find(p => p.recurring?.interval === interval);
  if (!price) return null;

  const isCurrentPlan = currentPriceId === price.id;

  const highlights: Record<string, string[]> = {
    Starter: ['Up to 3 caregivers', 'GPS check-in/out', 'Visit scheduling', 'Basic reporting'],
    Professional: ['Up to 15 caregivers', 'Everything in Starter', 'Payroll export', 'Automated alerts', 'Invoicing'],
    Agency: ['Unlimited caregivers', 'Everything in Professional', 'Priority support', 'Custom branding'],
  };

  const accentColors: Record<string, string> = {
    Starter: 'border-slate-200',
    Professional: 'border-[#1f4e79] ring-2 ring-[#1f4e79]/20',
    Agency: 'border-slate-200',
  };

  const features = highlights[plan.name] || [];

  return (
    <div className={`relative bg-white border rounded-xl p-6 flex flex-col gap-4 transition-shadow hover:shadow-md ${accentColors[plan.name] || 'border-slate-200'}`}>
      {plan.name === 'Professional' && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1f4e79] text-white text-xs font-semibold px-3 py-0.5 rounded-full">
          Most popular
        </span>
      )}

      <div>
        <h3 className="text-lg font-bold text-slate-800">{plan.name}</h3>
        <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
      </div>

      <div className="flex items-end gap-1">
        <span className="text-3xl font-extrabold text-slate-800">{formatAmount(price.unit_amount, price.currency)}</span>
        <span className="text-sm text-slate-500 mb-1">/{interval === 'year' ? 'yr' : 'mo'}</span>
      </div>
      {interval === 'year' && (
        <p className="text-xs text-emerald-600 font-medium -mt-3">
          ~{formatAmount(Math.round(price.unit_amount / 12), price.currency)}/mo — save ~2 months
        </p>
      )}

      <ul className="space-y-1.5 text-sm text-slate-600 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-center gap-2">
            <span className="text-emerald-500 font-bold">✓</span> {f}
          </li>
        ))}
      </ul>

      <button
        onClick={() => onSubscribe(price.id)}
        disabled={loading || isCurrentPlan}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${
          isCurrentPlan
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
            : 'bg-[#1f4e79] text-white hover:bg-[#163a5e] disabled:opacity-50'
        }`}
      >
        {isCurrentPlan ? '✓ Current plan' : loading ? 'Loading…' : 'Subscribe'}
      </button>
    </div>
  );
}

function SubscriptionStatus({
  subscription,
  onManage,
  loading,
}: {
  subscription: Subscription;
  onManage: () => void;
  loading: boolean;
}) {
  const statusColors: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    trialing: 'bg-blue-50 text-blue-700',
    past_due: 'bg-amber-50 text-amber-700',
    canceled: 'bg-red-50 text-red-700',
  };

  const currentItem = subscription.items?.data?.[0];
  const price = currentItem?.price;
  const renewDate = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toLocaleDateString()
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColors[subscription.status] || 'bg-slate-100 text-slate-600'}`}>
            {subscription.status.replace('_', ' ').toUpperCase()}
          </span>
          {subscription.cancel_at_period_end && (
            <span className="text-xs text-amber-600 font-medium">Cancels at period end</span>
          )}
        </div>
        {price && (
          <p className="text-sm text-slate-700 font-medium">
            {formatAmount(price.unit_amount, 'usd')}/{price.recurring?.interval || 'mo'}
          </p>
        )}
        {renewDate && (
          <p className="text-xs text-slate-500">
            {subscription.cancel_at_period_end ? 'Access until' : 'Renews'}: {renewDate}
          </p>
        )}
      </div>
      <button
        onClick={onManage}
        disabled={loading}
        className="shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading ? 'Loading…' : 'Manage subscription'}
      </button>
    </div>
  );
}

export function SubscriptionTab() {
  const api = useBillingApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const billing = searchParams.get('billing');
    if (billing === 'success') {
      setSuccessMsg('Subscription activated! Welcome aboard.');
      setSearchParams({});
    } else if (billing === 'cancel') {
      setSearchParams({});
    }
  }, []);

  useEffect(() => {
    Promise.all([
      api('/billing/plans').then(d => d && setPlans(d.plans || [])),
      api('/billing/subscription').then(d => d && setSubscription(d.subscription)),
    ]).catch(err => setError(err.message));
  }, []);

  const handleSubscribe = async (priceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ priceId }),
      });
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManagePortal = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/billing/portal', { method: 'POST' });
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentPriceId = subscription?.items?.data?.[0]?.price?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
        <h2 className="text-xl font-bold text-slate-800">Renew Subscription</h2>
        <p className="text-sm text-slate-500 mt-0.5">Manage your Visiting Systems plan and payment method</p>         </div>
        <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
          <button
            onClick={() => setInterval('month')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${interval === 'month' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setInterval('year')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${interval === 'year' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Yearly
            <span className="ml-1.5 text-xs text-emerald-600 font-semibold">Save ~17%</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <span className="text-emerald-500 text-base">✓</span> {successMsg}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {subscription && (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">Current subscription</h3>
          <SubscriptionStatus subscription={subscription} onManage={handleManagePortal} loading={loading} />
        </div>
      )}

      {plans.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-3">💳</div>
          <p className="text-sm">No plans available yet.</p>
          <p className="text-xs mt-1 text-slate-400">Run <code className="bg-slate-100 px-1 py-0.5 rounded">npx tsx billing/scripts/seed-products.ts</code> to create plans.</p>
        </div>
      ) : (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">
            {subscription ? 'Change plan' : 'Choose a plan'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-2">
            {plans.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onSubscribe={handleSubscribe}
                currentPriceId={currentPriceId}
                loading={loading}
                interval={interval}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
