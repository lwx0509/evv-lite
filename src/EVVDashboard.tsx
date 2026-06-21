import { useState, useEffect, useCallback, useRef } from 'react';
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

type User = { id: number; name: string; role: string; agency_id: number };
type Visit = {
  id: number; client_id: number; client_name: string; client_address: string;
  caregiver_id: number; caregiver_name: string;
  scheduled_start: string; scheduled_end: string; status: string;
  check_in_time: string | null; check_out_time: string | null; exception_flags: string | null;
  notes: string | null;
};
type Client = { id: number; name: string; address: string; payer_type: string; lat: number | null; lng: number | null };
type Caregiver = { id: number; name: string; email: string; employee_id: string | null };
type Exception = { client_name: string; caregiver_name: string; scheduled_start: string; exception_flags: string };

type AdminTab = 'schedule' | 'newvisit' | 'clients' | 'caregivers' | 'payroll' | 'alerts' | 'approvals' | 'invoices' | 'billing';
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

  if (loading) return <Card><p className="text-slate-400 text-sm">Loading…</p></Card>;

  return (
    <>
      {/* Overdue alert banner */}
      <AnimatePresence>
        {overdueVisits.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
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

      <Card>
        {/* Card header with refresh controls */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800">Schedule</h3>
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
              {visits.length === 0 ? (
                <tr><td colSpan={7} className="pt-4 text-slate-400">No visits scheduled.</td></tr>
              ) : visits.map(v => {
                const overdueType = isOverdue(v);
                return (
                  <tr
                    key={v.id}
                    className={`border-b transition-colors ${
                      overdueType
                        ? 'bg-red-50/60 border-red-100 hover:bg-red-50'
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
        <p className="text-[11px] text-slate-300 mt-3">Auto-refreshes every 30 seconds</p>
      </Card>

      <Card title="Exceptions">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                {['Client', 'Caregiver', 'Scheduled', 'Flags'].map(h => (
                  <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exceptions.length === 0 ? (
                <tr><td colSpan={4} className="pt-4 text-slate-400">No exceptions. ✅</td></tr>
              ) : exceptions.map((e, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4">{e.client_name}</td>
                  <td className="py-2.5 pr-4">{e.caregiver_name}</td>
                  <td className="py-2.5 pr-4">{formatTime(e.scheduled_start)}</td>
                  <td className="py-2.5">{e.exception_flags.split(',').map(f => <FlagBadge key={f} flag={f} />)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function NewVisitTab() {
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
      if (g) { setCaregivers(g.caregivers); if (g.caregivers[0]) setForm(f => ({ ...f, caregiverId: String(g.caregivers[0].id) })); }
    });
  }, []);

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
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">When</p>
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

function CaregiversTab({ onCaregiverClick }: { onCaregiverClick: (c: HistoryCaregiver) => void }) {
  const api = useApi();
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: 'caregiver123', employee_id: '' });
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editMsg, setEditMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api('/caregivers').then(d => d && setCaregivers(d.caregivers));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    try {
      await api('/caregivers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', password: 'caregiver123', employee_id: '' });
      load();
    } catch (err: any) { setMsg(err.message); }
  };

  const startEdit = (c: Caregiver) => {
    setEditingId(c.id);
    setEditVal(c.employee_id || '');
    setEditMsg('');
  };

  const saveEdit = async (c: Caregiver) => {
    if (!editVal.trim()) { setEditMsg('Employee ID cannot be empty'); return; }
    setSaving(true); setEditMsg('');
    try {
      await api(`/caregivers/${c.id}`, { method: 'PATCH', body: JSON.stringify({ employee_id: editVal.trim() }) });
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
          {msg && <p className="text-red-600 text-sm">{msg}</p>}
          <button type="submit" className={btnCls}>Add Caregiver</button>
        </form>
      </Card>
      <Card title="Caregivers">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
            {['Employee ID', 'Name', 'Email', ''].map(h => <th key={h} className="pb-2 pr-4 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {caregivers.length === 0
              ? <tr><td colSpan={4} className="pt-4 text-slate-400">No caregivers yet.</td></tr>
              : caregivers.map(c => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4 w-36">
                    {editingId === c.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') setEditingId(null); }}
                          className="border border-slate-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-[#1f4e79]"
                          autoFocus
                        />
                        {editMsg && <span className="text-red-500 text-xs">{editMsg}</span>}
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(c)} disabled={saving} className="text-xs bg-[#1f4e79] text-white px-2 py-0.5 rounded hover:bg-[#163a5f] disabled:opacity-50">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 px-2 py-0.5 rounded hover:bg-slate-100">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(c)}
                        title="Click to edit Employee ID"
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
                  <td className="py-2.5 text-slate-400 text-xs">
                    <button onClick={() => startEdit(c)} className="hover:text-[#1f4e79]" title="Edit Employee ID">✏️</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
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
              <tr key={v.id} className="border-b border-slate-50 last:border-0">
                <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                  {formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}
                </td>
                <td className="py-3 pr-4 font-medium text-slate-800">{v.client_name}</td>
                <td className="py-3 pr-4 text-slate-500 max-w-[200px] truncate">{v.client_address}</td>
                <td className="py-3 pr-4"><StatusBadge status={v.status} /></td>
                <td className="py-3">
                  {v.status === 'scheduled' && (
                    <button onClick={() => checkin(v.id)} className={btnCls}>Check In</button>
                  )}
                  {v.status === 'in_progress' && (
                    <button onClick={() => checkout(v.id)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">Check Out</button>
                  )}
                  {v.status === 'completed' && <span className="text-slate-400 text-sm">✓ Done</span>}
                  {msgs[v.id] && <p className="text-red-600 text-xs mt-1">{msgs[v.id]}</p>}
                </td>
              </tr>
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
  type: 'missed_checkin' | 'overdue_checkout';
  sent_at: string;
  client_name: string;
  caregiver_name: string;
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

  const load = () => api('/alerts/status').then(d => { if (d) setStatus(d); setLoading(false); });
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
      {/* Config status */}
      <Card>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Email Alert Configuration</h3>
            <p className="text-slate-500 text-sm mt-0.5">
              Alerts fire automatically when a visit is overdue. The backend checks every 60 seconds.
            </p>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
            status?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status?.configured ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {status?.configured ? 'Configured' : 'Not configured'}
          </div>
        </div>

        {status?.configured ? (
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex gap-3"><span className="text-slate-400 w-36">SMTP server</span><span className="text-slate-700 font-mono">{status.smtp_host}</span></div>
            <div className="flex gap-3"><span className="text-slate-400 w-36">Alert recipient</span><span className="text-slate-700 font-mono">{status.supervisor_email_masked}</span></div>
          </div>
        ) : (
          <div>
            <p className="text-slate-600 text-sm mb-3">
              Add these as <strong>Replit Secrets</strong> (padlock icon in the sidebar) to enable email alerts:
            </p>
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
            <p className="text-slate-400 text-xs mt-2">
              For Gmail: enable 2FA, then generate an <strong>App Password</strong> at myaccount.google.com/apppasswords.
              Restart the server after setting secrets.
            </p>
          </div>
        )}
      </Card>

      {/* Test alert */}
      <Card title="Send a Test Alert">
        <p className="text-slate-500 text-sm mb-3">Verify your configuration by sending a sample overdue alert email.</p>
        <div className="flex gap-2 max-w-md">
          <input
            type="email"
            placeholder={status?.supervisor_email_masked || 'supervisor@agency.com'}
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
        {!status?.configured && (
          <p className="text-amber-600 text-xs mt-2">SMTP not configured — test will fail. Add Replit Secrets above first.</p>
        )}
      </Card>

      {/* Alert log */}
      <Card title="Alert Log">
        <p className="text-slate-500 text-sm mb-4">
          Alerts fired this session (resets on server restart). Alerts auto-clear when the caregiver checks in/out.
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
                  {['Time', 'Client', 'Caregiver', 'Alert type', 'Email sent', ''].map(h => (
                    <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status.alerts.map(a => (
                  <tr key={a.visit_id} className="border-b border-slate-50">
                    <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                      {new Date(a.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{a.client_name}</td>
                    <td className="py-2.5 pr-4">{a.caregiver_name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                        a.type === 'missed_checkin'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {a.type === 'missed_checkin' ? 'Missed check-in' : 'Overdue check-out'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      {a.email_sent
                        ? <span className="text-emerald-600 text-xs font-medium">✓ Sent</span>
                        : <span className="text-slate-400 text-xs">Logged only</span>}
                    </td>
                    <td className="py-2.5">
                      <button
                        onClick={() => dismiss(a.visit_id)}
                        disabled={dismissing === a.visit_id}
                        className="text-slate-400 hover:text-slate-600 text-xs transition-colors disabled:opacity-40"
                      >
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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

// ---------- Main dashboard ----------

export default function EVVDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [adminTab, setAdminTab] = useState<AdminTab>('schedule');
  const [overdueCount, setOverdueCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [historyClient, setHistoryClient] = useState<HistoryClient | null>(null);
  const [historyCaregiver, setHistoryCaregiver] = useState<HistoryCaregiver | null>(null);

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
    { key: 'newvisit', label: 'New Visit' },
    { key: 'clients', label: 'Clients' },
    { key: 'caregivers', label: 'Caregivers' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'payroll', label: 'Payroll Export' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'billing', label: 'Billing' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-[#1f4e79] text-white px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-white/20 flex items-center justify-center font-bold text-sm">E</div>
          <h1 className="font-semibold text-base">Visiting Systems — Sunrise Home Care</h1>
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
              {adminTab === 'newvisit' && <NewVisitTab />}
              {adminTab === 'clients' && <ClientsTab onClientClick={setHistoryClient} />}
              {adminTab === 'caregivers' && <CaregiversTab onCaregiverClick={setHistoryCaregiver} />}
              {adminTab === 'invoices' && <InvoicesTab />}
              {adminTab === 'payroll' && <PayrollTab />}
              {adminTab === 'alerts' && <AlertsTab />}
              {adminTab === 'approvals' && <ApprovalsTab onCountChange={setPendingCount} />}
              {adminTab === 'billing' && <BillingTab />}
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
