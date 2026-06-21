import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SignaturePad } from './components/SignaturePad';

type User = { id: number; name: string; role: string };
type Visit = {
  id: number;
  client_id: number;
  client_name: string;
  client_address: string;
  caregiver_name: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  notes: string | null;
};

type ActionState = 'idle' | 'notes' | 'signature' | 'adding_note' | 'locating' | 'recording' | 'success' | 'error';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(start: string, end: string) {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getLocation(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 8000, maximumAge: 30000 }
    );
  });
}

// ---------- Checkmark animation ----------
function SuccessCheck() {
  return (
    <motion.svg
      width="64" height="64" viewBox="0 0 64 64" fill="none"
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <motion.circle
        cx="32" cy="32" r="30" stroke="#22c55e" strokeWidth="3" fill="#f0fdf4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      <motion.path
        d="M18 32 L28 42 L46 22"
        stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
        fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.2, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

// ---------- Single visit card ----------
function VisitCard({ visit, token, onDone }: { visit: Visit; token: string; onDone: () => void }) {
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [noteText, setNoteText] = useState('');

  const canCheckIn = visit.status === 'scheduled';
  const canCheckOut = visit.status === 'in_progress';
  const isDone = visit.status === 'completed' || visit.status === 'missed';

  const doCheckout = useCallback(async (notes: string, signatureData: string | null, signatureReasonCode: string | null) => {
    setActionState('locating');
    setErrorMsg('');
    const loc = await getLocation();
    setActionState('recording');
    try {
      const res = await fetch(`/api/visits/${visit.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...loc, notes, signature_data: signatureData, signature_reason_code: signatureReasonCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg('Checked out!');
      setActionState('success');
      setTimeout(() => { setActionState('idle'); onDone(); }, 2200);
    } catch (err: any) {
      setErrorMsg(err.message);
      setActionState('error');
    }
  }, [visit.id, token, onDone]);

  const saveNote = useCallback(async (note: string) => {
    setActionState('recording');
    try {
      const res = await fetch(`/api/visits/${visit.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ notes: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg('Note saved!');
      setActionState('success');
      setTimeout(() => { setActionState('idle'); onDone(); }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message);
      setActionState('error');
    }
  }, [visit.id, token, onDone]);

  const handleAction = useCallback(async (type: 'checkin' | 'checkout') => {
    if (type === 'checkout') {
      setNoteText('');
      setActionState('notes');
      return;
    }

    setActionState('locating');
    setErrorMsg('');
    const loc = await getLocation();
    setActionState('recording');
    try {
      const res = await fetch(`/api/visits/${visit.id}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(loc),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg('Checked in!');
      setActionState('success');
      setTimeout(() => { setActionState('idle'); onDone(); }, 2200);
    } catch (err: any) {
      setErrorMsg(err.message);
      setActionState('error');
    }
  }, [visit.id, token, onDone, doCheckout]);

  const statusColors: Record<string, string> = {
    scheduled: 'bg-blue-50 text-blue-700',
    in_progress: 'bg-amber-50 text-amber-700',
    completed: 'bg-emerald-50 text-emerald-700',
    missed: 'bg-red-50 text-red-700',
  };

  return (
    <motion.div
      layout
      className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
    >
      {/* Card header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-xl font-bold text-slate-900 leading-tight">{visit.client_name}</h2>
          <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[visit.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {visit.status.replace('_', ' ')}
          </span>
        </div>

        {visit.client_address && (
          <div className="flex items-center gap-1.5 text-slate-500 text-sm mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span>{visit.client_address}</span>
          </div>
        )}

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-slate-600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span className="font-medium">{formatTime(visit.scheduled_start)} – {formatTime(visit.scheduled_end)}</span>
          </div>
          <span className="text-slate-400">{formatDuration(visit.scheduled_start, visit.scheduled_end)}</span>
        </div>

        {/* Actual times if checked in/out */}
        {(visit.check_in_time || visit.check_out_time) && (
          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-400 mb-0.5">Checked in</p>
              <p className="font-semibold text-slate-700">{formatTime(visit.check_in_time)}</p>
            </div>
            {visit.check_out_time && (
              <div>
                <p className="text-slate-400 mb-0.5">Checked out</p>
                <p className="font-semibold text-slate-700">{formatTime(visit.check_out_time)}</p>
              </div>
            )}
          </div>
        )}
        {visit.notes && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-400 mb-1">Note</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{visit.notes}</p>
          </div>
        )}
      </div>

      {/* Action area */}
      {(!isDone || (isDone && !visit.notes)) && (
        <div className="px-4 pb-4">
          <AnimatePresence mode="wait">
            {actionState === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {canCheckIn && (
                  <button
                    onClick={() => handleAction('checkin')}
                    className="w-full bg-[#1f4e79] active:bg-[#163a5a] text-white text-lg font-bold py-4 rounded-xl transition-colors shadow-sm"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    Check In
                  </button>
                )}
                {canCheckOut && (
                  <button
                    onClick={() => handleAction('checkout')}
                    className="w-full bg-emerald-600 active:bg-emerald-700 text-white text-lg font-bold py-4 rounded-xl transition-colors shadow-sm"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    Check Out
                  </button>
                )}
                {isDone && !visit.notes && (
                  <button
                    onClick={() => { setNoteText(''); setActionState('adding_note'); }}
                    className="w-full border border-slate-200 text-slate-500 text-sm font-medium py-3 rounded-xl transition-colors active:bg-slate-50"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    + Add note
                  </button>
                )}
              </motion.div>
            )}

            {actionState === 'notes' && (
              <motion.div
                key="notes"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                    Visit note <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="e.g. Client seemed tired, medication taken, family present…"
                    rows={3}
                    autoFocus
                    className="w-full text-sm text-slate-800 placeholder-slate-300 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={() => setActionState('signature')}
                  className="w-full bg-emerald-600 active:bg-emerald-700 text-white text-base font-bold py-3.5 rounded-xl transition-colors shadow-sm"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  Continue to Signature
                </button>
                <button
                  onClick={() => setActionState('idle')}
                  className="w-full text-slate-400 text-sm py-1"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  Cancel
                </button>
              </motion.div>
            )}
            {actionState === 'signature' && (
              <motion.div
                key="signature"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              >
                <SignaturePad
                  onComplete={(sigData, reasonCode) => doCheckout(noteText, sigData, reasonCode)}
                  onCancel={() => setActionState('notes')}
                />
              </motion.div>
            )}
            {actionState === 'adding_note' && (
              <motion.div
                key="adding_note"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">Visit note</label>
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="e.g. Client seemed tired, medication taken…"
                    rows={3}
                    autoFocus
                    className="w-full text-sm text-slate-800 placeholder-slate-300 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={() => saveNote(noteText)}
                  disabled={!noteText.trim()}
                  className="w-full bg-[#1f4e79] disabled:opacity-40 text-white text-base font-bold py-3.5 rounded-xl transition-colors shadow-sm"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  Save note
                </button>
                <button
                  onClick={() => setActionState('idle')}
                  className="w-full text-slate-400 text-sm py-1"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  Cancel
                </button>
              </motion.div>
            )}

            {actionState === 'locating' && (
              <motion.div
                key="locating"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2 py-4"
              >
                <div className="flex items-center gap-2 text-blue-600">
                  <span className="relative flex w-3 h-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                  </span>
                  <span className="font-semibold text-sm">Getting your location…</span>
                </div>
                <p className="text-slate-400 text-xs text-center">Please allow location access when prompted</p>
              </motion.div>
            )}

            {actionState === 'recording' && (
              <motion.div
                key="recording"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2 py-5"
              >
                <svg className="animate-spin h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span className="text-slate-500 font-medium text-sm">Recording…</span>
              </motion.div>
            )}

            {actionState === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2 py-3"
              >
                <SuccessCheck />
                <p className="text-emerald-700 font-bold text-base mt-1">{successMsg}</p>
                <p className="text-slate-400 text-xs">Visit updated</p>
              </motion.div>
            )}

            {actionState === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <p className="text-red-600 text-sm text-center font-medium">{errorMsg}</p>
                <button
                  onClick={() => setActionState('idle')}
                  className="w-full border border-slate-200 text-slate-600 text-sm font-medium py-3 rounded-xl transition-colors active:bg-slate-50"
                >
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

// ---------- Main mobile page ----------

export default function MobileCheckin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetClientId = searchParams.get('client');
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState('');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('evv_user');
    const storedToken = localStorage.getItem('evv_token');
    if (!storedUser || !storedToken) {
      sessionStorage.setItem('evv_pending_redirect', window.location.pathname + window.location.search);
      navigate('/');
      return;
    }
    const u = JSON.parse(storedUser);
    if (u.role === 'admin') { navigate('/dashboard'); return; }
    setUser(u);
    setToken(storedToken);
  }, []);

  const loadVisits = useCallback(async (tok: string, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await fetch('/api/visits', {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.status === 401) { navigate('/'); return; }
      const data = await res.json();
      setVisits(data.visits ?? []);
      setLastUpdated(new Date());
    } catch {
      setError('Could not load visits. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (token) loadVisits(token);
  }, [token]);

  const logout = () => {
    localStorage.removeItem('evv_token');
    localStorage.removeItem('evv_user');
    navigate('/');
  };

  const isTargetVisit = (v: Visit) =>
    targetClientId ? String(v.client_id) === targetClientId : false;

  const sortByTarget = (arr: Visit[]) => {
    if (!targetClientId) return arr;
    return [...arr].sort((a, b) => {
      if (isTargetVisit(a) && !isTargetVisit(b)) return -1;
      if (!isTargetVisit(a) && isTargetVisit(b)) return 1;
      return 0;
    });
  };

  const activeVisits = sortByTarget(visits.filter(v => v.status === 'scheduled' || v.status === 'in_progress'));
  const doneVisits = sortByTarget(visits.filter(v => v.status === 'completed' || v.status === 'missed'));
  const targetClientName = targetClientId
    ? (visits.find(v => String(v.client_id) === targetClientId)?.client_name ?? null)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <header className="bg-[#1f4e79] text-white px-4 pt-12 pb-5 sticky top-0 z-10 shadow-md">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">E</div>
            <div>
              <p className="font-bold text-sm leading-none">EVV-lite</p>
              <p className="text-white/60 text-[11px] mt-0.5">Sunrise Home Care</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadVisits(token, true)}
              disabled={refreshing}
              className="p-2 rounded-lg bg-white/10 active:bg-white/20 transition-colors disabled:opacity-40"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              aria-label="Refresh"
            >
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={refreshing ? 'animate-spin' : ''}
              >
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button
              onClick={logout}
              className="text-white/70 text-xs px-3 py-1.5 rounded-lg bg-white/10 active:bg-white/20 transition-colors"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Sign out
            </button>
          </div>
        </div>
        {user && (
          <div>
            <p className="font-semibold text-white text-base mt-3">{user.name}</p>
            <p className="text-white/60 text-xs mt-0.5">
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              {lastUpdated && (
                <> · Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
              )}
            </p>
          </div>
        )}
      </header>

      {/* Body */}
      <main className="flex-1 px-4 py-5 space-y-4 pb-10">
        {/* QR-scan client banner */}
        {targetClientName && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-[#1f4e79]/5 border border-[#1f4e79]/15 rounded-2xl px-4 py-3 flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-lg bg-[#1f4e79]/10 flex items-center justify-center shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1f4e79" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[#1f4e79] font-semibold text-sm leading-none">{targetClientName}</p>
              <p className="text-slate-500 text-xs mt-0.5">Showing this client's visit first</p>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="animate-spin h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p className="text-slate-400 text-sm">Loading visits…</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-5 text-center">
            <p className="text-red-600 font-medium text-sm mb-3">{error}</p>
            <button onClick={() => loadVisits(token)} className="text-red-600 font-semibold text-sm underline">
              Try again
            </button>
          </div>
        ) : visits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-2">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p className="text-slate-600 font-semibold">No visits today</p>
            <p className="text-slate-400 text-sm">You have no visits scheduled for today.</p>
          </div>
        ) : (
          <>
            {/* Active visits */}
            {activeVisits.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">
                  Upcoming / Active
                </p>
                <div className="space-y-3">
                  {activeVisits.map(v => (
                    <VisitCard
                      key={v.id}
                      visit={v}
                      token={token}
                      onDone={() => loadVisits(token, true)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed visits */}
            {doneVisits.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1 mt-2">
                  Completed
                </p>
                <div className="space-y-3">
                  {doneVisits.map(v => (
                    <VisitCard
                      key={v.id}
                      visit={v}
                      token={token}
                      onDone={() => loadVisits(token, true)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All done banner */}
            {activeVisits.length === 0 && doneVisits.length > 0 && (
              <motion.div
                className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex items-center gap-3"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div>
                  <p className="text-emerald-800 font-semibold text-sm">All done for today!</p>
                  <p className="text-emerald-600 text-xs mt-0.5">All visits completed. Great work!</p>
                </div>
              </motion.div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
