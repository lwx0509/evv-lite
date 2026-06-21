import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoTemplate from './components/video/VideoTemplate';

const TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern (ET)' },
  { value: 'America/Chicago',     label: 'Central (CT)' },
  { value: 'America/Denver',      label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Phoenix',     label: 'Arizona (no DST)' },
  { value: 'America/Anchorage',   label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii (HST)' },
];

const PLAN_BENEFITS: Record<string, string[]> = {
  Starter: [
    'Up to 3 caregivers',
    'GPS-verified check-in & check-out',
    'Visit scheduling',
    'QR code door signs',
    'Basic visit reporting',
    'Mobile-friendly caregiver app',
  ],
  Professional: [
    'Up to 15 caregivers',
    'Everything in Starter',
    'Automated overdue alerts (email)',
    'Weekly payroll export',
    'Client invoicing',
    'Exceptions dashboard',
  ],
  Agency: [
    'Unlimited caregivers',
    'Everything in Professional',
    'Priority support',
    'Custom branding',
    'Advanced analytics',
    'Dedicated onboarding',
  ],
};

type Price = { id: string; unit_amount: number; currency: string; recurring: { interval: string } | null };
type Plan  = { id: string; name: string; description: string; prices: Price[] };
type Modal = null | 'signin' | 'signup' | 'contact';

function fmt(cents: number) {
  return '$' + (cents / 100).toFixed(0);
}

export default function EVVLogin() {
  const navigate  = useNavigate();

  // overlay / plan state
  const [showOverlay, setShowOverlay]     = useState(false);
  const [plans, setPlans]                 = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan]   = useState<Plan | null>(null);
  const [interval, setIntervalMode]       = useState<'month' | 'year'>('month');
  const [signupStep, setSignupStep]       = useState<'plans' | 'form'>('plans');

  // modal (sign-in / contact only now)
  const [modal, setModal] = useState<Modal>(null);

  // sign-in form
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  // sign-up form
  const [agencyName, setAgencyName]         = useState('');
  const [adminName, setAdminName]           = useState('');
  const [signupEmail, setSignupEmail]       = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm]   = useState('');
  const [timezone, setTimezone]             = useState('America/Chicago');

  // contact form
  const [contactName, setContactName]       = useState('');
  const [contactEmail, setContactEmail]     = useState('');
  const [contactMsg, setContactMsg]         = useState('');
  const [contactSent, setContactSent]       = useState(false);

  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  // fetch plans on mount
  useEffect(() => {
    fetch('/api/billing/plans')
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.plans && setPlans(d.plans))
      .catch(() => {});
  }, []);

  const openOverlay = () => {
    setShowOverlay(true);
    setSignupStep('plans');
    setSelectedPlan(null);
    setError('');
  };

  const closeOverlay = () => {
    setShowOverlay(false);
    setSelectedPlan(null);
    setSignupStep('plans');
    setError('');
  };

  const openModal = (m: Modal) => { setError(''); setModal(m); };
  const closeModal = () => setModal(null);

  // ── Sign in ──────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('evv_token', data.token);
      localStorage.setItem('evv_user', JSON.stringify(data.user));
      navigate(data.user.role === 'caregiver' ? '/mobile' : '/dashboard');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  // ── Sign up → Stripe checkout ────────────────────────────────
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (signupPassword !== signupConfirm) { setError('Passwords do not match'); return; }
    if (signupPassword.length < 8)        { setError('Password must be at least 8 characters'); return; }
    if (!selectedPriceId)                 { setError('Please select a plan first'); return; }

    setLoading(true);
    try {
      // 1. Create account (auto-approved, returns JWT)
      const res  = await fetch('/api/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency_name: agencyName, name: adminName,
          email: signupEmail, password: signupPassword, timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      // 2. Store credentials
      localStorage.setItem('evv_token', data.token);
      localStorage.setItem('evv_user', JSON.stringify(data.user));

      // 3. Create Stripe checkout session
      const checkoutRes  = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
        body: JSON.stringify({ priceId: selectedPriceId }),
      });
      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkoutData.error || 'Checkout failed');

      // 4. Redirect to Stripe
      window.location.href = checkoutData.url;
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  // derive the price ID for the selected plan + interval
  const selectedPriceId = selectedPlan?.prices.find(p => p.recurring?.interval === interval)?.id ?? null;

  const inputCls = 'w-full bg-slate-800/80 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors';
  const labelCls = 'block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide';

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Background video */}
      <div className="absolute inset-0">
        <VideoTemplate showBrand={false} />
      </div>

      {/* Clickable background layer */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={openOverlay}
      />

      {/* Top nav */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-4 pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-[0_0_16px_rgba(37,99,235,0.5)]">E</div>
          <div>
            <p className="font-bold text-white text-sm leading-none">Visiting Systems</p>
            <p className="text-slate-400 text-[11px]">Trusted EVV partner for homecare agencies.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button onClick={openOverlay} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">
            Get Started
          </button>
          <button onClick={() => { setEmail(''); setPassword(''); openModal('signin'); }} className="px-4 py-2 rounded-lg text-sm font-medium border bg-white/10 hover:bg-white/20 text-white border-white/20 transition-colors">
            Sign in
          </button>
          <button onClick={() => { setContactSent(false); openModal('contact'); }} className="px-4 py-2 rounded-lg text-sm font-medium border bg-white/10 hover:bg-white/20 text-white border-white/20 transition-colors">
            Contact Us
          </button>
        </div>
      </div>

      {/* ── PLAN OVERLAY ── */}
      <AnimatePresence>
        {showOverlay && (
          <>
            <motion.div
              key="overlay-backdrop"
              className="absolute inset-0 z-30 bg-slate-950/75 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={closeOverlay}
            />

            <motion.div
              key="overlay-content"
              className="absolute inset-0 z-40 flex items-center justify-center p-4 pointer-events-none"
              initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div
                className="pointer-events-auto w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-slate-900/95 border border-slate-700/60 rounded-2xl shadow-2xl backdrop-blur-md"
                onClick={e => e.stopPropagation()}
              >
                {signupStep === 'plans' ? (
                  <PlanPicker
                    plans={plans}
                    selectedPlan={selectedPlan}
                    interval={interval}
                    onSelectPlan={setSelectedPlan}
                    onIntervalChange={setIntervalMode}
                    onSignUpNow={() => { setError(''); setSignupStep('form'); }}
                    onSignIn={() => { closeOverlay(); setEmail(''); setPassword(''); openModal('signin'); }}
                    onClose={closeOverlay}
                  />
                ) : (
                  <SignUpForm
                    selectedPlan={selectedPlan}
                    selectedPriceId={selectedPriceId}
                    interval={interval}
                    agencyName={agencyName} setAgencyName={setAgencyName}
                    adminName={adminName} setAdminName={setAdminName}
                    signupEmail={signupEmail} setSignupEmail={setSignupEmail}
                    signupPassword={signupPassword} setSignupPassword={setSignupPassword}
                    signupConfirm={signupConfirm} setSignupConfirm={setSignupConfirm}
                    timezone={timezone} setTimezone={setTimezone}
                    error={error} loading={loading}
                    onSubmit={handleSignUp}
                    onBack={() => { setSignupStep('plans'); setError(''); }}
                    inputCls={inputCls} labelCls={labelCls}
                  />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── MODAL (sign-in / contact) ── */}
      <AnimatePresence>
        {modal && (
          <motion.div key="modal-backdrop" className="absolute inset-0 z-50 bg-slate-950/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={closeModal}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {modal && (
          <motion.div key={modal} className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="relative pointer-events-auto w-full max-w-sm mx-4 bg-slate-900/95 border border-slate-700/60 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <button onClick={closeModal}
                className="absolute top-4 right-4 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm">
                ✕
              </button>

              {/* Sign in */}
              {modal === 'signin' && (
                <div className="p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm">E</div>
                    <div>
                      <p className="font-bold text-white text-sm leading-none">Visiting Systems</p>
                      <p className="text-slate-400 text-xs">Sign in to your account</p>
                    </div>
                  </div>
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label className={labelCls}>Email</label>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Password</label>
                      <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={inputCls} />
                    </div>
                    {error && <motion.p className="text-red-400 text-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{error}</motion.p>}
                    <button type="submit" disabled={loading}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm">
                      {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>
                  <div className="mt-5 pt-4 border-t border-slate-700/50">
                    <p className="text-slate-500 text-xs text-center mb-3">New home care agency?</p>
                    <button onClick={() => { closeModal(); openOverlay(); }}
                      className="w-full bg-slate-700/60 hover:bg-slate-700 border border-slate-600/50 text-white text-sm font-medium py-2 rounded-lg transition-colors">
                      See plans & sign up
                    </button>
                  </div>
                  <p className="text-slate-600 text-xs mt-4">Demo: admin@sunrise.com / admin123</p>
                </div>
              )}

              {/* Contact */}
              {modal === 'contact' && (
                <div className="p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm">E</div>
                    <div>
                      <p className="font-bold text-white text-sm leading-none">Visiting Systems</p>
                      <p className="text-slate-400 text-xs">Get in touch with our team</p>
                    </div>
                  </div>
                  {contactSent ? (
                    <div className="flex flex-col items-center text-center gap-4 py-6">
                      <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-2xl">✓</div>
                      <div>
                        <h3 className="text-white font-bold text-lg mb-1">Message sent!</h3>
                        <p className="text-slate-400 text-sm">We'll get back to you within one business day.</p>
                      </div>
                      <button onClick={closeModal} className="text-blue-400 hover:text-blue-300 text-sm transition-colors mt-2">Close</button>
                    </div>
                  ) : (
                    <form onSubmit={e => { e.preventDefault(); setContactSent(true); }} className="space-y-4">
                      <div>
                        <label className={labelCls}>Your Name</label>
                        <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Smith" required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Email</label>
                        <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@yourcompany.com" required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Message</label>
                        <textarea value={contactMsg} onChange={e => setContactMsg(e.target.value)} placeholder="Tell us about your agency…" required rows={4} className={inputCls + ' resize-none'} />
                      </div>
                      <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm">
                        Send Message
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Plan Picker ───────────────────────────────────────────────────────────────

function PlanPicker({
  plans, selectedPlan, interval,
  onSelectPlan, onIntervalChange, onSignUpNow, onSignIn, onClose,
}: {
  plans: Plan[];
  selectedPlan: Plan | null;
  interval: 'month' | 'year';
  onSelectPlan: (p: Plan) => void;
  onIntervalChange: (i: 'month' | 'year') => void;
  onSignUpNow: () => void;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const accentBorder: Record<string, string> = {
    Starter: 'border-slate-600/60',
    Professional: 'border-blue-500/70 ring-2 ring-blue-500/20',
    Agency: 'border-slate-600/60',
  };

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="text-white font-bold text-2xl">Choose your plan</h2>
          <p className="text-slate-400 text-sm mt-1">All plans include a free trial. Cancel anytime.</p>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm shrink-0 mt-1">✕</button>
      </div>

      {/* Billing toggle */}
      <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg p-1 w-fit mb-6">
        <button
          onClick={() => onIntervalChange('month')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${interval === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}
        >Monthly</button>
        <button
          onClick={() => onIntervalChange('year')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${interval === 'year' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}
        >
          Yearly <span className="ml-1 text-emerald-400 text-xs font-semibold">Save ~17%</span>
        </button>
      </div>

      {/* Plan cards */}
      {plans.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading plans…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(plan => {
            const price = plan.prices.find(p => p.recurring?.interval === interval);
            const isSelected = selectedPlan?.id === plan.id;
            const benefits = PLAN_BENEFITS[plan.name] || [];

            return (
              <motion.div
                key={plan.id}
                layout
                onClick={() => onSelectPlan(plan)}
                className={`relative bg-slate-800/50 border rounded-xl p-5 cursor-pointer transition-all hover:bg-slate-800/80 ${
                  isSelected ? accentBorder[plan.name] || 'border-blue-500/70 ring-2 ring-blue-500/20' : 'border-slate-700/50'
                }`}
              >
                {plan.name === 'Professional' && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-semibold px-3 py-0.5 rounded-full">
                    Most popular
                  </span>
                )}

                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-white font-bold text-lg">{plan.name}</h3>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs shrink-0">✓</span>
                  )}
                </div>

                {price ? (
                  <div className="mb-3">
                    <span className="text-3xl font-extrabold text-white">{fmt(price.unit_amount)}</span>
                    <span className="text-slate-400 text-sm">/{interval === 'year' ? 'yr' : 'mo'}</span>
                    {interval === 'year' && (
                      <p className="text-emerald-400 text-xs mt-0.5">
                        ~{fmt(Math.round(price.unit_amount / 12))}/mo
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm mb-3">—</p>
                )}

                {/* Compact: show first 2 features always, all when selected */}
                <ul className="space-y-1.5 text-sm">
                  {benefits.slice(0, isSelected ? benefits.length : 3).map(b => (
                    <li key={b} className={`flex items-start gap-2 ${isSelected ? 'text-slate-200' : 'text-slate-400'}`}>
                      <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                  {!isSelected && benefits.length > 3 && (
                    <li className="text-slate-500 text-xs">+{benefits.length - 3} more features</li>
                  )}
                </ul>

                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mt-4 overflow-hidden"
                    >
                      <button
                        onClick={e => { e.stopPropagation(); onSignUpNow(); }}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                      >
                        Sign Up Now →
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Select any plan CTA if nothing selected */}
      {!selectedPlan && plans.length > 0 && (
        <p className="text-center text-slate-500 text-sm mt-5">← Click any plan to see its benefits</p>
      )}

      {/* Already have an account */}
      <div className="mt-6 pt-4 border-t border-slate-700/40 text-center">
        <p className="text-slate-500 text-sm">
          Already have an account?{' '}
          <button onClick={onSignIn} className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Sign Up Form ──────────────────────────────────────────────────────────────

function SignUpForm({
  selectedPlan, selectedPriceId, interval,
  agencyName, setAgencyName, adminName, setAdminName,
  signupEmail, setSignupEmail, signupPassword, setSignupPassword,
  signupConfirm, setSignupConfirm, timezone, setTimezone,
  error, loading, onSubmit, onBack, inputCls, labelCls,
}: {
  selectedPlan: Plan | null;
  selectedPriceId: string | null;
  interval: 'month' | 'year';
  agencyName: string; setAgencyName: (v: string) => void;
  adminName: string; setAdminName: (v: string) => void;
  signupEmail: string; setSignupEmail: (v: string) => void;
  signupPassword: string; setSignupPassword: (v: string) => void;
  signupConfirm: string; setSignupConfirm: (v: string) => void;
  timezone: string; setTimezone: (v: string) => void;
  error: string; loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  inputCls: string; labelCls: string;
}) {
  const price = selectedPlan?.prices.find(p => p.recurring?.interval === interval);

  return (
    <div className="p-6 md:p-8 max-h-[90vh] overflow-y-auto">
      {/* Back + selected plan summary */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1">
          ← Back
        </button>
        {selectedPlan && price && (
          <div className="ml-auto flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 rounded-lg px-3 py-1.5">
            <span className="text-blue-300 font-semibold text-sm">{selectedPlan.name}</span>
            <span className="text-slate-400 text-xs">·</span>
            <span className="text-white text-sm font-bold">{fmt(price.unit_amount)}/{interval === 'year' ? 'yr' : 'mo'}</span>
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm">E</div>
          <span className="font-bold text-white text-sm">Visiting Systems</span>
        </div>
        <h2 className="text-white font-bold text-xl">Create your agency account</h2>
        <p className="text-slate-400 text-sm mt-1">You'll be taken to secure checkout after signing up.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Agency Name</label>
            <input type="text" value={agencyName} onChange={e => setAgencyName(e.target.value)}
              placeholder="Sunrise Home Care LLC" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Your Name</label>
            <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
              placeholder="Jane Smith" required className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
            placeholder="jane@yourcompany.com" required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Timezone</label>
          <select value={timezone} onChange={e => setTimezone(e.target.value)} required
            className={inputCls + ' bg-slate-800'}>
            {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Password</label>
            <input type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)}
              placeholder="Min 8 characters" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Confirm Password</label>
            <input type="password" value={signupConfirm} onChange={e => setSignupConfirm(e.target.value)}
              placeholder="Repeat password" required className={inputCls} />
          </div>
        </div>

        {error && (
          <motion.p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {error}
          </motion.p>
        )}

        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors text-sm mt-2 flex items-center justify-center gap-2">
          {loading ? 'Creating account…' : (
            <>
              <span>Continue to Payment</span>
              <span className="text-blue-300">→</span>
            </>
          )}
        </button>
      </form>

      <p className="text-slate-600 text-xs mt-4 text-center leading-relaxed">
        By signing up you agree to our terms of service. Payments are processed securely by Stripe.
      </p>
    </div>
  );
}
