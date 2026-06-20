import { useState, useRef, useEffect } from 'react';
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
  { value: 'America/Adak',        label: 'Hawaii-Aleutian (HAT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii (HST)' },
];

type Panel = null | 'signin' | 'signup' | 'pending';

export default function EVVLogin() {
  const [panel, setPanel] = useState<Panel>(null);

  // Sign-in state
  const [email, setEmail] = useState('admin@sunrise.com');
  const [password, setPassword] = useState('admin123');

  // Sign-up state
  const [agencyName, setAgencyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  const openPanel = (next: Panel) => {
    setError('');
    setPanel(prev => (prev === next ? null : next));
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanel(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.status === 403 && data.error === 'pending_approval') {
        setPanel('pending');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('evv_token', data.token);
      localStorage.setItem('evv_user', JSON.stringify(data.user));
      const pending = sessionStorage.getItem('evv_pending_redirect');
      sessionStorage.removeItem('evv_pending_redirect');
      navigate(pending || (data.user.role === 'caregiver' ? '/mobile' : '/dashboard'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (signupPassword !== signupConfirm) { setError('Passwords do not match'); return; }
    if (signupPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency_name: agencyName, name: adminName,
          email: signupEmail, password: signupPassword, timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setPanel('pending');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full bg-slate-800/80 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors';
  const labelCls = 'block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide';

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Full-screen video */}
      <div className="absolute inset-0 isolate">
        <VideoTemplate />
      </div>
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" />

      {/* ── Top navigation bar ── */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-[0_0_16px_rgba(37,99,235,0.5)]">
            E
          </div>
          <div>
            <p className="font-bold text-white text-sm leading-none">EVV-lite</p>
            <p className="text-slate-400 text-[11px]">Texas Private-Pay Visit Verification</p>
          </div>
        </div>

        {/* Nav buttons + dropdown anchor */}
        <div className="relative flex items-center gap-2" ref={panelRef}>
          <button
            onClick={() => openPanel('signup')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              panel === 'signup'
                ? 'bg-white text-slate-900 border-white'
                : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
            }`}
          >
            Create Agency
          </button>
          <button
            onClick={() => openPanel('signin')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              panel === 'signin'
                ? 'bg-blue-500 text-white shadow-lg'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            Sign in
          </button>

          {/* ── Drop-down panel ── */}
          <AnimatePresence>
            {panel && (
              <motion.div
                key={panel}
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-full mt-3 w-80 bg-slate-900/95 border border-slate-700/60 rounded-2xl shadow-2xl shadow-slate-950/70 backdrop-blur-md overflow-hidden"
              >
                {/* ── PENDING ── */}
                {panel === 'pending' && (
                  <div className="p-6 flex flex-col items-center text-center gap-4">
                    <div className="w-11 h-11 rounded-full bg-amber-500/20 flex items-center justify-center text-xl">⏳</div>
                    <div>
                      <h3 className="text-white font-bold mb-1.5">Pending Approval</h3>
                      <p className="text-slate-400 text-sm leading-relaxed">
                        Your registration was received. An existing administrator must approve your
                        account before you can log in.
                      </p>
                    </div>
                    <button
                      onClick={() => setPanel('signin')}
                      className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                    >
                      ← Back to sign in
                    </button>
                  </div>
                )}

                {/* ── SIGN IN ── */}
                {panel === 'signin' && (
                  <div className="p-6">
                    <h3 className="text-white font-bold text-base mb-5">Sign in</h3>
                    <form onSubmit={handleSignIn} className="space-y-4">
                      <div>
                        <label className={labelCls}>Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={inputCls} />
                      </div>
                      {error && (
                        <motion.p className="text-red-400 text-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          {error}
                        </motion.p>
                      )}
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                      >
                        {loading ? 'Signing in…' : 'Sign in'}
                      </button>
                    </form>
                    <p className="text-slate-600 text-xs mt-4">Demo: admin@sunrise.com / admin123</p>
                  </div>
                )}

                {/* ── SIGN UP ── */}
                {panel === 'signup' && (
                  <div className="p-6 max-h-[80vh] overflow-y-auto">
                    <h3 className="text-white font-bold text-base mb-5">Create Agency</h3>
                    <form onSubmit={handleSignUp} className="space-y-3">
                      <div>
                        <label className={labelCls}>Agency Name</label>
                        <input type="text" value={agencyName} onChange={e => setAgencyName(e.target.value)} placeholder="Sunrise Home Care LLC" required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Your Name</label>
                        <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Jane Smith" required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Email</label>
                        <input type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="jane@yourcompany.com" required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Timezone</label>
                        <select value={timezone} onChange={e => setTimezone(e.target.value)} required className={inputCls + ' bg-slate-800'}>
                          {TIMEZONES.map(tz => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Password</label>
                        <input type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="Min 8 characters" required className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Confirm Password</label>
                        <input type="password" value={signupConfirm} onChange={e => setSignupConfirm(e.target.value)} placeholder="Repeat password" required className={inputCls} />
                      </div>
                      {error && (
                        <motion.p className="text-red-400 text-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          {error}
                        </motion.p>
                      )}
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
                      >
                        {loading ? 'Registering…' : 'Register Agency'}
                      </button>
                    </form>
                    <p className="text-slate-500 text-xs mt-4 text-center leading-relaxed">
                      Your account will be active after an administrator approves it.
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
