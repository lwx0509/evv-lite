import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { InvoicesTab } from './InvoicesTab';
import { BillingTab } from './BillingTab';

const REFRESH_INTERVAL = 30_000;

function isOverdue(v: Visit): false | 'missed_checkin' | 'overdue_checkout' {
  const now = Date.now();
  if (v.status === 'scheduled' && new Date(v.scheduled_start).getTime() < now) return 'missed_checkin';
  if (v.status === 'in_progress' && new Date(v.scheduled_end).getTime() < now) return 'overdue_checkout';
  return false;
}

type User = { id: number; name: string; role: string; agency_id: number; agency_name?: string };
type Visit = {
  id: number; client_id: number; client_name: string; client_address: string;
  caregiver_id: number; caregiver_name: string;
  scheduled_start: string; scheduled_end: string; status: string;
  check_in_time: string | null; check_out_time: string | null; exception_flags: string | null;
  notes: string | null; reassigned_from?: string | null; decline_reason?: string | null;
};
type Client = { id: number; name: string; address: string; payer_type: string; lat: number | null; lng: number | null };
type Caregiver = { id: number; name: string; email: string; employee_id: string | null; timezone?: string };
type Exception = { client_name: string; caregiver_name: string; scheduled_start: string; exception_flags: string; reassigned_from?: string | null; decline_reason?: string | null; status?: string };

type AdminTab = 'schedule' | 'weekview' | 'newvisit' | 'clients' | 'caregivers' | 'payroll' | 'alerts' | 'approvals' | 'invoices' | 'billing' | 'config';
type HistoryClient = { id: number; name: string; address: string };
type HistoryCaregiver = { id: number; name: string; email: string };

