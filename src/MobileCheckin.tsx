import { useState, useEffect, useCallback, useMemo } from 'react';
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

function totalScheduledHours(visits: Visit[]) {
  const mins = visits.reduce((acc, v) => {
    const m = (new Date(v.scheduled_end).getTime() - new Date(v.scheduled_start).getTime()) / 60000;
    return acc + (isNaN(m) ? 0 : m);
  }, 0);
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
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

// ── Animated checkmark ─────────────────────────────────────────────────────────
function SuccessCheck() {
  return (
    <motion.svg
      width="48" height="48" viewBox="0 0 64 64" fill="none"
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
    >
      <motion.circle
        cx="32" cy="32" r="30" stroke="#22c55e" strokeWidth="3" fill="#f0fdf4"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      <motion.path
        d="M18 32 L28 42 L46 22" stroke="#22c55e" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.25, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  scheduled:   { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-400',    label: 'Scheduled' },
  in_progress: { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400',   label: 'In Progress' },
  completed:   { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400', label: 'Completed' },
  missed:      { bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-400',     label: 'Missed' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
      {m.label}
    </span>
  );
}

// ── Location pulse ─────────────────────────────────────────────────────────────
function LocationPulse() {
  return (
    <span className="relative flex w-4 h-4">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60" />
      <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500" />
    </span>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Summary bar ────────────────────────────────────────────────────────────────
function SummaryBar({ visits }: { visits: Visit[] }) {
  const remaining  = visits.filter(v => v.status === 'scheduled').length;
  const active     = visits.filter(v => v.status === 'in_progress').length;
  const completed  = visits.filter(v => v.status === 'completed').length;
  const totalVisits = visits.length;
  const pct         = totalVisits > 0 ? Math.round((completed / totalVisits) * 100) : 0;
  const hoursToday  = totalScheduledHours(visits);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm px-3 py-2.5"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Today</p>
        <span className="text-[11px] font-bold text-slate-600">{hoursToday} scheduled</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2.5">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Stat pills */}
      <div className="grid grid-cols-3">
        <div className="text-center py-1">
          <p className="text-lg font-extrabold text-slate-800 leading-none tabular-nums">{remaining}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Remaining</p>
        </div>
        <div className="text-center py-1 border-x border-slate-100">
          <p className="text-lg font-extrabold text-amber-500 leading-none tabular-nums">{active}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Active</p>
        </div>
        <div className="text-center py-1">
          <p className="text-lg font-extrabold text-emerald-600 leading-none tabular-nums">{completed}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Done</p>
        </div>
      </div>
    </motion.div>
  );
}

// ── Single visit row ───────────────────────────────────────────────────────────
function VisitRow({
  visit, token, onDone, highlight, index,
}: {
  visit: Visit; token: string; onDone: () => void; highlight: boolean; index: number;
}) {
  const [open, setOpen]               = useState(false);
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg]       = useState('');
  const [successMsg, setSuccessMsg]   = useState('');
  const [noteText, setNoteText]       = useState('');

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
      setTimeout(() => { setActionState('idle'); setOpen(false); onDone(); }, 2400);
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
      setTimeout(() => { setActionState('idle'); setOpen(false); onDone(); }, 2400);
    } catch (err: any) { setErrorMsg(err.message); setActionState('error'); }
  }, [visit.id, token, onDone]);

  const openPanel = (type: 'checkin' | 'checkout' | 'note') => {
    setOpen(true);
    setActionState('idle');
    setErrorMsg('');
    handleAction(type);
  };

  const closePanel = () => { setOpen(false); setActionState('idle'); setErrorMsg(''); };

  const panelVariants = {
    hidden: { height: 0, opacity: 0 },
    visible: { height: 'auto', opacity: 1, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } },
    exit:   { height: 0, opacity: 0,   transition: { duration: 0.2,  ease: [0.4, 0, 1, 1] } },
  };

  const fadeUp = {
    hidden:  { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
    exit:    { opacity: 0, y: -4, transition: { duration: 0.15 } },
  };

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: index * 0.05, ease: 'easeOut' }}
        className={`border-b border-slate-100 transition-colors duration-150 ${
          open        ? 'bg-slate-50' :
          highlight   ? 'bg-blue-50/70' :
          canCheckOut ? 'bg-amber-50/30' :
          'bg-white hover:bg-slate-50/70'
        }`}
      >
        {/* Client + detail */}
        <td className="px-3 py-3">
          <div className="flex items-start gap-2">
            {/* Status dot */}
            <div className={`mt-[5px] w-2 h-2 rounded-full shrink-0 ${
              canCheckOut ? 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]' :
              canCheckIn  ? 'bg-blue-400' :
              visit.status === 'completed' ? 'bg-emerald-400' : 'bg-red-400'
            }`} />
            <div className="min-w-0">
              <p className="font-bold text-slate-800 text-sm leading-snug truncate">{visit.client_name}</p>
              {visit.client_address && (
                <p className="text-slate-400 text-[11px] truncate mt-0.5">{visit.client_address}</p>
              )}
              {visit.check_in_time && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">
                    IN {formatTime(visit.check_in_time)}
                  </span>
                  {visit.check_out_time && (
                    <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded">
                      OUT {formatTime(visit.check_out_time)}
                    </span>
                  )}
                </div>
              )}
              {visit.notes && (
                <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">"{visit.notes}"</p>
              )}
            </div>
          </div>
        </td>

        {/* Scheduled time + duration */}
        <td className="px-2 py-3 whitespace-nowrap align-top">
          <p className="text-slate-800 text-xs font-bold tabular-nums">{formatTime(visit.scheduled_start)}</p>
          <p className="text-slate-400 text-[11px] mt-0.5 tabular-nums">–{formatTime(visit.scheduled_end)}</p>
          <p className="text-slate-400 text-[10px] mt-0.5 font-medium">{formatDuration(visit.scheduled_start, visit.scheduled_end)}</p>
        </td>

        {/* Action button */}
        <td className="px-2 py-3 text-right align-top whitespace-nowrap">
          {canCheckIn && (
            <button
              onClick={() => openPanel('checkin')}
              className="inline-flex items-center justify-center text-xs font-bold px-3 py-2.5 rounded-xl bg-[#1f4e79] text-white active:scale-95 transition-all shadow-sm shadow-[#1f4e79]/25 min-w-[80px]"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Check In
            </button>
          )}
          {canCheckOut && (
            <button
              onClick={() => openPanel('checkout')}
              className="inline-flex items-center justify-center text-xs font-bold px-3 py-2.5 rounded-xl bg-emerald-600 text-white active:scale-95 transition-all shadow-sm shadow-emerald-600/25 min-w-[80px]"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Check Out
            </button>
          )}
          {isDone && !visit.notes && (
            <button
              onClick={() => openPanel('note')}
              className="inline-flex items-center justify-center text-[11px] font-semibold px-3 py-2.5 rounded-xl border border-slate-200 text-slate-500 active:bg-slate-100 active:scale-95 transition-all min-w-[64px]"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              + Note
            </button>
          )}
          {isDone && visit.notes && (
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
          )}
        </td>
      </motion.tr>

      {/* ── Expandable action panel ── */}
      <AnimatePresence>
        {open && (
          <tr key={`panel-${visit.id}`}>
            <td colSpan={3} className="p-0 border-b border-slate-200">
              <motion.div
                variants={panelVariants}
                initial="hidden" animate="visible" exit="exit"
                className="overflow-hidden"
              >
                <div className="bg-gradient-to-b from-slate-50 to-white px-4 pt-3 pb-4">
                  {/* Panel header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        actionState === 'success' ? 'bg-emerald-400' :
                        actionState === 'error'   ? 'bg-red-400' :
                        'bg-blue-400'
                      }`} />
                      <p className="text-xs font-semibold text-slate-500">{visit.client_name}</p>
                    </div>
                    {actionState !== 'locating' && actionState !== 'recording' && actionState !== 'success' && (
                      <button
                        onClick={closePanel}
                        className="text-slate-300 hover:text-slate-500 transition-colors p-1"
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  <AnimatePresence mode="wait">
                    {/* Notes step (checkout) */}
                    {actionState === 'notes' && (
                      <motion.div key="notes" variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="space-y-3">
                        <label className="block text-xs font-semibold text-slate-600">
                          Visit note <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <textarea
                          value={noteText} onChange={e => setNoteText(e.target.value)}
                          placeholder="e.g. Client seemed tired, medication taken, family present…"
                          rows={3} autoFocus
                          className="w-full text-sm text-slate-800 placeholder-slate-300 border border-slate-200 rounded-xl px-3.5 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent bg-white shadow-sm"
                        />
                        <button
                          onClick={() => setActionState('signature')}
                          className="w-full bg-emerald-600 active:bg-emerald-700 active:scale-[0.98] text-white text-base font-bold py-4 rounded-xl transition-all shadow-sm"
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          Continue to Signature →
                        </button>
                      </motion.div>
                    )}

                    {/* Signature */}
                    {actionState === 'signature' && (
                      <motion.div key="signature" variants={fadeUp} initial="hidden" animate="visible" exit="exit">
                        <SignaturePad
                          onConfirm={(sigData, reasonCode) => doCheckout(noteText, sigData, reasonCode)}
                          onCancel={() => setActionState('notes')}
                        />
                      </motion.div>
                    )}

                    {/* Add note (completed visits) */}
                    {actionState === 'adding_note' && (
                      <motion.div key="adding_note" variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="space-y-3">
                        <label className="block text-xs font-semibold text-slate-600">Visit note</label>
                        <textarea
                          value={noteText} onChange={e => setNoteText(e.target.value)}
                          placeholder="e.g. Client seemed tired, medication taken…"
                          rows={3} autoFocus
                          className="w-full text-sm text-slate-800 placeholder-slate-300 border border-slate-200 rounded-xl px-3.5 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white shadow-sm"
                        />
                        <button
                          onClick={() => saveNote(noteText)} disabled={!noteText.trim()}
                          className="w-full bg-[#1f4e79] disabled:opacity-40 active:scale-[0.98] text-white text-base font-bold py-4 rounded-xl transition-all shadow-sm"
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          Save Note
                        </button>
                      </motion.div>
                    )}

                    {/* Locating / recording */}
                    {(actionState === 'locating' || actionState === 'recording') && (
                      <motion.div key="loading" variants={fadeUp} initial="hidden" animate="visible" exit="exit"
                        className="flex flex-col items-center gap-2 py-6"
                      >
                        {actionState === 'locating' ? (
                          <>
                            <LocationPulse />
                            <p className="text-blue-600 font-semibold text-sm">Getting your location…</p>
                            <p className="text-slate-400 text-xs">Please allow location access when prompted</p>
                          </>
                        ) : (
                          <>
                            <Spinner className="h-6 w-6 text-slate-400" />
                            <p className="text-slate-500 font-medium text-sm">Saving visit…</p>
                          </>
                        )}
                      </motion.div>
                    )}

                    {/* Success */}
                    {actionState === 'success' && (
                      <motion.div key="success" variants={fadeUp} initial="hidden" animate="visible" exit="exit"
                        className="flex flex-col items-center gap-2 py-5"
                      >
                        <SuccessCheck />
                        <p className="text-emerald-700 font-bold text-lg mt-1">{successMsg}</p>
                        <p className="text-slate-400 text-xs">Visit record updated</p>
                      </motion.div>
                    )}

                    {/* Error */}
                    {actionState === 'error' && (
                      <motion.div key="error" variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="space-y-3">
                        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-3.5 py-3">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" className="shrink-0 mt-0.5">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                          <p className="text-red-700 text-sm font-medium">{errorMsg}</p>
                        </div>
                        <button
                          onClick={() => setActionState('idle')}
                          className="w-full border border-slate-200 text-slate-700 text-sm font-semibold py-3.5 rounded-xl active:bg-slate-50 active:scale-[0.98] transition-all"
                        >
                          Try Again
                        </button>
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
  label, visits, token, targetClientId, onDone, startIndex = 0,
}: {
  label: string; visits: Visit[]; token: string;
  targetClientId: string | null; onDone: () => void; startIndex?: number;
}) {
  if (visits.length === 0) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">{label}</p>
      <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm bg-white">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-100">
              <th className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Client</th>
              <th className="px-2 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Time</th>
              <th className="px-2 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v, i) => (
              <VisitRow
                key={v.id}
                visit={v}
                token={token}
                onDone={onDone}
                highlight={!!targetClientId && String(v.client_id) === targetClientId}
                index={startIndex + i}
              />
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MobileCheckin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetClientId = searchParams.get('client');

  const [user, setUser]               = useState<User | null>(null);
  const [token, setToken]             = useState('');
  const [visits, setVisits]           = useState<Visit[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError]             = useState('');

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

  const activeVisits = useMemo(() => visits
    .filter(v => v.status === 'scheduled' || v.status === 'in_progress')
    .sort((a, b) => {
      const aT = targetClientId && String(a.client_id) === targetClientId ? -1 : 0;
      const bT = targetClientId && String(b.client_id) === targetClientId ? -1 : 0;
      return aT - bT || new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    }), [visits, targetClientId]);

  const doneVisits = useMemo(() => visits
    .filter(v => v.status === 'completed' || v.status === 'missed')
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()),
    [visits]);

  const targetClientName = targetClientId
    ? (visits.find(v => String(v.client_id) === targetClientId)?.client_name ?? null)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
      {/* ── Header ── */}
      <header className="bg-[#1f4e79] text-white px-4 pb-4 sticky top-0 z-10" style={{ paddingTop: 'max(env(safe-area-inset-top), 28px)' }}>
        <div
          className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }}
        />
        <div className="relative flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center font-extrabold text-sm border border-white/20">
              VS
            </div>
            <div>
              <p className="font-bold text-sm leading-none tracking-tight">Visiting Systems</p>
              <p className="text-white/50 text-[11px] mt-0.5">Sunrise Home Care</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => loadVisits(token, true)} disabled={refreshing}
              className="p-2.5 rounded-xl bg-white/10 active:bg-white/25 transition-all disabled:opacity-40 border border-white/10"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              aria-label="Refresh"
            >
              {refreshing
                ? <Spinner className="h-4 w-4 text-white" />
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
              }
            </button>
            <button
              onClick={logout}
              className="text-white/70 text-xs px-3 py-2.5 rounded-xl bg-white/10 active:bg-white/25 transition-all border border-white/10"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              Sign out
            </button>
          </div>
        </div>

        {user && (
          <div className="relative mt-2.5">
            <p className="font-bold text-white text-base leading-none">{user.name}</p>
            <p className="text-white/50 text-xs mt-0.5">
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              {lastUpdated && (
                <> · <span className="text-white/70">Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></>
              )}
            </p>
          </div>
        )}
      </header>

      {/* ── Body ── */}
      <main className="flex-1 px-3 py-4 space-y-3 pb-10">

        {/* QR-scan banner */}
        <AnimatePresence>
          {targetClientName && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="bg-[#1f4e79]/6 border border-[#1f4e79]/15 rounded-2xl px-4 py-3 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-xl bg-[#1f4e79]/10 flex items-center justify-center shrink-0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1f4e79" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-[#1f4e79] font-bold text-sm leading-none">{targetClientName}</p>
                <p className="text-slate-500 text-xs mt-0.5">Highlighted below</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Spinner className="h-8 w-8 text-slate-300" />
            <p className="text-slate-400 text-sm">Loading visits…</p>
          </div>

        /* Error */
        ) : error ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="bg-red-50 border border-red-100 rounded-2xl p-5 text-center"
          >
            <p className="text-red-600 font-medium text-sm mb-3">{error}</p>
            <button onClick={() => loadVisits(token)} className="text-red-600 font-bold text-sm underline underline-offset-2">
              Try again
            </button>
          </motion.div>

        /* Empty */
        ) : visits.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-24 gap-3 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-1">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p className="text-slate-700 font-bold text-base">No visits today</p>
            <p className="text-slate-400 text-sm">You have no visits scheduled for today.</p>
          </motion.div>

        ) : (
          <>
            {/* Summary bar */}
            <SummaryBar visits={visits} />

            {/* Active / upcoming */}
            <VisitsTable
              label="Upcoming & Active"
              visits={activeVisits}
              token={token}
              targetClientId={targetClientId}
              onDone={() => loadVisits(token, true)}
              startIndex={0}
            />

            {/* Completed */}
            <VisitsTable
              label="Completed"
              visits={doneVisits}
              token={token}
              targetClientId={targetClientId}
              onDone={() => loadVisits(token, true)}
              startIndex={activeVisits.length}
            />

            {/* All-done banner */}
            <AnimatePresence>
              {activeVisits.length === 0 && doneVisits.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex items-center gap-3.5"
                >
                  <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-emerald-800 font-bold text-sm">All done for today!</p>
                    <p className="text-emerald-600 text-xs mt-0.5">All visits completed. Great work!</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </main>
    </div>
  );
}
