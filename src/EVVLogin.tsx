import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import VideoTemplate from './components/video/VideoTemplate';

export default function EVVLogin() {
  const [email, setEmail] = useState('admin@sunrise.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
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
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('evv_token', data.token);
      localStorage.setItem('evv_user', JSON.stringify(data.user));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Video playing full-screen behind */}
      <div className="absolute inset-0">
        <VideoTemplate />
      </div>

      {/* Dark overlay to make the form readable */}
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" />

      {/* Login card */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="w-full max-w-sm mx-4"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          {/* Card */}
          <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-8 shadow-2xl shadow-slate-950/60 backdrop-blur-md">
            {/* Brand */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-[0_0_20px_rgba(37,99,235,0.5)]">
                E
              </div>
              <div>
                <p className="font-bold text-white leading-none">EVV-lite</p>
                <p className="text-slate-400 text-xs">Sunrise Home Care</p>
              </div>
            </div>

            <h2 className="text-white text-xl font-bold mb-6">Sign in</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full bg-slate-800/80 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full bg-slate-800/80 border border-slate-600/60 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
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

            <p className="text-slate-500 text-xs mt-6 leading-relaxed">
              Demo: admin@sunrise.com / admin123<br />
              or jordan@sunrise.com / caregiver123
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
