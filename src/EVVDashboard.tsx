import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const REFRESH_INTERVAL = 30_000;

function isOverdue(v: Visit): false | 'missed_checkin' | 'overdue_checkout' {
  const now = Date.now();
  if (v.status === 'scheduled' && new Date(v.scheduled_start).getTime() < now) return 'missed_checkin';
  if (v.status === 'in_progress' && new Date(v.scheduled_end).getTime() < now) return 'overdue_checkout';
  return false;
}

type User = { id: number; name: string; role: string; agency_id: number };
type Visit = {
  id: number; client_name: string; client_address: string; caregiver_name: string;
  scheduled_start: string; scheduled_end: string; status: string;
  check_in_time: string | null; check_out_time: string | null; exception_flags: string | null;
  notes: string | null;
};
type Client = { id: number; name: string; address: string; payer_type: string; lat: number | null; lng: number | null };
type Caregiver = { id: number; name: string; email: string };
type Exception = { client_name: string; caregiver_name: string; scheduled_start: string; exception_flags: string };

type AdminTab = 'schedule' | 'newvisit' | 'clients' | 'caregivers' | 'payroll' | 'alerts';

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

function ScheduleTab({ onOverdueCount }: { onOverdueCount: (n: number) => void }) {
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
                    <td className="py-2.5 pr-4">{v.client_name}</td>
                    <td className="py-2.5 pr-4">{v.caregiver_name}</td>
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

function NewVisitTab() {
  const api = useApi();
  const [clients, setClients] = useState<Client[]>([]);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [form, setForm] = useState({ clientId: '', caregiverId: '', date: new Date().toISOString().slice(0, 10), start: '09:00', end: '10:00' });
  const [msg, setMsg] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    Promise.all([api('/clients'), api('/caregivers')]).then(([c, g]) => {
      if (c) { setClients(c.clients); if (c.clients[0]) setForm(f => ({ ...f, clientId: String(c.clients[0].id) })); }
      if (g) { setCaregivers(g.caregivers); if (g.caregivers[0]) setForm(f => ({ ...f, caregiverId: String(g.caregivers[0].id) })); }
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/visits', { method: 'POST', body: JSON.stringify({
        client_id: Number(form.clientId), caregiver_id: Number(form.caregiverId),
        scheduled_start: `${form.date}T${form.start}:00`, scheduled_end: `${form.date}T${form.end}:00`,
      })});
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) { setMsg(err.message); }
  };

  return (
    <Card title="Schedule a New Visit">
      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <FormField label="Client">
          <select value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} required className={selectCls}>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Caregiver">
          <select value={form.caregiverId} onChange={e => setForm(f => ({ ...f, caregiverId: e.target.value }))} required className={selectCls}>
            {caregivers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Date">
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required className={inputCls} />
        </FormField>
        <div className="flex gap-3">
          <FormField label="Start">
            <input type="time" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} required className={inputCls} />
          </FormField>
          <FormField label="End">
            <input type="time" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} required className={inputCls} />
          </FormField>
        </div>
        {msg && <p className="text-red-600 text-sm">{msg}</p>}
        {success && <p className="text-emerald-600 text-sm font-medium">Visit scheduled!</p>}
        <button type="submit" className={btnCls}>Create Visit</button>
      </form>
    </Card>
  );
}

function ClientsTab() {
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
                  <td className="py-2.5 pr-4">{c.name}</td>
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

function CaregiversTab() {
  const api = useApi();
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: 'caregiver123' });
  const [msg, setMsg] = useState('');

  const load = () => api('/caregivers').then(d => d && setCaregivers(d.caregivers));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    try {
      await api('/caregivers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', password: 'caregiver123' });
      load();
    } catch (err: any) { setMsg(err.message); }
  };

  return (
    <>
      <Card title="Add Caregiver">
        <form onSubmit={submit} className="space-y-3 max-w-sm">
          <FormField label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} /></FormField>
          <FormField label="Email"><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className={inputCls} /></FormField>
          <FormField label="Temporary Password"><input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required className={inputCls} /></FormField>
          {msg && <p className="text-red-600 text-sm">{msg}</p>}
          <button type="submit" className={btnCls}>Add Caregiver</button>
        </form>
      </Card>
      <Card title="Caregivers">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
            {['Name', 'Email'].map(h => <th key={h} className="pb-2 pr-4 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {caregivers.length === 0 ? <tr><td colSpan={2} className="pt-4 text-slate-400">No caregivers yet.</td></tr>
              : caregivers.map(c => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4">{c.name}</td>
                  <td className="py-2.5 text-slate-500">{c.email}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function PayrollTab() {
  const token = localStorage.getItem('evv_token');
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [msg, setMsg] = useState('');

  const exportCsv = async () => {
    setMsg('');
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
    } catch (err: any) { setMsg(err.message); }
  };

  return (
    <Card title="Payroll Export">
      <p className="text-slate-500 text-sm mb-4">Export completed visits as a CSV for payroll processing.</p>
      <div className="flex gap-4 items-end max-w-sm">
        <FormField label="Start date"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></FormField>
        <FormField label="End date"><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} /></FormField>
      </div>
      {msg && <p className="text-red-600 text-sm mt-2">{msg}</p>}
      <button onClick={exportCsv} className={`${btnCls} mt-4`}>Download CSV</button>
    </Card>
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
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">My Visits Today</h2>
      {visits.length === 0 ? (
        <Card><p className="text-slate-400 text-sm">No visits scheduled.</p></Card>
      ) : visits.map(v => (
        <Card key={v.id}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-800">{v.client_name}</p>
              <p className="text-slate-500 text-sm">{v.client_address}</p>
              <p className="text-slate-500 text-sm mt-1">{formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}</p>
              <div className="mt-2"><StatusBadge status={v.status} /></div>
            </div>
            <div className="shrink-0">
              {v.status === 'scheduled' && (
                <button onClick={() => checkin(v.id)} className={btnCls}>Check In</button>
              )}
              {v.status === 'in_progress' && (
                <button onClick={() => checkout(v.id)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">Check Out</button>
              )}
              {v.status === 'completed' && <span className="text-slate-400 text-sm">Done</span>}
            </div>
          </div>
          {msgs[v.id] && <p className="text-red-600 text-sm mt-2">{msgs[v.id]}</p>}
        </Card>
      ))}
    </div>
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

// ---------- Main dashboard ----------

export default function EVVDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [adminTab, setAdminTab] = useState<AdminTab>('schedule');
  const [overdueCount, setOverdueCount] = useState(0);

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
    { key: 'payroll', label: 'Payroll Export' },
    { key: 'alerts', label: 'Alerts' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-[#1f4e79] text-white px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-white/20 flex items-center justify-center font-bold text-sm">E</div>
          <h1 className="font-semibold text-base">EVV-lite — Sunrise Home Care</h1>
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
                </button>
              ))}
            </div>

            <motion.div
              key={adminTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {adminTab === 'schedule' && <ScheduleTab onOverdueCount={setOverdueCount} />}
              {adminTab === 'newvisit' && <NewVisitTab />}
              {adminTab === 'clients' && <ClientsTab />}
              {adminTab === 'caregivers' && <CaregiversTab />}
              {adminTab === 'payroll' && <PayrollTab />}
              {adminTab === 'alerts' && <AlertsTab />}
            </motion.div>
          </>
        ) : (
          <CaregiverView user={user} />
        )}
      </main>
    </div>
  );
}
