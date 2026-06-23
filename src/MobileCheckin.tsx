import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SignaturePad } from './components/SignaturePad';

type User  = { id: number; name: string; role: string };
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

function SuccessCheck() {
  return (
    <motion.svg
      width="40" height="40" viewBox="0 0 64 64" fill="none"
      initial={{ scale: 0 }} animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <motion.circle
        cx="32" cy="32" r="30" stroke="#22c55e" strokeWidth="3" fill="#f0fdf4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.4 }}
      />
      <motion.path
        d="M18 32 L28 42 L46 22" stroke="#22c55e" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.2 }}
      />
    </motion.svg>
  );
}

const STATUS_STYLES: Record<string, string> = {
  scheduled:   'bg-blue-50   text-blue-700',
  in_progress: 'bg-amber-50  text-amber-700',
  completed:   'bg-emerald-50 text-emerald-700',
  missed:      'bg-red-50    text-red-700',
};

// ── Single visit row + optional expanded action panel ──────────────────────────
function VisitRow({
  visit, token, onDone, highlight,
}: {
  visit: Visit; token: string; onDone: () => void; highlight: boolean;
}) {
  const [open, setOpen]             = useState(false);
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg]     = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [noteText, setNoteText]     = useState('');

  const canCheckIn  = visit.status === 'scheduled';
  const canCheckOut = visit.status === 'in_progress';
  const isDone      = visit.status === 'completed' || visit.status === 'missed';

  const doCheckout = useCallback(async (notes: string, sigData: string | null, sigCode: string | null) => {
    setActionState('locating');
    const loc = await getLocation();
    setActionState('recording');
    try {
      const res = await fetch(`/api/visits/${visit.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...loc, notes, signature_data: sigData, signature_reason_code: sigCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg('Checked out!');
      setActionState('success');
      setTimeout(() => { setActionState('idle'); setOpen(false); onDone(); }, 2200);
    } catch (err: any) { setErrorMsg(err.message); setActionState('error'); }
  }, [visit.id, token, onDone]);

  const saveNote = useCallback(async (note: string) => {
    setActionState('recording');
    try {
      const res = await fetch(`/api/visits/${visit.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notes: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg('Note saved!');
      setActionState('success');
      setTimeout(() => { setActionState('idle'); setOpen(false); onDone(); }, 2000);
    } catch (err: any) { setErrorMsg(err.message); setActionState('error'); }
  }, [visit.id, token, onDone]);

  const handleAction = useCallback(async (type: 'checkin' | 'checkout' | 'note') => {
    if (type === 'checkout') { setNoteText(''); setActionState('notes'); return; }
    if (type === 'note')     { setNoteText(''); setActionState('adding_note'); return; }
    setActionState('locating');
    setErrorMsg('');
    const loc = await getLocation();
    setActionState('recording');
    try {
      const res = await fetch(`/api/visits/${visit.id}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(loc),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg('Checked in!');
      setActionState('success');
      setTimeout(() => { setActionState('idle'); setOpen(false); onDone(); }, 2200);
    } catch (err: any) { setErrorMsg(err.message); setActionState('error'); }
  }, [visit.id, token, onDone]);

  const openPanel = (type: 'checkin' | 'checkout' | 'note') => {
    setOpen(true);
    setActionState('idle');
    setErrorMsg('');
    handleAction(type);
  };

  const closePanel = () => {
    setOpen(false);
    setActionState('idle');
    setErrorMsg('');
  };

  return (
    <>
      {/* ── Data row ── */}
      <tr
        className={`border-b border-slate-100 transition-colors ${
          highlight ? 'bg-blue-50/60' : 'bg-white hover:bg-slate-50/60'
        }`}
      >
        {/* Client */}
        <td className="px-3 py-3 max-w-[140px]">
          <p className="font-semibold text-slate-800 text-sm leading-snug truncate">{visit.client_name}</p>
          {visit.client_address && (
            <p className="text-slate-400 text-[11px] truncate mt-0.5">{visit.client_address}</p>
          )}
          {visit.check_in_time && (
            <p className="text-emerald-600 text-[11px] mt-0.5">
              In {formatTime(visit.check_in_time)}
              {visit.check_out_time && <> · Out {formatTime(visit.check_out_time)}</>}
            </p>
          )}
        </td>

        {/* Time */}
        <td className="px-3 py-3 whitespace-nowrap">
          <p className="text-slate-700 text-sm font-medium">
            {formatTime(visit.scheduled_start)}
          </p>
          <p className="text-slate-400 text-[11px]">
            {formatTime(visit.scheduled_end)} · {formatDuration(visit.scheduled_start, visit.scheduled_end)}
          </p>
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[visit.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {visit.status.replace('_', ' ')}
          </span>
          {visit.notes && (
            <p className="text-slate-400 text-[10px] mt-1 italic truncate max-w-[80px]">has note</p>
          )}
        </td>

        {/* Action */}
        <td className="px-3 py-3 text-right whitespace-nowrap">
          {canCheckIn && (
            <button
              onClick={() => openPanel('checkin')}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#1f4e79] text-white active:bg-[#163a5a] transition-colors shadow-sm"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Check In
            </button>
          )}
          {canCheckOut && (
            <button
              onClick={() => openPanel('checkout')}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white active:bg-emerald-700 transition-colors shadow-sm"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Check Out
            </button>
          )}
          {isDone && !visit.notes && (
            <button
              onClick={() => openPanel('note')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 active:bg-slate-50 transition-colors"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              + Note
            </button>
          )}
          {isDone && visit.notes && (
            <span className="text-emerald-500 text-sm">✓</span>
          )}
        </td>
      </tr>

      {/* ── Expanded action panel row ── */}
      <AnimatePresence>
        {open && (
          <tr key={`panel-${visit.id}`}>
            <td colSpan={4} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden bg-slate-50 border-b border-slate-200"
              >
                <div className="px-4 py-4">
                  <AnimatePresence mode="wait">
                    {actionState === 'notes' && (
                      <motion.div key="notes" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                        <label className="block text-xs font-semibold text-slate-500">
                          Visit note <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <textarea
                          value={noteText} onChange={e => setNoteText(e.target.value)}
                          placeholder="e.g. Client seemed tired, medication taken…"
                          rows={3} autoFocus
                          className="w-full text-sm text-slate-800 placeholder-slate-300 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent bg-white"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setActionState('signature')}
                            className="flex-1 bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold py-3 rounded-xl transition-colors"
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                          >
                            Continue to Signature
                          </button>
                          <button onClick={closePanel} className="px-4 text-slate-400 text-sm" style={{ WebkitTapHighlightColor: 'transparent' }}>
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {actionState === 'signature' && (
                      <motion.div key="signature" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <SignaturePad
                          onConfirm={(sigData, reasonCode) => doCheckout(noteText, sigData, reasonCode)}
                          onCancel={() => setActionState('notes')}
                        />
                      </motion.div>
                    )}

                    {actionState === 'adding_note' && (
                      <motion.div key="adding_note" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                        <label className="block text-xs font-semibold text-slate-500">Visit note</label>
                        <textarea
                          value={noteText} onChange={e => setNoteText(e.target.value)}
                          placeholder="e.g. Client seemed tired, medication taken…"
                          rows={3} autoFocus
                          className="w-full text-sm text-slate-800 placeholder-slate-300 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveNote(noteText)} disabled={!noteText.trim()}
                            className="flex-1 bg-[#1f4e79] disabled:opacity-40 text-white text-sm font-bold py-3 rounded-xl transition-colors"
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                          >
                            Save note
                          </button>
                          <button onClick={closePanel} className="px-4 text-slate-400 text-sm" style={{ WebkitTapHighlightColor: 'transparent' }}>
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {(actionState === 'locating' || actionState === 'recording') && (
                      <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex items-center justify-center gap-3 py-4"
                      >
                        {actionState === 'locating' ? (
                          <>
                            <span className="relative flex w-3 h-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                            </span>
                            <span className="text-blue-600 font-semibold text-sm">Getting location…</span>
                          </>
                        ) : (
                          <>
                            <svg className="animate-spin h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                            <span className="text-slate-500 font-medium text-sm">Recording…</span>
                          </>
                        )}
                      </motion.div>
                    )}

                    {actionState === 'success' && (
                      <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-3 py-3"
                      >
                        <SuccessCheck />
                        <div>
                          <p className="text-emerald-700 font-bold text-base">{successMsg}</p>
                          <p className="text-slate-400 text-xs">Visit updated</p>
                        </div>
                      </motion.div>
                    )}

                    {actionState === 'error' && (
                      <motion.div key="error" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
                        <p className="text-red-600 text-sm font-medium">{errorMsg}</p>
                        <div className="flex gap-2">
                          <button onClick={() => setActionState('idle')} className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium py-2.5 rounded-xl active:bg-slate-50">
                            Try again
                          </button>
                          <button onClick={closePanel} className="px-4 text-slate-400 text-sm">
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Visits table ───────────────────────────────────────────────────────────────
function VisitsTable({
  label, visits, token, targetClientId, onDone,
}: {
  label: string;
  visits: Visit[];
  token: string;
  targetClientId: string | null;
  onDone: () => void;
}) {
  if (visits.length === 0) return null;
  return (
    <section>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">{label}</p>
      <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Time</th>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visits.map(v => (
                <VisitRow
                  key={v.id}
                  visit={v}
                  token={token}
                  onDone={onDone}
                  highlight={!!targetClientId && String(v.client_id) === targetClientId}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ── Main mobile page ───────────────────────────────────────────────────────────
export default function MobileCheckin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetClientId = searchParams.get('client');

  const [user, setUser]           = useState<User | null>(null);
  const [token, setToken]         = useState('');
  const [visits, setVisits]       = useState<Visit[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError]         = useState('');

  useEffect(() => {
    const storedUser  = localStorage.getItem('evv_user');
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
      const res = await fetch('/api/visits', { headers: { Authorization: `Bearer ${tok}` } });
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

  useEffect(() => { if (token) loadVisits(token); }, [token]);

  const logout = () => {
    localStorage.removeItem('evv_token');
    localStorage.removeItem('evv_user');
    navigate('/');
  };

  const activeVisits = visits
    .filter(v => v.status === 'scheduled' || v.status === 'in_progress')
    .sort((a, b) => {
      const aTarget = targetClientId && String(a.client_id) === targetClientId ? -1 : 0;
      const bTarget = targetClientId && String(b.client_id) === targetClientId ? -1 : 0;
      return aTarget - bTarget || new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    });

  const doneVisits = visits
    .filter(v => v.status === 'completed' || v.status === 'missed')
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());

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
              <p className="font-bold text-sm leading-none">Visiting Systems</p>
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
              {lastUpdated && <> · Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
        )}
      </header>

      {/* Body */}
      <main className="flex-1 px-4 py-5 space-y-4 pb-10">
        {/* QR-scan banner */}
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
              <p className="text-slate-500 text-xs mt-0.5">Highlighted in the table below</p>
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
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p className="text-slate-600 font-semibold">No visits today</p>
            <p className="text-slate-400 text-sm">You have no visits scheduled for today.</p>
          </div>
        ) : (
          <>
            <VisitsTable
              label="Upcoming / Active"
              visits={activeVisits}
              token={token}
              targetClientId={targetClientId}
              onDone={() => loadVisits(token, true)}
            />

            <VisitsTable
              label="Completed"
              visits={doneVisits}
              token={token}
              targetClientId={targetClientId}
              onDone={() => loadVisits(token, true)}
            />

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
