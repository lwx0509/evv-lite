import { useState } from 'react';
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

type Mode = 'signin' | 'signup' | 'pending';

export default function EVVLogin() {
  const [mode, setMode] = useState<Mode>('signin');

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

  const switchMode = (next: Mode) => {
    setError('');
    setMode(next);
  };

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
        switchMode('pending');
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
    if (signupPassword !== signupConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (signupPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency_name: agencyName,
          name: adminName,
          email: signupEmail,
          password: signupPassword,
          timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      switchMode('pending');
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
      <div className="absolute inset-0 isolate">
        <VideoTemplate />
      </div>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" />

      <div className="absolute inset-0 flex items-center justify-center overflow-y-auto py-8">
        <motion.div
          className="w-full max-w-sm mx-4"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-8 shadow-2xl shadow-slate-950/60 backdrop-blur-md">
            {/* Brand */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-[0_0_20px_rgba(37,99,235,0.5)]">
                E
              </div>
              <div>
                <p className="font-bold text-white leading-none">EVV-lite</p>
                <p className="text-slate-400 text-xs">Texas Private-Pay Visit Verification</p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {/* ── PENDING ── */}
              {mode === 'pending' && (
                <motion.div
                  key="pending"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="flex flex-col items-center text-center gap-4 py-4">
                    <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-2xl">
                      ⏳
                    </div>
                    <div>
                      <h2 className="text-white font-bold text-lg mb-2">Pending Approval</h2>
                      <p className="text-slate-400 text-sm leading-relaxed">
                        Your agency registration was received. An existing administrator must approve
                        your account before you can log in.
                      </p>
                    </div>
                    <button
                      onClick={() => switchMode('signin')}
                      className="text-blue-400 hover:text-blue-300 text-sm transition-colors mt-2"
                    >
                      ← Back to sign in
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── SIGN IN ── */}
              {mode === 'signin' && (
                <motion.div
                  key="signin"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  <h2 className="text-white text-xl font-bold mb-6">Sign in</h2>
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label className={labelCls}>Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        className={inputCls}
                      />
                    </div>

                    {error && (
                      <motion.p
                        className="text-red-400 text-sm"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        {error}
                      </motion.p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm mt-2"
                    >
                      {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>

                  <div className="mt-6 pt-5 border-t border-slate-700/50">
                    <p className="text-slate-400 text-xs text-center mb-3">
                      New home care agency?
                    </p>
                    <button
                      onClick={() => switchMode('signup')}
                      className="w-full bg-slate-700/60 hover:bg-slate-700 border border-slate-600/50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                    >
                      Create agency account
                    </button>
                  </div>

                  <p className="text-slate-600 text-xs mt-5 leading-relaxed">
                    Demo: admin@sunrise.com / admin123
                  </p>
                </motion.div>
              )}

              {/* ── SIGN UP ── */}
              {mode === 'signup' && (
                <motion.div
                  key="signup"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="flex items-center gap-2 mb-6">
                    <button
                      onClick={() => switchMode('signin')}
                      className="text-slate-400 hover:text-white transition-colors text-lg leading-none"
                      aria-label="Back"
                    >
                      ←
                    </button>
                    <h2 className="text-white text-xl font-bold">Create Agency</h2>
                  </div>

                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div>
                      <label className={labelCls}>Agency Name</label>
                      <input
                        type="text"
                        value={agencyName}
                        onChange={e => setAgencyName(e.target.value)}
                        placeholder="Sunrise Home Care LLC"
                        required
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Your Name</label>
                      <input
                        type="text"
                        value={adminName}
                        onChange={e => setAdminName(e.target.value)}
                        placeholder="Jane Smith"
                        required
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Email</label>
                      <input
                        type="email"
                        value={signupEmail}
                        onChange={e => setSignupEmail(e.target.value)}
                        placeholder="jane@yourcompany.com"
                        required
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Timezone</label>
                      <select
                        value={timezone}
                        onChange={e => setTimezone(e.target.value)}
                        required
                        className={inputCls + ' bg-slate-800'}
                      >
                        {TIMEZONES.map(tz => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Password</label>
                      <input
                        type="password"
                        value={signupPassword}
                        onChange={e => setSignupPassword(e.target.value)}
                        placeholder="Min 8 characters"
                        required
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Confirm Password</label>
                      <input
                        type="password"
                        value={signupConfirm}
                        onChange={e => setSignupConfirm(e.target.value)}
                        placeholder="Repeat password"
                        required
                        className={inputCls}
                      />
                    </div>

                    {error && (
                      <motion.p
                        className="text-red-400 text-sm"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        {error}
                      </motion.p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm mt-2"
                    >
                      {loading ? 'Registering…' : 'Register Agency'}
                    </button>
                  </form>

                  <p className="text-slate-500 text-xs mt-5 leading-relaxed text-center">
                    Your account will be active after an administrator approves your registration.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