function useApi() {
  const navigate = useNavigate();
  const token = localStorage.getItem('evv_token');

  const call = useCallback(async (path: string, opts: RequestInit = {}) => {
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

  return call;
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: 'bg-slate-100 text-slate-600',
    in_progress: 'bg-amber-50 text-amber-700',
    completed: 'bg-emerald-50 text-emerald-700',
    missed: 'bg-red-50 text-red-700',
    declined: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function FlagBadge({ flag }: { flag: string }) {
  return (
    <span className="inline-block bg-red-50 text-red-700 text-[11px] font-medium px-1.5 py-0.5 rounded mr-1">
      {flag.replace(/_/g, ' ')}
    </span>
  );
}

// ---------- Admin tabs ----------

function ScheduleTab({ onOverdueCount, onClientClick, onCaregiverClick }: {
  onOverdueCount: (n: number) => void;
  onClientClick: (c: HistoryClient) => void;
  onCaregiverClick: (c: HistoryCaregiver) => void;
}) {
  const api = useApi();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [filterStatus, setFilterStatus]       = useState('');
  const [filterCaregiver, setFilterCaregiver] = useState('');
  const [filterClient, setFilterClient]       = useState('');
  const [filterExCaregiver, setFilterExCaregiver] = useState('');
  const [filterExClient, setFilterExClient]       = useState('');
  const [filterExType, setFilterExType]           = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const [v, e] = await Promise.all([api('/visits'), api('/exceptions')]);
    if (v) {
      setVisits(v.visits);
      const count = v.visits.filter((vis: Visit) => isOverdue(vis) !== false).length;
      onOverdueCount(count);
    }
    if (e) setExceptions(e.exceptions);
    setLoading(false);
    setRefreshing(false);
    setLastRefreshed(new Date());
    setSecondsSince(0);
  }, [api, onOverdueCount]);

  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!lastRefreshed) return;
    timerRef.current = setInterval(() => {
      setSecondsSince(Math.round((Date.now() - lastRefreshed.getTime()) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lastRefreshed]);

  const overdueVisits = visits.filter(v => isOverdue(v) !== false);

  const caregiverNames = [...new Set(visits.map(v => v.caregiver_name))].sort();
  const clientNames    = [...new Set(visits.map(v => v.client_name))].sort();

  const filteredVisits = visits
    .filter(v =>
      (!filterStatus    || v.status === filterStatus) &&
      (!filterCaregiver || v.caregiver_name === filterCaregiver) &&
      (!filterClient    || v.client_name.toLowerCase().includes(filterClient.toLowerCase()))
    )
    .sort((a, b) => {
      const aComplete = a.status === 'completed' ? 1 : 0;
      const bComplete = b.status === 'completed' ? 1 : 0;
      if (aComplete !== bComplete) return aComplete - bComplete;
      return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    });

  const todayStr = new Date().toISOString().slice(0, 10);
  const declinedNeedingReschedule = visits.filter(
    v => v.status === 'declined' && v.scheduled_start.slice(0, 10) >= todayStr
  );

  const exCaregiverNames = [...new Set(exceptions.map(e => e.caregiver_name))].sort();
  const exClientNames    = [...new Set(exceptions.map(e => e.client_name))].sort();

  const sortedExceptions = [...exceptions]
    .sort((a, b) => {
      if (a.status === 'declined' && b.status !== 'declined') return -1;
      if (a.status !== 'declined' && b.status === 'declined') return 1;
      return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    })
    .filter(e =>
      (!filterExCaregiver || e.caregiver_name === filterExCaregiver) &&
      (!filterExClient    || e.client_name.toLowerCase().includes(filterExClient.toLowerCase())) &&
      (!filterExType      ||
        (filterExType === 'declined' && e.status === 'declined') ||
        (filterExType === 'flagged'  && e.status !== 'declined'))
    );

  if (loading) return <Card><p className="text-slate-400 text-sm">Loading…</p></Card>;

  return (
    <>
      {/* Overdue alert banner */}
      <AnimatePresence>
        {overdueVisits.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
              <p className="text-red-700 text-sm font-medium">
                {overdueVisits.length} visit{overdueVisits.length > 1 ? 's' : ''} need attention —{' '}
                {overdueVisits.map((v, i) => (
                  <span key={v.id}>
                    <strong>{v.client_name}</strong>
                    {' '}({isOverdue(v) === 'missed_checkin' ? 'missed check-in' : 'overdue check-out'})
                    {i < overdueVisits.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Declined shifts banner */}
      <AnimatePresence>
        {declinedNeedingReschedule.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shrink-0 mt-1.5" />
              <div>
                <p className="text-orange-800 text-sm font-medium">
                  {declinedNeedingReschedule.length} shift{declinedNeedingReschedule.length > 1 ? 's' : ''} declined and need{declinedNeedingReschedule.length === 1 ? 's' : ''} reassignment —{' '}
                  {declinedNeedingReschedule.map((v, i) => (
                    <span key={v.id}>
                      <strong>{v.client_name}</strong>
                      {' '}({new Date(v.scheduled_start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })})
                      {i < declinedNeedingReschedule.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
                <p className="text-orange-700 text-xs mt-0.5">Open the <strong>Alerts</strong> tab to reassign these shifts.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card title="Exceptions">
        {/* Exception filter bar */}
        <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b border-slate-100">
          <select
            value={filterExType}
            onChange={ev => setFilterExType(ev.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          >
            <option value="">All types</option>
            <option value="declined">Declined shifts</option>
            <option value="flagged">Flagged visits</option>
          </select>
          <select
            value={filterExCaregiver}
            onChange={ev => setFilterExCaregiver(ev.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          >
            <option value="">All caregivers</option>
            {exCaregiverNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search client…"
            value={filterExClient}
            onChange={ev => setFilterExClient(ev.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20 w-36"
          />
          {(filterExType || filterExCaregiver || filterExClient) && (
            <button
              onClick={() => { setFilterExType(''); setFilterExCaregiver(''); setFilterExClient(''); }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1.5"
            >
              ✕ Clear
            </button>
          )}
          {(filterExType || filterExCaregiver || filterExClient) && (
            <span className="text-xs text-slate-400 self-center">
              {sortedExceptions.length} of {exceptions.length} exceptions
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                {['Date', 'Client', 'Caregiver', 'Flags', 'Audit'].map(h => (
                  <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedExceptions.length === 0 ? (
                <tr><td colSpan={5} className="pt-4 text-slate-400">
                  {exceptions.length === 0 ? 'No exceptions. ✅' : 'No exceptions match the current filters.'}
                </td></tr>
              ) : sortedExceptions.map((e, i) => (
                <tr key={i} className={`border-b border-slate-50 ${e.status === 'declined' ? 'bg-red-50/40' : ''}`}>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <p className="text-slate-700 text-xs font-medium">
                      {new Date(e.scheduled_start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-slate-400 text-[11px]">{formatTime(e.scheduled_start)}</p>
                  </td>
                  <td className="py-2.5 pr-4">{e.client_name}</td>
                  <td className="py-2.5 pr-4">
                    {e.caregiver_name}
                    {e.reassigned_from && (
                      <p className="text-[10px] text-amber-600 font-medium mt-0.5">↩ was: {e.reassigned_from}</p>
                    )}
                  </td>
                  <td className="py-2.5">
                    {e.status === 'declined' ? (
                      <span className="text-[11px] font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded">declined</span>
                    ) : (
                      e.exception_flags?.split(',').filter(Boolean).map(f => <FlagBadge key={f} flag={f} />)
                    )}
                  </td>
                  <td className="py-2.5 pl-2 max-w-[200px]">
                    {e.decline_reason ? (
                      <span className="text-[11px] text-red-700 italic">"{e.decline_reason}"</span>
                    ) : e.reassigned_from ? (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Reassigned</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        {/* Card header with refresh controls */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-800">All Visits</h3>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {lastRefreshed && (
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${refreshing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                {secondsSince < 5 ? 'Just refreshed' : `${secondsSince}s ago`}
              </span>
            )}
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors font-medium"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b border-slate-100">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          >
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="declined">Declined</option>
            <option value="missed">Missed</option>
          </select>
          <select
            value={filterCaregiver}
            onChange={e => setFilterCaregiver(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          >
            <option value="">All caregivers</option>
            {caregiverNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search client…"
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20 w-36"
          />
          {(filterStatus || filterCaregiver || filterClient) && (
            <button
              onClick={() => { setFilterStatus(''); setFilterCaregiver(''); setFilterClient(''); }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1.5"
            >
              ✕ Clear
            </button>
          )}
          {(filterStatus || filterCaregiver || filterClient) && (
            <span className="text-xs text-slate-400 self-center">
              {filteredVisits.length} of {visits.length} visits
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                {['Time', 'Client', 'Caregiver', 'Status', 'Checked In', 'Checked Out', 'Flags', 'Note'].map(h => (
                  <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredVisits.length === 0 ? (
                <tr><td colSpan={7} className="pt-4 text-slate-400">{visits.length === 0 ? 'No visits scheduled.' : 'No visits match the current filters.'}</td></tr>
              ) : filteredVisits.map(v => {
                const overdueType = isOverdue(v);
                const isCompleted = v.status === 'completed';
                return (
                  <tr
                    key={v.id}
                    className={`border-b transition-colors ${
                      overdueType
                        ? 'bg-red-50/60 border-red-100 hover:bg-red-50'
                        : isCompleted
                        ? 'bg-emerald-50/30 border-slate-50 hover:bg-emerald-50/50 opacity-70'
                        : 'border-slate-50 hover:bg-slate-50/50'
                    }`}
                  >
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <span className={overdueType ? 'text-red-700 font-medium' : ''}>
                        {formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <button
                        onClick={() => onClientClick({ id: v.client_id, name: v.client_name, address: v.client_address })}
                        className="text-[#1f4e79] hover:underline font-medium text-left"
                      >{v.client_name}</button>
                    </td>
                    <td className="py-2.5 pr-4">
                      <button
                        onClick={() => onCaregiverClick({ id: v.caregiver_id, name: v.caregiver_name, email: '' })}
                        className="text-slate-700 hover:text-[#1f4e79] hover:underline text-left"
                      >{v.caregiver_name}</button>
                      {v.reassigned_from && (
                        <p className="text-[10px] text-amber-600 font-medium mt-0.5">↩ was: {v.reassigned_from}</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={v.status} />
                        {overdueType && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                            {overdueType === 'missed_checkin' ? 'LATE CHECK-IN' : 'LATE CHECK-OUT'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">{formatTime(v.check_in_time)}</td>
                    <td className="py-2.5 pr-4">{formatTime(v.check_out_time)}</td>
                    <td className="py-2.5 pr-4">{(v.exception_flags || '').split(',').filter(Boolean).map(f => <FlagBadge key={f} flag={f} />)}</td>
                    <td className="py-2.5 max-w-[200px]">
                      {v.notes ? (
                        <span title={v.notes} className="flex items-start gap-1 text-xs text-slate-600">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                          <span className="line-clamp-2 leading-tight">{v.notes}</span>
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-300 mt-3">Auto-refreshes every 30 seconds · Completed visits shown at bottom</p>
      </Card>
    </>
  );
}

const TIME_PRESETS = [
  { label: '8 – 10 am',  start: '08:00', end: '10:00' },
  { label: '9 – 11 am',  start: '09:00', end: '11:00' },
  { label: '10 am – 12', start: '10:00', end: '12:00' },
  { label: '1 – 3 pm',   start: '13:00', end: '15:00' },
  { label: '3 – 5 pm',   start: '15:00', end: '17:00' },
];

const RECURRENCE_OPTIONS = [
  { value: 'none',     label: 'Once' },
  { value: 'daily',    label: 'Daily' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly',  label: 'Monthly' },
];

function calcDuration(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function fmt12(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_OF_MONTH_LABELS = ['1st', '2nd', '3rd', '4th'];

function DayPills({ selected, multi, onChange }: {
  selected: number | number[];
  multi: boolean;
  onChange: (v: number | number[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DAYS_OF_WEEK.map((d, i) => {
        const active = multi
          ? (selected as number[]).includes(i)
          : selected === i;
        return (
          <button
            key={d} type="button"
            onClick={() => {
              if (multi) {
                const arr = selected as number[];
                onChange(active ? arr.filter(x => x !== i) : [...arr, i]);
              } else {
                onChange(i);
              }
            }}
            className={`w-11 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              active
                ? 'bg-[#1f4e79] text-white border-[#1f4e79]'
                : 'bg-white text-slate-600 border-slate-200 hover:border-[#1f4e79] hover:text-[#1f4e79]'
            }`}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

function NewVisitTab({ prefill }: { prefill?: { caregiverId: string; date: string; time?: string } | null }) {
  const api = useApi();
  const [clients, setClients] = useState<Client[]>([]);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [form, setForm] = useState({
    clientId: '', caregiverId: '', date: new Date().toISOString().slice(0, 10),
    start: '09:00', end: '11:00', recurrenceRule: 'none', occurrences: '4',
  });
  // Day-targeting state (0=Mon … 6=Sun)
  const todayDow = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const [dailyDays,   setDailyDays]   = useState<number[]>([0, 1, 2, 3, 4]);
  const [weeklyDays,  setWeeklyDays]  = useState<number[]>([todayDow]);
  const [monthlyDays, setMonthlyDays] = useState<number[]>([todayDow]);
  const [monthlyWeek, setMonthlyWeek] = useState<number>(1);

  const [msg, setMsg]         = useState('');
  const [success, setSuccess] = useState<{ count: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api('/clients'), api('/caregivers')]).then(([c, g]) => {
      if (c) { setClients(c.clients); if (c.clients[0]) setForm(f => ({ ...f, clientId: String(c.clients[0].id) })); }
      if (g) {
        setCaregivers(g.caregivers);
        const firstCg = g.caregivers[0];
        if (firstCg) setForm(f => ({ ...f, caregiverId: String(firstCg.id) }));
      }
    });
  }, []);

  // Apply prefill when provided (e.g. from WeekViewTab time-slot click)
  useEffect(() => {
    if (prefill) {
      setForm(f => ({
        ...f,
        caregiverId: prefill.caregiverId,
        date: prefill.date,
        ...(prefill.time ? { start: prefill.time } : {}),
      }));
    }
  }, [prefill]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.recurrenceRule === 'daily' && dailyDays.length === 0) {
      setMsg('Please select at least one day.'); return;
    }
    setMsg(''); setSuccess(null); setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        client_id: Number(form.clientId), caregiver_id: Number(form.caregiverId),
        scheduled_start: `${form.date}T${form.start}:00`,
        scheduled_end:   `${form.date}T${form.end}:00`,
        recurrence_rule: form.recurrenceRule,
        occurrences: Number(form.occurrences),
      };
      if (form.recurrenceRule === 'daily')                                          payload.days_of_week = dailyDays;
      if (form.recurrenceRule === 'weekly' || form.recurrenceRule === 'biweekly')  payload.days_of_week = weeklyDays;
      if (form.recurrenceRule === 'monthly') { payload.days_of_week = monthlyDays; payload.week_of_month = monthlyWeek; }

      const data = await api('/visits', { method: 'POST', body: JSON.stringify(payload) });
      setSuccess({ count: data?.count ?? 1 });
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  const duration    = calcDuration(form.start, form.end);
  const activePreset = TIME_PRESETS.find(p => p.start === form.start && p.end === form.end);

  return (
    <div className="max-w-xl">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-slate-800">Schedule a Visit</h2>
        <p className="text-slate-500 text-sm mt-0.5">Fill in the details below — takes about 30 seconds.</p>
      </div>

      <form onSubmit={submit} className="space-y-5">

        {/* ── Who ── */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Who</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Client</label>
              <select value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} required className={selectCls}>
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Caregiver</label>
              <select value={form.caregiverId} onChange={e => setForm(f => ({ ...f, caregiverId: e.target.value }))} required className={selectCls}>
                <option value="">Select caregiver…</option>
                {caregivers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── When ── */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">When</p>
            {(() => {
              const cg = caregivers.find(c => String(c.id) === form.caregiverId);
              const tz = cg?.timezone;
              if (!tz) return null;
              return (
                <span className="text-[10px] font-medium text-[#1f4e79] bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                  Times in {getTzAbbr(tz)} · {tz}
                </span>
              );
            })()}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Start date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Time — quick pick</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {TIME_PRESETS.map(p => (
                <button key={p.label} type="button"
                  onClick={() => setForm(f => ({ ...f, start: p.start, end: p.end }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    activePreset?.label === p.label
                      ? 'bg-[#1f4e79] text-white border-[#1f4e79]'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-[#1f4e79] hover:text-[#1f4e79]'
                  }`}
                >{p.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">Start</label>
                <input type="time" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} required className={inputCls} />
              </div>
              <div className="pt-5 text-slate-300 font-light">→</div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">End</label>
                <input type="time" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} required className={inputCls} />
              </div>
              {duration && (
                <div className="pt-5 whitespace-nowrap">
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg">{duration}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Repeat ── */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Repeat</p>

          {/* Recurrence type pills */}
          <div className="flex flex-wrap gap-2">
            {RECURRENCE_OPTIONS.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setForm(f => ({ ...f, recurrenceRule: opt.value, occurrences: opt.value === 'none' ? '1' : f.occurrences }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  form.recurrenceRule === opt.value
                    ? 'bg-[#1f4e79] text-white border-[#1f4e79]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-[#1f4e79] hover:text-[#1f4e79]'
                }`}
              >{opt.label}</button>
            ))}
          </div>

          {/* Daily — pick which days of the week */}
          {form.recurrenceRule === 'daily' && (
            <div className="space-y-2 pt-1 border-t border-slate-200">
              <label className="block text-xs font-medium text-slate-500">Which days?</label>
              <DayPills selected={dailyDays} multi onChange={v => setDailyDays(v as number[])} />
            </div>
          )}

          {/* Weekly / Bi-weekly — multi-select days */}
          {(form.recurrenceRule === 'weekly' || form.recurrenceRule === 'biweekly') && (
            <div className="space-y-2 pt-1 border-t border-slate-200">
              <label className="block text-xs font-medium text-slate-500">Which days of the week?</label>
              <DayPills selected={weeklyDays} multi onChange={v => setWeeklyDays(v as number[])} />
            </div>
          )}

          {/* Monthly — pick week of month + multi-select days */}
          {form.recurrenceRule === 'monthly' && (
            <div className="space-y-3 pt-1 border-t border-slate-200">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-500">Which week of the month?</label>
                <div className="flex gap-2">
                  {WEEK_OF_MONTH_LABELS.map((lbl, i) => (
                    <button key={lbl} type="button"
                      onClick={() => setMonthlyWeek(i + 1)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        monthlyWeek === i + 1
                          ? 'bg-[#1f4e79] text-white border-[#1f4e79]'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-[#1f4e79] hover:text-[#1f4e79]'
                      }`}
                    >{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-500">Which days?</label>
                <DayPills selected={monthlyDays} multi onChange={v => setMonthlyDays(v as number[])} />
              </div>
            </div>
          )}
        </div>

        {msg && <p className="text-red-600 text-sm">{msg}</p>}
        {success && (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {success.count === 1 ? 'Visit scheduled!' : `${success.count} visits scheduled!`}
          </div>
        )}

        <button type="submit" disabled={loading} className={btnCls + ' px-6 py-2.5 disabled:opacity-60'}>
          {loading ? 'Scheduling…' : form.recurrenceRule !== 'none' ? `Schedule ${form.occurrences || 1} Visits` : 'Schedule Visit'}
        </button>
      </form>
    </div>
  );
}

function ClientsTab({ onClientClick }: { onClientClick: (c: HistoryClient) => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ name: '', address: '', lat: '', lng: '' });
  const [msg, setMsg] = useState('');

  const load = () => api('/clients').then(d => d && setClients(d.clients));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    try {
      await api('/clients', { method: 'POST', body: JSON.stringify({
        name: form.name, address: form.address || null,
        lat: form.lat ? Number(form.lat) : null, lng: form.lng ? Number(form.lng) : null,
      })});
      setForm({ name: '', address: '', lat: '', lng: '' });
      load();
    } catch (err: any) { setMsg(err.message); }
  };

  return (
    <>
      <Card title="Add Client">
        <form onSubmit={submit} className="space-y-3 max-w-sm">
          <FormField label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} /></FormField>
          <FormField label="Address"><input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inputCls} /></FormField>
          <div className="flex gap-3">
            <FormField label="Latitude"><input type="number" step="any" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} className={inputCls} /></FormField>
            <FormField label="Longitude"><input type="number" step="any" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} className={inputCls} /></FormField>
          </div>
          {msg && <p className="text-red-600 text-sm">{msg}</p>}
          <button type="submit" className={btnCls}>Add Client</button>
        </form>
      </Card>
      <Card title="Clients">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
            {['Name', 'Address', 'Payer', 'Coordinates', ''].map((h, i) => <th key={i} className="pb-2 pr-4 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {clients.length === 0 ? <tr><td colSpan={5} className="pt-4 text-slate-400">No clients yet.</td></tr>
              : clients.map(c => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4">
                    <button
                      onClick={() => onClientClick({ id: c.id, name: c.name, address: c.address })}
                      className="text-[#1f4e79] hover:underline font-medium text-left"
                    >{c.name}</button>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500">{c.address || '—'}</td>
                  <td className="py-2.5 pr-4">{c.payer_type}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{c.lat != null ? `${c.lat}, ${c.lng}` : '—'}</td>
                  <td className="py-2.5">
                    <button
                      onClick={() => window.open(`/qr/${c.id}`, '_blank')}
                      className="flex items-center gap-1.5 text-xs font-medium text-[#1f4e79] hover:text-[#163a5a] bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                      </svg>
                      Print QR
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

const TZ_OPTIONS = [
  { value: 'America/New_York',                  label: 'Eastern — New York / most of East Coast' },
  { value: 'America/Detroit',                   label: 'Eastern — Michigan' },
  { value: 'America/Kentucky/Louisville',       label: 'Eastern — Kentucky (Louisville)' },
  { value: 'America/Kentucky/Monticello',       label: 'Eastern — Kentucky (Monticello)' },
  { value: 'America/Indiana/Indianapolis',      label: 'Eastern — Indiana (Indianapolis, no DST)' },
  { value: 'America/Indiana/Marengo',           label: 'Eastern — Indiana (Marengo)' },
  { value: 'America/Indiana/Vevay',             label: 'Eastern — Indiana (Vevay)' },
  { value: 'America/Indiana/Vincennes',         label: 'Central — Indiana (Vincennes)' },
  { value: 'America/Indiana/Petersburg',        label: 'Central — Indiana (Petersburg)' },
  { value: 'America/Indiana/Tell_City',         label: 'Central — Indiana (Tell City)' },
  { value: 'America/Indiana/Knox',              label: 'Central — Indiana (Knox)' },
  { value: 'America/Indiana/Winamac',           label: 'Eastern — Indiana (Winamac)' },
  { value: 'America/Chicago',                   label: 'Central — Chicago / most of Midwest & South' },
  { value: 'America/Menominee',                 label: 'Central — Michigan (Upper Peninsula)' },
  { value: 'America/North_Dakota/Center',       label: 'Central — North Dakota (Center)' },
  { value: 'America/North_Dakota/New_Salem',    label: 'Central — North Dakota (New Salem)' },
  { value: 'America/North_Dakota/Beulah',       label: 'Central — North Dakota (Beulah)' },
  { value: 'America/Denver',                    label: 'Mountain — Denver / most of Mountain West' },
  { value: 'America/Boise',                     label: 'Mountain — Idaho (Boise)' },
  { value: 'America/Phoenix',                   label: 'Mountain — Arizona (no DST)' },
  { value: 'America/Los_Angeles',               label: 'Pacific — Los Angeles / CA, OR, WA, NV' },
  { value: 'America/Anchorage',                 label: 'Alaska — Anchorage / most of Alaska' },
  { value: 'America/Juneau',                    label: 'Alaska — Southeast (Juneau)' },
  { value: 'America/Sitka',                     label: 'Alaska — Southeast (Sitka)' },
  { value: 'America/Yakutat',                   label: 'Alaska — Yakutat' },
  { value: 'America/Nome',                      label: 'Alaska — Western (Nome)' },
  { value: 'America/Metlakatla',                label: 'Alaska — Metlakatla' },
  { value: 'America/Adak',                      label: 'Aleutian / Hawaii-Aleutian (Adak)' },
  { value: 'Pacific/Honolulu',                  label: 'Hawaii — Honolulu (no DST)' },
  { value: 'America/Puerto_Rico',               label: 'Atlantic — Puerto Rico / US Virgin Islands' },
  { value: 'Pacific/Guam',                      label: 'Chamorro — Guam / Northern Mariana Islands' },
  { value: 'Pacific/Pago_Pago',                 label: 'Samoa — American Samoa' },
];

const CAREGIVER_COLORS = [
  { bg: 'bg-blue-100',    text: 'text-blue-800',    border: 'border-blue-200',    dot: 'bg-blue-500'    },
  { bg: 'bg-violet-100',  text: 'text-violet-800',  border: 'border-violet-200',  dot: 'bg-violet-500'  },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  { bg: 'bg-orange-100',  text: 'text-orange-800',  border: 'border-orange-200',  dot: 'bg-orange-500'  },
  { bg: 'bg-pink-100',    text: 'text-pink-800',    border: 'border-pink-200',    dot: 'bg-pink-500'    },
  { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-200',   dot: 'bg-amber-500'   },
  { bg: 'bg-teal-100',    text: 'text-teal-800',    border: 'border-teal-200',    dot: 'bg-teal-500'    },
  { bg: 'bg-rose-100',    text: 'text-rose-800',    border: 'border-rose-200',    dot: 'bg-rose-500'    },
];

function tzLabel(tz: string) {
  return TZ_OPTIONS.find(o => o.value === tz)?.label ?? tz;
}

function CaregiversTab({ onCaregiverClick }: { onCaregiverClick: (c: HistoryCaregiver) => void }) {
  const api = useApi();
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: 'caregiver123', employee_id: '', timezone: 'America/Chicago' });
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editTz, setEditTz] = useState('America/Chicago');
  const [editMsg, setEditMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api('/caregivers').then(d => d && setCaregivers(d.caregivers));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    try {
      await api('/caregivers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', password: 'caregiver123', employee_id: '', timezone: 'America/Chicago' });
      load();
    } catch (err: any) { setMsg(err.message); }
  };

  const startEdit = (c: Caregiver) => {
    setEditingId(c.id);
    setEditVal(c.employee_id || '');
    setEditTz(c.timezone || 'America/Chicago');
    setEditMsg('');
  };

  const saveEdit = async (c: Caregiver) => {
    setSaving(true); setEditMsg('');
    try {
      const patch: Record<string, string> = { timezone: editTz };
      if (editVal.trim()) patch.employee_id = editVal.trim();
      await api(`/caregivers/${c.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setEditingId(null);
      load();
    } catch (err: any) { setEditMsg(err.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Card title="Add Caregiver">
        <form onSubmit={submit} className="space-y-3 max-w-sm">
          <FormField label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} /></FormField>
          <FormField label="Email"><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className={inputCls} /></FormField>
          <FormField label="Temporary Password"><input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required className={inputCls} /></FormField>
          <FormField label="Employee ID (optional)">
            <input
              value={form.employee_id}
              onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
              placeholder="e.g. EMP-0042 — leave blank to auto-assign"
              className={inputCls}
            />
          </FormField>
          <FormField label="Timezone">
            <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className={selectCls}>
              {TZ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
          {msg && <p className="text-red-600 text-sm">{msg}</p>}
          <button type="submit" className={btnCls}>Add Caregiver</button>
        </form>
      </Card>
      <Card title="Caregivers">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
            {['Employee ID', 'Name', 'Email', 'Timezone', ''].map(h => <th key={h} className="pb-2 pr-4 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {caregivers.length === 0
              ? <tr><td colSpan={5} className="pt-4 text-slate-400">No caregivers yet.</td></tr>
              : caregivers.map(c => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4 w-36">
                    {editingId === c.id ? (
                      <div className="flex flex-col gap-1.5">
                        <input
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') setEditingId(null); }}
                          placeholder="Employee ID"
                          className="border border-slate-300 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-[#1f4e79]"
                          autoFocus
                        />
                        <select
                          value={editTz}
                          onChange={e => setEditTz(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-[#1f4e79] bg-white"
                        >
                          {TZ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        {editMsg && <span className="text-red-500 text-xs">{editMsg}</span>}
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(c)} disabled={saving} className="text-xs bg-[#1f4e79] text-white px-2 py-0.5 rounded hover:bg-[#163a5f] disabled:opacity-50">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 px-2 py-0.5 rounded hover:bg-slate-100">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(c)}
                        title="Click to edit"
                        className="font-mono text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded cursor-pointer"
                      >
                        {c.employee_id || <span className="text-slate-400 italic">unset</span>}
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <button
                      onClick={() => onCaregiverClick({ id: c.id, name: c.name, email: c.email })}
                      className="text-[#1f4e79] hover:underline font-medium text-left"
                    >{c.name}</button>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500">{c.email}</td>
                  <td className="py-2.5 pr-4">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{tzLabel(c.timezone || 'America/Chicago')}</span>
                  </td>
                  <td className="py-2.5 text-slate-400 text-xs">
                    <button onClick={() => startEdit(c)} className="hover:text-[#1f4e79]" title="Edit">✏️</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function ReassignModal({ visit, caregivers, onClose, onSaved }: {
  visit: Visit;
  caregivers: Caregiver[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [selectedId, setSelectedId] = useState<number | ''>(visit.caregiver_id);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!selectedId || selectedId === visit.caregiver_id) { onClose(); return; }
    setSaving(true); setMsg('');
    try {
      await api(`/visits/${visit.id}/reassign`, { method: 'POST', body: JSON.stringify({ caregiver_id: selectedId }) });
      onSaved();
      onClose();
    } catch (err: any) { setMsg(err.message); }
    finally { setSaving(false); }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }}
      >
        <h3 className="font-bold text-slate-800 text-base mb-1">Reassign Visit</h3>
        <p className="text-sm text-slate-500 mb-4">
          {visit.client_name} · {new Date(visit.scheduled_start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          {' '}@ {new Date(visit.scheduled_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Assign to</label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(Number(e.target.value))}
          className={selectCls}
        >
          {caregivers.map(c => {
            const abbr = c.timezone ? ` · ${getTzAbbr(c.timezone)}` : '';
            const current = c.id === visit.caregiver_id ? ' (current)' : '';
            return <option key={c.id} value={c.id}>{c.name}{abbr}{current}</option>;
          })}
        </select>
        {msg && <p className="text-red-600 text-sm mt-2">{msg}</p>}
        <div className="flex gap-2 mt-5">
          <button
            onClick={save} disabled={saving || selectedId === visit.caregiver_id}
            className="flex-1 bg-[#1f4e79] text-white py-2 rounded-xl text-sm font-medium hover:bg-[#163a5f] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Reassign'}
          </button>
          <button onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function getTzAbbr(tz: string): string {
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, timeZoneName: 'short' })
      .split(' ').at(-1) ?? tz.split('/').at(-1) ?? tz;
  } catch { return tz.split('/').at(-1) ?? tz; }
}

function fmtTimeInTz(iso: string, tz?: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

// Gantt timeline constants
const WV_PX_HR   = 64;  // pixels per hour
const WV_HPD     = 24;  // hours per day (full 24h for overnight spanning)
const WV_ROW_H   = 60;  // px: caregiver row height
const WV_LBL_W   = 148; // px: fixed left caregiver label column
const WV_TICK_HRS = [0, 3, 6, 9, 12, 15, 18, 21]; // hours to label per day

function wvLeft(iso: string, weekDays: Date[]): number {
  const dayKey   = iso.slice(0, 10);
  const dayIndex = weekDays.findIndex(d => d.toISOString().slice(0, 10) === dayKey);
  if (dayIndex < 0) return -99999;
  const h = parseInt(iso.slice(11, 13));
  const m = parseInt(iso.slice(14, 16));
  return (dayIndex * WV_HPD + h + m / 60) * WV_PX_HR;
}

function wvWidth(startIso: string, endIso: string): number {
  const sH  = parseInt(startIso.slice(11, 13)) + parseInt(startIso.slice(14, 16)) / 60;
  const eH  = parseInt(endIso.slice(11, 13))   + parseInt(endIso.slice(14, 16)) / 60;
  const sDay = startIso.slice(0, 10);
  const eDay = endIso.slice(0, 10);
  const dayDiff = sDay === eDay ? 0
    : Math.round((Date.parse(eDay) - Date.parse(sDay)) / 86400000);
  const durationHours = Math.max(0.25, eH + dayDiff * 24 - sH);
  return Math.min(durationHours, WV_HPD * 7) * WV_PX_HR;
}

function WeekViewTab({ onOpenNewVisit }: { onOpenNewVisit?: (caregiverId: string, date: string, time?: string) => void }) {
  const api = useApi();
  const [visits, setVisits]         = useState<Visit[]>([]);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [reassignVisit, setReassignVisit] = useState<Visit | null>(null);
  const [loading, setLoading]       = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { weekStart, weekEnd, weekDays } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7);
    const days: Date[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
    return { weekStart: days[0], weekEnd: days[6], weekDays: days };
  }, [weekOffset]);

  const load = useCallback(async () => {
    setLoading(true);
    const [vData, cgData] = await Promise.all([
      api(`/visits?date_from=${weekStart.toISOString().slice(0, 10)}&date_to=${weekEnd.toISOString().slice(0, 10)}`),
      api('/caregivers'),
    ]);
    if (vData)  setVisits(vData.visits ?? []);
    if (cgData) setCaregivers(cgData.caregivers ?? []);
    setLoading(false);
  }, [weekStart, weekEnd]);

  useEffect(() => { load(); }, [load]);

  // Scroll to 6am on initial load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollLeft = 6 * WV_PX_HR;
    }
  }, [loading]);

  const isToday   = (d: Date) => d.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  const weekLabel = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const totalW    = 7 * WV_HPD * WV_PX_HR;

  const statusBorderCls: Record<string, string> = {
    scheduled: 'border-l-slate-500', in_progress: 'border-l-amber-500',
    completed: 'border-l-emerald-500', missed: 'border-l-red-400',
    declined: 'border-l-red-600',
  };
  const canReassign = (v: Visit) => v.status === 'scheduled' || v.status === 'in_progress' || v.status === 'declined';

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>, cg: Caregiver) => {
    if (!onOpenNewVisit) return;
    const x = e.nativeEvent.offsetX;
    const totalHoursFromMonday = x / WV_PX_HR;
    const dayIndex = Math.min(6, Math.max(0, Math.floor(totalHoursFromMonday / WV_HPD)));
    const hourWithinDay = Math.floor(totalHoursFromMonday % WV_HPD);
    const clickedDate = new Date(weekStart);
    clickedDate.setDate(clickedDate.getDate() + dayIndex);
    const dateStr = clickedDate.toISOString().slice(0, 10);
    const timeStr = `${String(hourWithinDay).padStart(2, '0')}:00`;
    onOpenNewVisit(String(cg.id), dateStr, timeStr);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Week View</h2>
          <p className="text-slate-500 text-sm">{weekLabel} · click any empty slot to schedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-600">Today</button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Loading…</div>
      ) : (
        <div className="flex rounded-xl border border-slate-200 bg-white overflow-hidden" style={{ minHeight: 120 }}>
          {/* Fixed left: caregiver labels */}
          <div style={{ width: WV_LBL_W, flexShrink: 0 }} className="border-r border-slate-200 z-10 bg-white">
            <div style={{ height: 44 }} className="border-b border-slate-200 bg-slate-50" />
            {caregivers.length === 0 && (
              <div className="px-3 py-4 text-slate-400 text-xs">No caregivers yet</div>
            )}
            {caregivers.map((cg, i) => {
              const col  = CAREGIVER_COLORS[i % CAREGIVER_COLORS.length];
              const abbr = getTzAbbr(cg.timezone || 'America/Chicago');
              return (
                <div key={cg.id} style={{ height: WV_ROW_H }} className={`border-b border-slate-100 last:border-b-0 flex flex-col justify-center px-3 ${col.bg}`}>
                  <p className={`text-xs font-semibold truncate ${col.text}`}>{cg.name}</p>
                  <p className={`text-[10px] opacity-60 ${col.text}`}>{abbr}</p>
                </div>
              );
            })}
          </div>

          {/* Scrollable horizontal timeline */}
          <div ref={scrollRef} className="flex-1 overflow-x-auto">
            <div style={{ width: totalW, position: 'relative' }}>

              {/* Day banner row */}
              <div style={{ height: 24, position: 'relative' }} className="border-b border-slate-100 bg-slate-50">
                {weekDays.map((day, di) => (
                  <div
                    key={di}
                    style={{ position: 'absolute', left: di * WV_HPD * WV_PX_HR, width: WV_HPD * WV_PX_HR }}
                    className={`h-full border-r border-slate-200 flex items-center px-2 text-[10px] font-semibold ${
                      isToday(day) ? 'text-[#1f4e79] bg-blue-50' : 'text-slate-500'
                    }`}
                  >
                    {day.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })}
                  </div>
                ))}
              </div>

              {/* Hour tick row */}
              <div style={{ height: 20, position: 'relative' }} className="border-b border-slate-200 bg-slate-50">
                {weekDays.map((_, di) =>
                  WV_TICK_HRS.map(h => (
                    <div
                      key={`${di}-${h}`}
                      style={{ position: 'absolute', left: (di * WV_HPD + h) * WV_PX_HR }}
                      className="h-full border-l border-slate-200 flex items-center pl-0.5 text-[9px] text-slate-400 select-none whitespace-nowrap"
                    >
                      {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
                    </div>
                  ))
                )}
              </div>

              {/* Grid body */}
              <div style={{ position: 'relative' }}>
                {/* Vertical grid lines */}
                {Array.from({ length: 7 * WV_HPD + 1 }, (_, i) => (
                  <div
                    key={i}
                    style={{ position: 'absolute', left: i * WV_PX_HR, top: 0, bottom: 0, width: 1 }}
                    className={i % WV_HPD === 0 ? 'bg-slate-300' : WV_TICK_HRS.includes(i % WV_HPD) ? 'bg-slate-200' : 'bg-slate-100'}
                  />
                ))}

                {/* Caregiver rows */}
                {caregivers.map((cg, i) => {
                  const col      = CAREGIVER_COLORS[i % CAREGIVER_COLORS.length];
                  const tz       = cg.timezone || 'America/Chicago';
                  const cgVisits = visits.filter(v => v.caregiver_id === cg.id);
                  return (
                    <div
                      key={cg.id}
                      style={{ height: WV_ROW_H, position: 'relative', cursor: 'crosshair' }}
                      className="border-b border-slate-100 last:border-b-0"
                      onClick={e => handleRowClick(e, cg)}
                    >
                      {cgVisits.map(v => {
                        const left   = wvLeft(v.scheduled_start, weekDays);
                        const width  = wvWidth(v.scheduled_start, v.scheduled_end);
                        const reassignable = canReassign(v);
                        const isDeclined = v.status === 'declined';
                        if (left < -1000) return null;
                        return (
                          <div
                            key={v.id}
                            style={{ position: 'absolute', left: left + 1, width: Math.max(28, width - 2), top: 6, bottom: 6 }}
                            onClick={e => e.stopPropagation()}
                            className={`rounded border-l-2 overflow-hidden flex flex-col justify-center px-1.5 select-none ${
                              isDeclined
                                ? 'bg-red-100 text-red-800 border-l-red-600 opacity-80'
                                : `${col.bg} ${col.text} ${statusBorderCls[v.status] ?? 'border-l-slate-300'} ${!reassignable ? 'opacity-60' : ''}`
                            }`}
                          >
                            <p className={`text-[10px] font-bold leading-tight truncate ${isDeclined ? 'line-through' : ''}`}>
                              {fmtTimeInTz(v.scheduled_start, tz)}
                            </p>
                            <p className={`text-[10px] leading-tight truncate ${isDeclined ? 'line-through' : ''}`}>{v.client_name}</p>
                            {isDeclined && (
                              <p className="text-[9px] font-semibold leading-tight truncate">✕ Declined</p>
                            )}
                            {v.reassigned_from && !isDeclined && (
                              <p className="text-[9px] opacity-60 leading-tight truncate">↩ {v.reassigned_from}</p>
                            )}
                            {reassignable && (
                              <button
                                onClick={() => setReassignVisit(v)}
                                className="text-[9px] font-semibold underline opacity-70 hover:opacity-100 leading-tight text-left"
                              >
                                Re-assign
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {caregivers.length === 0 && (
                  <div style={{ height: WV_ROW_H * 2 }} className="flex items-center justify-center text-slate-400 text-sm">
                    Add caregivers to see the schedule.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {reassignVisit && (
          <ReassignModal
            visit={reassignVisit}
            caregivers={caregivers}
            onClose={() => setReassignVisit(null)}
            onSaved={load}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ---------- PDF print utility ----------

function buildPrintWindow(
  title: string,
  subtitle: string,
  stats: { label: string; value: string | number }[],
  visits: Visit[],
  flagSummary?: { flag: string; count: number }[]
) {
  const fmtT = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtD = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const dur = (ci: string, co: string) => {
    const m = (new Date(co).getTime() - new Date(ci).getTime()) / 60_000;
    const h = Math.floor(m / 60); const mn = Math.round(m % 60);
    return h > 0 ? `${h}h ${mn}m` : `${mn}m`;
  };
  const flagLabel: Record<string, string> = {
    late_checkin: 'Late check-in', late_checkout: 'Late check-out',
    no_checkin: 'No check-in', no_checkout: 'No check-out',
    location_mismatch: 'Location mismatch',
  };

  const statsHtml = stats.map(s =>
    `<div style="text-align:center;padding:10px 16px;border-right:1px solid #e2e8f0;flex:1">
      <div style="font-size:22px;font-weight:700;color:#1f4e79">${s.value}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:2px">${s.label}</div>
    </div>`
  ).join('');

  const flagsHtml = flagSummary && flagSummary.length > 0
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin:14px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.05em">Recurring exceptions</span>
        ${flagSummary.map(({ flag, count }) =>
          `<span style="background:#fee2e2;color:#b91c1c;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600">${flagLabel[flag] ?? flag} ×${count}</span>`
        ).join('')}
      </div>` : '';

  const rowsHtml = visits.map(v => {
    const flags = (v.exception_flags || '').split(',').filter(Boolean).map(f => flagLabel[f] ?? f).join(', ');
    const duration = v.check_in_time && v.check_out_time ? dur(v.check_in_time, v.check_out_time) : '—';
    const statusColor: Record<string, string> = {
      completed: '#059669', in_progress: '#d97706', scheduled: '#2563eb', missed: '#dc2626',
    };
    return `<tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:7px 8px;font-size:12px">${fmtD(v.scheduled_start)}</td>
      <td style="padding:7px 8px;font-size:12px">${v.client_name}</td>
      <td style="padding:7px 8px;font-size:12px">${v.caregiver_name}</td>
      <td style="padding:7px 8px;font-size:12px">${fmtT(v.scheduled_start)}–${fmtT(v.scheduled_end)}</td>
      <td style="padding:7px 8px;font-size:12px">${fmtT(v.check_in_time)} / ${fmtT(v.check_out_time)}</td>
      <td style="padding:7px 8px;font-size:12px;font-weight:600">${duration}</td>
      <td style="padding:7px 8px;font-size:12px;color:${statusColor[v.status] ?? '#475569'}">${v.status}</td>
      <td style="padding:7px 8px;font-size:11px;color:#dc2626">${flags}</td>
      <td style="padding:7px 8px;font-size:11px;color:#475569;font-style:italic">${v.notes ?? ''}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#1e293b}
    table{width:100%;border-collapse:collapse}
    th{background:#f8fafc;padding:7px 8px;font-size:11px;text-align:left;color:#64748b;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e2e8f0}
    @media print{body{padding:0}}
  </style></head><body>
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px">
    <div>
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Visiting Systems — Sunrise Home Care</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#1f4e79">${title}</h1>
      <div style="font-size:13px;color:#64748b;margin-top:4px">${subtitle}</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#94a3b8">Generated ${new Date().toLocaleString()}</div>
  </div>
  <div style="display:flex;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:16px">${statsHtml}</div>
  ${flagsHtml}
  <table>
    <thead><tr>
      <th>Date</th><th>Client</th><th>Caregiver</th><th>Scheduled</th><th>In / Out</th><th>Duration</th><th>Status</th><th>Exceptions</th><th>Notes</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ---------- Client history modal ----------

function ClientHistoryModal({ client, onClose }: { client: HistoryClient; onClose: () => void }) {
  const api = useApi();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    setLoading(true);
    let url = `/visits?client_id=${client.id}&order=desc`;
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo) url += `&date_to=${dateTo}`;
    api(url).then(d => {
      if (d) setVisits(d.visits);
      setLoading(false);
    });
  }, [client.id, dateFrom, dateTo]);

  // Computed stats
  const completed = visits.filter(v => v.status === 'completed');
  const totalHours = completed.reduce((sum, v) => {
    if (!v.check_in_time || !v.check_out_time) return sum;
    return sum + (new Date(v.check_out_time).getTime() - new Date(v.check_in_time).getTime()) / 3_600_000;
  }, 0);
  const withExceptions = completed.filter(v =>
    (v.exception_flags || '').split(',').filter(Boolean).length > 0
  ).length;

  const fmtDuration = (ci: string, co: string) => {
    const mins = (new Date(co).getTime() - new Date(ci).getTime()) / 60_000;
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.backdrop) onClose();
  };

  const stats = [
    { label: 'Total visits', value: visits.length },
    { label: 'Completed', value: completed.length },
    { label: 'Total hours', value: totalHours.toFixed(1) },
    { label: 'With exceptions', value: withExceptions },
  ];

  return (
    <div
      data-backdrop="1"
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#1f4e79] px-6 py-5 flex items-start justify-between">
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">{client.name}</h2>
            {client.address && (
              <p className="text-white/60 text-sm mt-0.5 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                {client.address}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4 mt-0.5 shrink-0">
            <button
              onClick={() => buildPrintWindow(
                client.name,
                `Visit history${dateFrom || dateTo ? ` · ${dateFrom || '…'} → ${dateTo || '…'}` : ''}`,
                stats, visits
              )}
              title="Download PDF"
              className="text-white/70 hover:text-white transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Date filter bar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-medium text-slate-400 shrink-0">Filter by date</span>
          <input
            type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          />
          <span className="text-slate-300 text-xs">→</span>
          <input
            type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              Clear
            </button>
          )}
          {loading && <svg className="animate-spin h-3.5 w-3.5 text-slate-400 ml-auto" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
        </div>

        {/* Stats bar */}
        {!loading && (
          <div className="grid grid-cols-4 border-b border-slate-100">
            {stats.map(s => (
              <div key={s.label} className="px-4 py-3 text-center border-r border-slate-100 last:border-r-0">
                <p className="text-xl font-bold text-[#1f4e79]">{s.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Loading history…
            </div>
          ) : visits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <p className="text-slate-500 font-medium text-sm">No visit history yet</p>
              <p className="text-slate-400 text-xs">Visits will appear here once scheduled.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visits.map(v => {
                const flags = (v.exception_flags || '').split(',').filter(Boolean);
                const duration = v.check_in_time && v.check_out_time
                  ? fmtDuration(v.check_in_time, v.check_out_time) : null;

                const statusBg: Record<string, string> = {
                  completed: 'bg-emerald-50 border-emerald-100',
                  in_progress: 'bg-amber-50 border-amber-100',
                  scheduled: 'bg-blue-50 border-blue-100',
                  missed: 'bg-red-50 border-red-100',
                };

                return (
                  <div key={v.id} className={`border rounded-xl p-4 ${statusBg[v.status] ?? 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <p className="text-sm font-semibold text-slate-800">{fmtDate(v.scheduled_start)}</p>
                          <StatusBadge status={v.status} />
                          {flags.map(f => <FlagBadge key={f} flag={f} />)}
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500">
                          <span><span className="text-slate-400">Caregiver</span> · {v.caregiver_name}</span>
                          <span>
                            <span className="text-slate-400">Scheduled</span> · {formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}
                          </span>
                          {v.check_in_time && (
                            <span><span className="text-slate-400">Check in</span> · {formatTime(v.check_in_time)}</span>
                          )}
                          {v.check_out_time && (
                            <span><span className="text-slate-400">Check out</span> · {formatTime(v.check_out_time)}</span>
                          )}
                        </div>
                        {v.notes && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-600 bg-white/70 rounded-lg px-3 py-2">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            <span className="italic">{v.notes}</span>
                          </div>
                        )}
                      </div>
                      {duration && (
                        <div className="shrink-0 text-right">
                          <p className="text-base font-bold text-slate-700">{duration}</p>
                          <p className="text-[10px] text-slate-400">actual</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ---------- Caregiver history modal ----------

function CaregiverHistoryModal({ caregiver, onClose }: { caregiver: HistoryCaregiver; onClose: () => void }) {
  const api = useApi();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    setLoading(true);
    let url = `/visits?caregiver_id=${caregiver.id}&order=desc`;
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo) url += `&date_to=${dateTo}`;
    api(url).then(d => {
      if (d) setVisits(d.visits);
      setLoading(false);
    });
  }, [caregiver.id, dateFrom, dateTo]);

  const completed = visits.filter(v => v.status === 'completed');
  const totalHours = completed.reduce((sum, v) => {
    if (!v.check_in_time || !v.check_out_time) return sum;
    return sum + (new Date(v.check_out_time).getTime() - new Date(v.check_in_time).getTime()) / 3_600_000;
  }, 0);
  const onTimeRate = completed.length === 0 ? null
    : Math.round((completed.filter(v => !(v.exception_flags || '').split(',').filter(Boolean).length).length / completed.length) * 100);

  // Tally exception types
  const flagCounts: Record<string, number> = {};
  visits.forEach(v => (v.exception_flags || '').split(',').filter(Boolean).forEach(f => { flagCounts[f] = (flagCounts[f] || 0) + 1; }));
  const topFlags = Object.entries(flagCounts).sort((a, b) => b[1] - a[1]);

  const fmtDuration = (ci: string, co: string) => {
    const mins = (new Date(co).getTime() - new Date(ci).getTime()) / 60_000;
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const handleBackdrop = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.backdrop) onClose();
  };

  const flagLabel: Record<string, string> = {
    late_checkin: 'Late check-in', late_checkout: 'Late check-out',
    no_checkin: 'No check-in', no_checkout: 'No check-out',
    location_mismatch: 'Location mismatch',
  };

  const stats = [
    { label: 'Total visits', value: visits.length },
    { label: 'Completed', value: completed.length },
    { label: 'Total hours', value: totalHours.toFixed(1) },
    { label: 'On-time rate', value: onTimeRate !== null ? `${onTimeRate}%` : '—' },
  ];

  return (
    <div
      data-backdrop="1"
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#1f4e79] px-6 py-5 flex items-start justify-between">
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">{caregiver.name}</h2>
            {caregiver.email && (
              <p className="text-white/60 text-sm mt-0.5 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                {caregiver.email}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4 mt-0.5 shrink-0">
            <button
              onClick={() => buildPrintWindow(
                caregiver.name,
                `Performance report${dateFrom || dateTo ? ` · ${dateFrom || '…'} → ${dateTo || '…'}` : ''}`,
                stats, visits,
                topFlags.map(([flag, count]) => ({ flag, count }))
              )}
              title="Download PDF"
              className="text-white/70 hover:text-white transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Date filter bar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-medium text-slate-400 shrink-0">Filter by date</span>
          <input
            type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          />
          <span className="text-slate-300 text-xs">→</span>
          <input
            type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/20"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              Clear
            </button>
          )}
          {loading && <svg className="animate-spin h-3.5 w-3.5 text-slate-400 ml-auto" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
        </div>

        {/* Stats bar */}
        {!loading && (
          <div className="grid grid-cols-4 border-b border-slate-100">
            {stats.map(s => (
              <div key={s.label} className="px-4 py-3 text-center border-r border-slate-100 last:border-r-0">
                <p className={`text-xl font-bold ${s.label === 'On-time rate' && onTimeRate !== null && onTimeRate < 80 ? 'text-red-500' : 'text-[#1f4e79]'}`}>
                  {s.value}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Exception summary strip */}
        {!loading && topFlags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-slate-100 bg-red-50">
            <span className="text-[11px] font-semibold text-red-600 uppercase tracking-wide shrink-0">Recurring exceptions</span>
            {topFlags.map(([f, n]) => (
              <span key={f} className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                {flagLabel[f] ?? f} <span className="font-bold">×{n}</span>
              </span>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Loading history…
            </div>
          ) : visits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <p className="text-slate-500 font-medium text-sm">No visits assigned yet</p>
              <p className="text-slate-400 text-xs">Visits will appear here once scheduled.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visits.map(v => {
                const flags = (v.exception_flags || '').split(',').filter(Boolean);
                const duration = v.check_in_time && v.check_out_time
                  ? fmtDuration(v.check_in_time, v.check_out_time) : null;
                const statusBg: Record<string, string> = {
                  completed: 'bg-emerald-50 border-emerald-100',
                  in_progress: 'bg-amber-50 border-amber-100',
                  scheduled: 'bg-blue-50 border-blue-100',
                  missed: 'bg-red-50 border-red-100',
                };
                return (
                  <div key={v.id} className={`border rounded-xl p-4 ${statusBg[v.status] ?? 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <p className="text-sm font-semibold text-slate-800">{fmtDate(v.scheduled_start)}</p>
                          <StatusBadge status={v.status} />
                          {flags.map(f => <FlagBadge key={f} flag={f} />)}
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500">
                          <span><span className="text-slate-400">Client</span> · {v.client_name}</span>
                          <span>
                            <span className="text-slate-400">Scheduled</span> · {formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}
                          </span>
                          {v.check_in_time && (
                            <span><span className="text-slate-400">Check in</span> · {formatTime(v.check_in_time)}</span>
                          )}
                          {v.check_out_time && (
                            <span><span className="text-slate-400">Check out</span> · {formatTime(v.check_out_time)}</span>
                          )}
                        </div>
                        {v.notes && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-600 bg-white/70 rounded-lg px-3 py-2">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            <span className="italic">{v.notes}</span>
                          </div>
                        )}
                      </div>
                      {duration && (
                        <div className="shrink-0 text-right">
                          <p className="text-base font-bold text-slate-700">{duration}</p>
                          <p className="text-[10px] text-slate-400">actual</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

type WeeklySummaryRow = { caregiver_name: string; visit_count: number; total_hours: number; flags: string[] };
type WeeklySummary = {
  week_start: string; week_end: string; rows: WeeklySummaryRow[];
  smtp_configured: boolean; supervisor_email: string;
  last_sent_at: string | null; next_scheduled: string;
};

function PayrollTab() {
  const api = useApi();
  const token = localStorage.getItem('evv_token');
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [csvMsg, setCsvMsg] = useState('');

  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    api('/payroll/summary').then(d => { if (d) setSummary(d); setSummaryLoading(false); });
  }, []);

  const exportCsv = async () => {
    setCsvMsg('');
    try {
      const res = await fetch(`/api/payroll/export?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'payroll_export.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) { setCsvMsg(err.message); }
  };

  const sendNow = async () => {
    setSending(true); setSendResult(null);
    try {
      await api('/payroll/email-now', { method: 'POST' });
      setSendResult({ ok: true, msg: `Summary sent to ${summary?.supervisor_email}` });
      api('/payroll/summary').then(d => { if (d) setSummary(d); });
    } catch (err: any) {
      setSendResult({ ok: false, msg: err.message });
    } finally { setSending(false); }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {/* ── Weekly email summary ── */}
      <Card title="Weekly Payroll Email">
        <p className="text-slate-500 text-sm mb-5">
          A summary email is automatically sent to the supervisor every <strong>Monday at 8 AM</strong>,
          listing last week's hours per caregiver and any exception flags.
        </p>

        {/* SMTP status + last sent */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg ${
            summary?.smtp_configured
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${summary?.smtp_configured ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {summary?.smtp_configured ? 'SMTP configured' : 'SMTP not configured'}
          </div>
          {summary?.last_sent_at && (
            <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Last sent {fmtDateTime(summary.last_sent_at)}
            </div>
          )}
          {summary?.next_scheduled && (
            <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-50 text-slate-500">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Next: {fmtDateTime(summary.next_scheduled)}
            </div>
          )}
        </div>

        {/* Preview table */}
        {summaryLoading ? (
          <p className="text-slate-400 text-sm">Loading summary…</p>
        ) : summary ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                Preview — Week of {fmtDate(summary.week_start)} – {fmtDate(summary.week_end)}
              </p>
            </div>
            {summary.rows.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center border border-dashed border-slate-200 rounded-xl">
                No completed visits found for last week.
              </p>
            ) : (
              <div className="border border-slate-100 rounded-xl overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left">Caregiver</th>
                      <th className="px-4 py-2.5 text-center">Visits</th>
                      <th className="px-4 py-2.5 text-center">Hours</th>
                      <th className="px-4 py-2.5 text-left">Exceptions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{r.caregiver_name}</td>
                        <td className="px-4 py-2.5 text-center text-slate-600">{r.visit_count}</td>
                        <td className="px-4 py-2.5 text-center text-slate-600">{r.total_hours.toFixed(2)}</td>
                        <td className="px-4 py-2.5">
                          {r.flags.length > 0
                            ? r.flags.map(f => (
                              <span key={f} className="inline-block bg-red-50 text-red-700 text-[11px] font-semibold px-1.5 py-0.5 rounded mr-1">
                                {f.replace(/_/g, ' ')}
                              </span>
                            ))
                            : <span className="text-slate-300 text-xs">—</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-100 text-xs font-semibold text-slate-500">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-center">{summary.rows.reduce((s, r) => s + r.visit_count, 0)}</td>
                      <td className="px-4 py-2 text-center">{summary.rows.reduce((s, r) => s + r.total_hours, 0).toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        ) : null}

        {/* Send now */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={sendNow}
            disabled={sending || !summary?.smtp_configured}
            className={`${btnCls} flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {sending ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                Send Now
              </>
            )}
          </button>
          {!summary?.smtp_configured && (
            <p className="text-amber-600 text-xs">Set SMTP_HOST, SMTP_USER, SMTP_PASS, SUPERVISOR_EMAIL in Secrets to enable email.</p>
          )}
        </div>

        <AnimatePresence>
          {sendResult && (
            <motion.div
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`mt-3 text-sm px-3 py-2 rounded-lg ${sendResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
            >
              {sendResult.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* ── CSV export ── */}
      <Card title="CSV Export">
        <p className="text-slate-500 text-sm mb-4">Download completed visits as a CSV for any date range.</p>
        <div className="flex gap-4 items-end max-w-sm">
          <FormField label="Start date"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></FormField>
          <FormField label="End date"><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} /></FormField>
        </div>
        {csvMsg && <p className="text-red-600 text-sm mt-2">{csvMsg}</p>}
        <button onClick={exportCsv} className={`${btnCls} mt-4`}>Download CSV</button>
      </Card>
    </>
  );
}

// ---------- Caregiver view ----------

function CaregiverView({ user }: { user: User }) {
  const api = useApi();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [msgs, setMsgs] = useState<Record<number, string>>({});
  const [declineId, setDeclineId] = useState<number | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);

  const load = () => api('/visits').then(d => { if (d) setVisits(d.visits); setLoading(false); });
  useEffect(() => { load(); }, []);

  const getLocation = () => new Promise<{ lat: number | null; lng: number | null }>(resolve => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 5000 }
    );
  });

  const checkin = async (id: number) => {
    const loc = await getLocation();
    try { await api(`/visits/${id}/checkin`, { method: 'POST', body: JSON.stringify(loc) }); load(); }
    catch (err: any) { setMsgs(m => ({ ...m, [id]: err.message })); }
  };

  const checkout = async (id: number) => {
    const loc = await getLocation();
    try { await api(`/visits/${id}/checkout`, { method: 'POST', body: JSON.stringify(loc) }); load(); }
    catch (err: any) { setMsgs(m => ({ ...m, [id]: err.message })); }
  };

  const openDecline = (id: number) => {
    setDeclineId(id);
    setDeclineReason('');
    setMsgs(m => ({ ...m, [id]: '' }));
  };

  const cancelDecline = () => {
    setDeclineId(null);
    setDeclineReason('');
  };

  const confirmDecline = async () => {
    if (!declineId) return;
    const r = declineReason.trim();
    if (!r) { setMsgs(m => ({ ...m, [declineId]: 'Please enter a reason.' })); return; }
    setDeclining(true);
    try {
      await api(`/visits/${declineId}/decline`, { method: 'POST', body: JSON.stringify({ reason: r }) });
      setDeclineId(null);
      setDeclineReason('');
      load();
    } catch (err: any) {
      setMsgs(m => ({ ...m, [declineId!]: err.message }));
    } finally {
      setDeclining(false);
    }
  };

  if (loading) return <Card><p className="text-slate-400 text-sm">Loading…</p></Card>;

  return (
    <Card title="My Visits Today">
      {visits.length === 0 ? (
        <p className="text-slate-400 text-sm">No visits scheduled.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
              {['Time', 'Client', 'Address', 'Status', 'Action'].map(h => (
                <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.map(v => (
              <React.Fragment key={v.id}>
                <tr className={`border-b border-slate-50 last:border-0 ${v.status === 'declined' ? 'bg-red-50/30' : ''}`}>
                  <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                    {formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}
                  </td>
                  <td className="py-3 pr-4 font-medium text-slate-800">{v.client_name}</td>
                  <td className="py-3 pr-4 text-slate-500 max-w-[200px] truncate">{v.client_address}</td>
                  <td className="py-3 pr-4"><StatusBadge status={v.status} /></td>
                  <td className="py-3">
                    {v.status === 'scheduled' && declineId !== v.id && (
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => checkin(v.id)} className={btnCls}>Check In</button>
                        <button
                          onClick={() => openDecline(v.id)}
                          className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                    {v.status === 'in_progress' && (
                      <button onClick={() => checkout(v.id)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">Check Out</button>
                    )}
                    {v.status === 'completed' && <span className="text-slate-400 text-sm">✓ Done</span>}
                    {v.status === 'declined' && (
                      <span className="text-red-600 text-sm font-medium">✕ Declined</span>
                    )}
                    {msgs[v.id] && <p className="text-red-600 text-xs mt-1">{msgs[v.id]}</p>}
                  </td>
                </tr>
                {declineId === v.id && (
                  <tr className="border-b border-red-100 bg-red-50/50">
                    <td colSpan={5} className="px-2 py-3">
                      <p className="text-sm font-semibold text-red-800 mb-2">Decline shift — brief reason required</p>
                      <textarea
                        value={declineReason}
                        onChange={e => setDeclineReason(e.target.value.slice(0, 200))}
                        placeholder="e.g. Family emergency, illness, transport issue…"
                        rows={2}
                        className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
                      />
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={confirmDecline}
                          disabled={declining || !declineReason.trim()}
                          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
                        >
                          {declining ? 'Declining…' : 'Confirm Decline'}
                        </button>
                        <button onClick={cancelDecline} className="text-slate-500 hover:text-slate-700 text-sm px-3 py-1.5">Cancel</button>
                        <span className="text-xs text-slate-400 ml-auto">{declineReason.length}/200</span>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------- Shared UI primitives ----------

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm mb-4">
      {title && <h3 className="text-base font-semibold text-slate-800 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex-1">
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors';
const selectCls = `${inputCls} bg-white`;
const btnCls = 'bg-[#1f4e79] hover:bg-[#163a5a] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors';

// ---------- Alerts tab ----------

type AlertRecord = {
  visit_id: number;
  type: 'missed_checkin' | 'overdue_checkout' | 'shift_declined';
  sent_at: string;
  client_name: string;
  caregiver_name: string;
  caregiver_id?: number;
  scheduled_start?: string;
  decline_reason?: string;
  reschedule_flag?: boolean;
  email_sent: boolean;
};

type AlertStatus = {
  configured: boolean;
  supervisor_email_masked: string;
  smtp_host: string;
  alerts: AlertRecord[];
};

function AlertsTab() {
  const api = useApi();
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState('');
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [dismissing, setDismissing] = useState<number | null>(null);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [reassignAlert, setReassignAlert] = useState<AlertRecord | null>(null);
  const [liveVisits, setLiveVisits] = useState<Visit[]>([]);

  const load = () => Promise.all([
    api('/alerts/status'),
    api('/caregivers'),
    api('/visits'),
  ]).then(([d, cg, vr]) => {
    if (d) setStatus(d);
    if (cg) setCaregivers(cg.caregivers ?? []);
    if (vr) setLiveVisits(vr.visits ?? []);
    setLoading(false);
  });
  useEffect(() => { load(); }, []);

  const sendTest = async () => {
    if (!testEmail) return;
    setTestState('sending');
    try {
      const res = await api('/alerts/test', { method: 'POST', body: JSON.stringify({ to: testEmail }) });
      if (res?.ok) { setTestState('ok'); setTestMsg(res.message); }
      else { setTestState('err'); setTestMsg(res?.error || 'Unknown error'); }
    } catch (e: any) { setTestState('err'); setTestMsg(e.message); }
  };

  const dismiss = async (visitId: number) => {
    setDismissing(visitId);
    await api('/alerts/dismiss', { method: 'POST', body: JSON.stringify({ visit_id: visitId }) });
    setDismissing(null);
    load();
  };

  const liveOverdue = liveVisits.filter(v => isOverdue(v) !== false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const liveDeclined = liveVisits.filter(
    v => v.status === 'declined' && v.scheduled_start.slice(0, 10) >= todayStr
  );

  if (loading) return <Card><p className="text-slate-400 text-sm">Loading…</p></Card>;

  const smtpSetup = [
    { key: 'SMTP_HOST', ex: 'smtp.gmail.com', hint: 'Your SMTP server hostname' },
    { key: 'SMTP_PORT', ex: '587', hint: 'Usually 587 (TLS) or 465 (SSL)' },
    { key: 'SMTP_USER', ex: 'you@gmail.com', hint: 'SMTP login username' },
    { key: 'SMTP_PASS', ex: '••••••••', hint: 'App password (Gmail) or SMTP password' },
    { key: 'SUPERVISOR_EMAIL', ex: 'supervisor@agency.com', hint: 'Who receives the alerts' },
  ];

  return (
    <>
      {/* Live shift alerts */}
      <AnimatePresence>
        {liveOverdue.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0 mt-1.5" />
              <div>
                <p className="text-red-800 text-sm font-semibold mb-0.5">
                  {liveOverdue.length} visit{liveOverdue.length > 1 ? 's' : ''} need immediate attention
                </p>
                <p className="text-red-700 text-sm">
                  {liveOverdue.map((v, i) => (
                    <span key={v.id}>
                      <strong>{v.client_name}</strong>
                      {' '}({isOverdue(v) === 'missed_checkin' ? 'missed check-in' : 'overdue check-out'})
                      {i < liveOverdue.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {liveDeclined.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shrink-0 mt-1.5" />
              <div>
                <p className="text-orange-800 text-sm font-semibold mb-0.5">
                  {liveDeclined.length} shift{liveDeclined.length > 1 ? 's' : ''} declined — reassignment needed
                </p>
                <p className="text-orange-700 text-sm">
                  {liveDeclined.map((v, i) => (
                    <span key={v.id}>
                      <strong>{v.client_name}</strong>
                      {' '}({new Date(v.scheduled_start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })})
                      {i < liveDeclined.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
                <p className="text-orange-600 text-xs mt-1">Use the Re-assign button in the Alert Log below.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alert log */}
      <Card title="Alert Log">
        <p className="text-slate-500 text-sm mb-4">
          Alerts fired this session (resets on server restart). Overdue alerts auto-clear when the caregiver checks in/out. Shift declined alerts clear after reassignment.
        </p>
        {!status?.alerts.length ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            No alerts fired this session — all visits are on time.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
                  {['Time', 'Client', 'Caregiver', 'Alert type', 'Reason', 'Email sent', ''].map(h => (
                    <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status.alerts.map(a => (
                  <tr key={a.visit_id} className={`border-b border-slate-50 ${a.type === 'shift_declined' ? 'bg-orange-50/30' : ''}`}>
                    <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                      {new Date(a.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{a.client_name}</td>
                    <td className="py-2.5 pr-4">{a.caregiver_name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                        a.type === 'missed_checkin' ? 'bg-red-50 text-red-700' :
                        a.type === 'shift_declined' ? 'bg-orange-100 text-orange-800' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {a.type === 'missed_checkin' ? 'Missed check-in' :
                         a.type === 'shift_declined' ? '⚑ Shift declined' :
                         'Overdue check-out'}
                      </span>
                      {a.reschedule_flag && (
                        <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 uppercase tracking-wide">
                          Reschedule
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 max-w-[180px]">
                      {a.decline_reason
                        ? <span className="text-slate-500 text-xs italic line-clamp-2">"{a.decline_reason}"</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {a.email_sent
                        ? <span className="text-emerald-600 text-xs font-medium">✓ Sent</span>
                        : <span className="text-slate-400 text-xs">Logged only</span>}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-3">
                        {a.type === 'shift_declined' && a.caregiver_id != null && a.scheduled_start && (
                          <button
                            onClick={() => setReassignAlert(a)}
                            className="text-xs font-semibold text-[#1f4e79] hover:text-[#163a5f] transition-colors whitespace-nowrap"
                          >
                            Re-assign
                          </button>
                        )}
                        <button
                          onClick={() => dismiss(a.visit_id)}
                          disabled={dismissing === a.visit_id}
                          className="text-slate-400 hover:text-slate-600 text-xs transition-colors disabled:opacity-40"
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Re-assign modal for declined shifts */}
      <AnimatePresence>
        {reassignAlert && (
          <ReassignModal
            visit={{
              id: reassignAlert.visit_id,
              client_name: reassignAlert.client_name,
              caregiver_id: reassignAlert.caregiver_id ?? 0,
              scheduled_start: reassignAlert.scheduled_start ?? '',
            } as Visit}
            caregivers={caregivers}
            onClose={() => setReassignAlert(null)}
            onSaved={() => { dismiss(reassignAlert.visit_id); setReassignAlert(null); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ---------- Approvals tab ----------

type PendingUser = {
  id: number;
  name: string;
  email: string;
  agency_id: number;
  agency_name: string;
  timezone: string;
};

function ApprovalsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const api = useApi();
  const [rows, setRows] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api('/admin/pending');
    if (data) { setRows(data); onCountChange(data.length); }
    setLoading(false);
  }, [api, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const approve = async (uid: number) => {
    setActing(uid);
    await api('/admin/approve', { method: 'POST', body: JSON.stringify({ user_id: uid }) });
    setActing(null);
    load();
  };

  const reject = async (uid: number) => {
    if (!window.confirm('Reject and delete this registration?')) return;
    setActing(uid);
    await api('/admin/reject', { method: 'POST', body: JSON.stringify({ user_id: uid }) });
    setActing(null);
    load();
  };

  if (loading) return <Card><p className="text-slate-400 text-sm">Loading…</p></Card>;

  if (rows.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="text-3xl">✅</span>
          <p className="text-slate-500 text-sm">No pending registrations.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="font-semibold text-[#1f4e79] mb-4">Pending Agency Registrations</h3>
      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.id} className="flex items-center justify-between gap-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="min-w-0">
              <p className="font-semibold text-slate-800 text-sm truncate">{r.agency_name}</p>
              <p className="text-slate-600 text-xs">{r.name} · {r.email}</p>
              <p className="text-slate-400 text-xs mt-0.5">{r.timezone}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => approve(r.id)}
                disabled={acting === r.id}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                {acting === r.id ? '…' : 'Approve'}
              </button>
              <button
                onClick={() => reject(r.id)}
                disabled={acting === r.id}
                className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Configuration tab ----------

type AppConfig = {
  agency_name: string;
  supervisor_email_override: string;
  late_start_minutes: string;
  short_visit_minutes: string;
  location_mismatch_km: string;
  alert_check_interval: string;
  smtp_configured: boolean;
  smtp_host_display: string;
  supervisor_email_display: string;
  security_token_ttl_hours: string;
  security_max_login_failures: string;
  security_lockout_minutes: string;
  security_session_window_minutes: string;
};

function ConfigTab() {
  const { apiFetch } = useApi();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [form, setForm] = useState<Partial<AppConfig>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const load = async () => {
    const res = await apiFetch('/api/config');
    if (!res.ok) return;
    const data: AppConfig = await res.json();
    setCfg(data);
    setForm({
      agency_name: data.agency_name,
      supervisor_email_override: data.supervisor_email_override,
      late_start_minutes: data.late_start_minutes,
      short_visit_minutes: data.short_visit_minutes,
      location_mismatch_km: data.location_mismatch_km,
      alert_check_interval: data.alert_check_interval,
    });
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaveState('saving');
    const res = await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setSaveState('ok');
      setSaveMsg('Settings saved.');
      await load();
    } else {
      const e = await res.json().catch(() => ({}));
      setSaveState('err');
      setSaveMsg(e.error || 'Save failed.');
    }
    setTimeout(() => setSaveState('idle'), 3000);
  };

  const sendTest = async () => {
    setTestState('sending');
    const res = await apiFetch('/api/alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) { setTestState('ok'); setTestMsg(d.message || 'Test sent!'); }
    else { setTestState('err'); setTestMsg(d.error || 'Failed to send.'); }
  };

  const field = (key: keyof AppConfig, value: string, onChange: (v: string) => void, opts?: { type?: string; placeholder?: string; min?: string; step?: string }) => (
    <input
      type={opts?.type || 'text'}
      value={value}
      placeholder={opts?.placeholder}
      min={opts?.min}
      step={opts?.step}
      onChange={e => { onChange(e.target.value); setSaveState('idle'); }}
      className={inputCls}
    />
  );

  const smtpSetup = [
    { key: 'SMTP_HOST', ex: 'smtp.gmail.com', hint: 'SMTP server hostname' },
    { key: 'SMTP_PORT', ex: '587', hint: 'Usually 587 (TLS) or 465 (SSL)' },
    { key: 'SMTP_USER', ex: 'you@gmail.com', hint: 'SMTP login username' },
    { key: 'SMTP_PASS', ex: '••••••••', hint: 'App password (Gmail) or SMTP password' },
    { key: 'SUPERVISOR_EMAIL', ex: 'supervisor@agency.com', hint: 'Who receives the alerts' },
  ];

  if (!cfg) return <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading configuration…</div>;

  return (
    <div className="space-y-6">
      {/* Agency */}
      <Card title="Agency Settings">
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Agency name</label>
            {field('agency_name', form.agency_name ?? '', v => setForm(f => ({ ...f, agency_name: v })), { placeholder: 'Sunrise Home Care' })}
            <p className="text-slate-400 text-xs mt-1">Displayed in the dashboard header and on reports.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Supervisor email override</label>
            {field('supervisor_email_override', form.supervisor_email_override ?? '', v => setForm(f => ({ ...f, supervisor_email_override: v })), { type: 'email', placeholder: 'supervisor@agency.com' })}
            <p className="text-slate-400 text-xs mt-1">Leave blank to use the SMTP default. Overrides SUPERVISOR_EMAIL for this agency.</p>
          </div>
        </div>
      </Card>

      {/* EVV Thresholds */}
      <Card title="EVV Compliance Thresholds">
        <p className="text-slate-500 text-sm mb-4">These thresholds control when a visit is flagged as an exception. Changes take effect immediately on the next check-in or check-out.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Late start (minutes)</label>
            {field('late_start_minutes', form.late_start_minutes ?? '', v => setForm(f => ({ ...f, late_start_minutes: v })), { type: 'number', min: '0', step: '1', placeholder: '15' })}
            <p className="text-slate-400 text-xs mt-1">Flag if check-in is this many minutes after scheduled start.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Short visit tolerance (minutes)</label>
            {field('short_visit_minutes', form.short_visit_minutes ?? '', v => setForm(f => ({ ...f, short_visit_minutes: v })), { type: 'number', min: '0', step: '1', placeholder: '15' })}
            <p className="text-slate-400 text-xs mt-1">Flag if actual duration is shorter than scheduled by this much.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Location mismatch (km)</label>
            {field('location_mismatch_km', form.location_mismatch_km ?? '', v => setForm(f => ({ ...f, location_mismatch_km: v })), { type: 'number', min: '0', step: '0.1', placeholder: '0.5' })}
            <p className="text-slate-400 text-xs mt-1">Flag if GPS check-in is farther than this from the client address.</p>
          </div>
        </div>
      </Card>

      {/* Email / SMTP Alerts */}
      <Card>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Email Alert Configuration</h3>
            <p className="text-slate-500 text-sm mt-0.5">Alerts fire automatically when a visit is overdue. The backend checks every {cfg.alert_check_interval}s.</p>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${cfg.smtp_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.smtp_configured ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {cfg.smtp_configured ? 'Configured' : 'Not configured'}
          </div>
        </div>

        {cfg.smtp_configured ? (
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1 mb-4">
            <div className="flex gap-3"><span className="text-slate-400 w-36">SMTP server</span><span className="text-slate-700 font-mono">{cfg.smtp_host_display}</span></div>
            <div className="flex gap-3"><span className="text-slate-400 w-36">Alert recipient</span><span className="text-slate-700 font-mono">{cfg.supervisor_email_display}</span></div>
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-slate-600 text-sm mb-3">Add these as <strong>Replit Secrets</strong> (padlock icon in the sidebar) to enable email alerts:</p>
            <div className="border border-slate-200 rounded-lg overflow-hidden text-sm">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase">Secret name</th>
                    <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase">Example value</th>
                    <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase">What it is</th>
                  </tr>
                </thead>
                <tbody>
                  {smtpSetup.map((row, i) => (
                    <tr key={row.key} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <td className="px-3 py-2 font-mono text-slate-800 text-xs">{row.key}</td>
                      <td className="px-3 py-2 font-mono text-slate-500 text-xs">{row.ex}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{row.hint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-slate-400 text-xs mt-2">For Gmail: enable 2FA, then generate an <strong>App Password</strong> at myaccount.google.com/apppasswords. Restart the server after setting secrets.</p>
          </div>
        )}

        <div className="border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700 mb-1">Send a test alert</p>
          <p className="text-slate-500 text-sm mb-3">Verify your configuration by sending a sample overdue alert email.</p>
          <div className="flex gap-2 max-w-md">
            <input
              type="email"
              placeholder={cfg.supervisor_email_display || 'supervisor@agency.com'}
              value={testEmail}
              onChange={e => { setTestEmail(e.target.value); setTestState('idle'); }}
              className={inputCls}
            />
            <button
              onClick={sendTest}
              disabled={!testEmail || testState === 'sending'}
              className={`${btnCls} shrink-0 disabled:opacity-50`}
            >
              {testState === 'sending' ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {testState === 'ok' && <p className="text-emerald-600 text-sm mt-2 font-medium">✓ {testMsg}</p>}
          {testState === 'err' && <p className="text-red-600 text-sm mt-2">{testMsg}</p>}
          {!cfg.smtp_configured && <p className="text-amber-600 text-xs mt-2">SMTP not configured — test will fail. Add Replit Secrets above first.</p>}
        </div>
      </Card>

      {/* Security (read-only) */}
      <Card title="Security Settings">
        <p className="text-slate-500 text-sm mb-4">These values are set via environment variables and shown here for reference. Edit them in your Replit Secrets or deployment config.</p>
        <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-52">Session token lifetime</span>
            <span className="text-slate-700 font-mono">{cfg.security_token_ttl_hours} hours</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-52">Max login failures before lockout</span>
            <span className="text-slate-700 font-mono">{cfg.security_max_login_failures} attempts</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-52">Lockout duration</span>
            <span className="text-slate-700 font-mono">{cfg.security_lockout_minutes} minutes</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 w-52">Failure tracking window</span>
            <span className="text-slate-700 font-mono">{cfg.security_session_window_minutes} minutes</span>
          </div>
        </div>
      </Card>

      {/* Save bar */}
      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saveState === 'saving'}
          className={`${btnCls} disabled:opacity-50`}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {saveState === 'ok' && <span className="text-emerald-600 text-sm font-medium">✓ {saveMsg}</span>}
        {saveState === 'err' && <span className="text-red-600 text-sm">{saveMsg}</span>}
      </div>
    </div>
  );
}

// ---------- Main dashboard ----------

export default function EVVDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [adminTab, setAdminTab] = useState<AdminTab>('schedule');
  const [overdueCount, setOverdueCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [historyClient, setHistoryClient] = useState<HistoryClient | null>(null);
  const [historyCaregiver, setHistoryCaregiver] = useState<HistoryCaregiver | null>(null);
  const [prefillNewVisit, setPrefillNewVisit] = useState<{ caregiverId: string; date: string; time?: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('evv_user');
    if (!stored) { navigate('/'); return; }
    setUser(JSON.parse(stored));
  }, []);

  const logout = () => {
    localStorage.removeItem('evv_token');
    localStorage.removeItem('evv_user');
    navigate('/');
  };

  if (!user) return null;

  const adminTabs: { key: AdminTab; label: string }[] = [
    { key: 'schedule', label: 'Schedule & Exceptions' },
    { key: 'weekview', label: 'Week View' },
    { key: 'newvisit', label: 'New Visit' },
    { key: 'clients', label: 'Clients' },
    { key: 'caregivers', label: 'Caregivers' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'payroll', label: 'Payroll Export' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'billing', label: 'Billing' },
    { key: 'config', label: 'Configuration' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-[#1f4e79] text-white px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold text-base">{user.agency_name || 'Dashboard'}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-white/70">{user.name} ({user.role})</span>
          <button onClick={logout} className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium">
            Log out
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {user.role === 'admin' ? (
          <>
            {/* Tabs */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {adminTabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setAdminTab(t.key)}
                  className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    adminTab === t.key
                      ? 'bg-[#1f4e79] text-white'
                      : 'bg-white border border-slate-200 text-[#1f4e79] hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                  {t.key === 'schedule' && overdueCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 shadow-sm animate-pulse">
                      {overdueCount}
                    </span>
                  )}
                  {t.key === 'approvals' && pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full px-1 shadow-sm animate-pulse">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <motion.div
              key={adminTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {adminTab === 'schedule' && <ScheduleTab onOverdueCount={setOverdueCount} onClientClick={setHistoryClient} onCaregiverClick={setHistoryCaregiver} />}
              {adminTab === 'weekview' && (
                <WeekViewTab
                  onOpenNewVisit={(caregiverId, date, time) => {
                    setPrefillNewVisit({ caregiverId, date, time });
                    setAdminTab('newvisit');
                  }}
                />
              )}
              {adminTab === 'newvisit' && <NewVisitTab prefill={prefillNewVisit} />}
              {adminTab === 'clients' && <ClientsTab onClientClick={setHistoryClient} />}
              {adminTab === 'caregivers' && <CaregiversTab onCaregiverClick={setHistoryCaregiver} />}
              {adminTab === 'invoices' && <InvoicesTab />}
              {adminTab === 'payroll' && <PayrollTab />}
              {adminTab === 'alerts' && <AlertsTab />}
              {adminTab === 'approvals' && <ApprovalsTab onCountChange={setPendingCount} />}
              {adminTab === 'billing' && <BillingTab />}
              {adminTab === 'config' && <ConfigTab />}
            </motion.div>
          </>
        ) : (
          <CaregiverView user={user} />
        )}
      </main>

      {/* Client history modal */}
      <AnimatePresence>
        {historyClient && (
          <ClientHistoryModal
            client={historyClient}
            onClose={() => setHistoryClient(null)}
          />
        )}
      </AnimatePresence>

      {/* Caregiver history modal */}
      <AnimatePresence>
        {historyCaregiver && (
          <CaregiverHistoryModal
            caregiver={historyCaregiver}
            onClose={() => setHistoryCaregiver(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
