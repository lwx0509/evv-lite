import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

type User = { id: number; name: string; role: string; agency_id: number };
type Visit = {
  id: number; client_name: string; client_address: string; caregiver_name: string;
  scheduled_start: string; scheduled_end: string; status: string;
  check_in_time: string | null; check_out_time: string | null; exception_flags: string | null;
};
type Client = { id: number; name: string; address: string; payer_type: string; lat: number | null; lng: number | null };
type Caregiver = { id: number; name: string; email: string };
type Exception = { client_name: string; caregiver_name: string; scheduled_start: string; exception_flags: string };

type AdminTab = 'schedule' | 'newvisit' | 'clients' | 'caregivers' | 'payroll';

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

function ScheduleTab() {
  const api = useApi();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api('/visits'), api('/exceptions')]).then(([v, e]) => {
      if (v) setVisits(v.visits);
      if (e) setExceptions(e.exceptions);
      setLoading(false);
    });
  }, []);

  if (loading) return <Card><p className="text-slate-400 text-sm">Loading…</p></Card>;

  return (
    <>
      <Card title="Schedule">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                {['Time', 'Client', 'Caregiver', 'Status', 'Checked In', 'Checked Out', 'Flags'].map(h => (
                  <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visits.length === 0 ? (
                <tr><td colSpan={7} className="pt-4 text-slate-400">No visits scheduled.</td></tr>
              ) : visits.map(v => (
                <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2.5 pr-4 whitespace-nowrap">{formatTime(v.scheduled_start)} – {formatTime(v.scheduled_end)}</td>
                  <td className="py-2.5 pr-4">{v.client_name}</td>
                  <td className="py-2.5 pr-4">{v.caregiver_name}</td>
                  <td className="py-2.5 pr-4"><StatusBadge status={v.status} /></td>
                  <td className="py-2.5 pr-4">{formatTime(v.check_in_time)}</td>
                  <td className="py-2.5 pr-4">{formatTime(v.check_out_time)}</td>
                  <td className="py-2.5">{(v.exception_flags || '').split(',').filter(Boolean).map(f => <FlagBadge key={f} flag={f} />)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            {['Name', 'Address', 'Payer', 'Coordinates'].map(h => <th key={h} className="pb-2 pr-4 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {clients.length === 0 ? <tr><td colSpan={4} className="pt-4 text-slate-400">No clients yet.</td></tr>
              : clients.map(c => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4">{c.name}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{c.address || '—'}</td>
                  <td className="py-2.5 pr-4">{c.payer_type}</td>
                  <td className="py-2.5 text-slate-500">{c.lat != null ? `${c.lat}, ${c.lng}` : '—'}</td>
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

// ---------- Main dashboard ----------

export default function EVVDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [adminTab, setAdminTab] = useState<AdminTab>('schedule');

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
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    adminTab === t.key
                      ? 'bg-[#1f4e79] text-white'
                      : 'bg-white border border-slate-200 text-[#1f4e79] hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <motion.div
              key={adminTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {adminTab === 'schedule' && <ScheduleTab />}
              {adminTab === 'newvisit' && <NewVisitTab />}
              {adminTab === 'clients' && <ClientsTab />}
              {adminTab === 'caregivers' && <CaregiversTab />}
              {adminTab === 'payroll' && <PayrollTab />}
            </motion.div>
          </>
        ) : (
          <CaregiverView user={user} />
        )}
      </main>
    </div>
  );
}
