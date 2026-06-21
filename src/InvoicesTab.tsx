import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

type Invoice = {
  id: number; invoice_number: string; client_id: number; client_name: string;
  period_start: string; period_end: string; rate_per_hour: number;
  total_hours: number; total_amount: number; status: string; created_at: string;
};
type InvoiceItem = {
  id: number; visit_id: number; hours: number; amount: number;
  scheduled_start: string; scheduled_end: string; caregiver_name: string;
};
type Client = { id: number; name: string };

function useApi() {
  const navigate = useNavigate();
  const token = localStorage.getItem('evv_token');
  return useCallback(async (path: string, opts: RequestInit = {}) => {
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
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-50 text-blue-700',
  paid: 'bg-emerald-50 text-emerald-700',
};

function InvoiceDetail({ invoiceId, onBack, onStatusChange }: { invoiceId: number; onBack: () => void; onStatusChange: () => void }) {
  const api = useApi();
  const [data, setData] = useState<{ invoice: Invoice; items: InvoiceItem[]; agency_name: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    api(`/admin/invoices/${invoiceId}`).then(d => d && setData(d));
  }, [invoiceId]);

  const updateStatus = async (status: string) => {
    setUpdating(true);
    try {
      await api(`/admin/invoices/${invoiceId}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      setData(d => d ? { ...d, invoice: { ...d.invoice, status } } : d);
      onStatusChange();
    } finally { setUpdating(false); }
  };

  if (!data) return <p className="text-slate-400 text-sm p-4">Loading…</p>;
  const { invoice, items, agency_name } = data;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to invoices
      </button>

      {/* Invoice card */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#1f4e79] text-white px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-white/60 uppercase tracking-wide mb-1">Invoice</p>
            <p className="text-2xl font-bold">{invoice.invoice_number}</p>
            <p className="text-white/70 text-sm mt-1">{agency_name}</p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-full capitalize ${
            invoice.status === 'paid' ? 'bg-emerald-400/20 text-emerald-100' :
            invoice.status === 'sent' ? 'bg-blue-300/20 text-blue-100' :
            'bg-white/10 text-white/70'
          }`}>{invoice.status}</span>
        </div>

        <div className="px-6 py-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Bill to</p>
              <p className="font-semibold text-slate-800">{invoice.client_name}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Service period</p>
              <p className="font-semibold text-slate-800">{fmt(invoice.period_start)} – {fmt(invoice.period_end)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Rate</p>
              <p className="font-semibold text-slate-800">${invoice.rate_per_hour.toFixed(2)} / hr</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Created</p>
              <p className="font-semibold text-slate-800">{fmt(invoice.created_at)}</p>
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
                <th className="pb-2 pr-4 font-medium">Date</th>
                <th className="pb-2 pr-4 font-medium">Time</th>
                <th className="pb-2 pr-4 font-medium">Caregiver</th>
                <th className="pb-2 pr-4 text-right font-medium">Hours</th>
                <th className="pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4 text-slate-700">{fmt(item.scheduled_start)}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{fmtTime(item.scheduled_start)} – {fmtTime(item.scheduled_end)}</td>
                  <td className="py-2.5 pr-4 text-slate-700">{item.caregiver_name}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-700">{item.hours.toFixed(2)}</td>
                  <td className="py-2.5 text-right font-medium text-slate-800">${item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td colSpan={3} />
                <td className="pt-3 pr-4 text-right text-sm font-semibold text-slate-600">{invoice.total_hours.toFixed(2)} hrs</td>
                <td className="pt-3 text-right text-lg font-bold text-[#1f4e79]">${invoice.total_amount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Status actions */}
          <div className="flex items-center gap-2 pt-4 border-t border-slate-100">
            <span className="text-xs text-slate-500 mr-2">Mark as:</span>
            {['draft', 'sent', 'paid'].filter(s => s !== invoice.status).map(s => (
              <button
                key={s}
                onClick={() => updateStatus(s)}
                disabled={updating}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 capitalize disabled:opacity-40 transition-colors"
              >{s}</button>
            ))}
            <button
              onClick={() => window.print()}
              className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1f4e79] text-white hover:bg-[#163a5a] transition-colors"
            >Print / Save PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenerateModal({ clients, onClose, onCreated }: { clients: Client[]; onClose: () => void; onCreated: (id: number) => void }) {
  const api = useApi();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [form, setForm] = useState({ clientId: clients[0]?.id?.toString() ?? '', periodStart: firstOfMonth, periodEnd: today, rate: '25.00' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await api('/admin/invoices', {
        method: 'POST',
        body: JSON.stringify({ client_id: Number(form.clientId), period_start: form.periodStart, period_end: form.periodEnd, rate_per_hour: Number(form.rate) }),
      });
      if (data?.id) onCreated(data.id);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Generate Invoice</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Client</label>
            <select value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30">
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Period start</label>
              <input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Period end</label>
              <input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Rate per hour ($)</label>
            <input type="number" step="0.01" min="0" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30" />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium py-2 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-[#1f4e79] disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg hover:bg-[#163a5a] transition-colors">
              {loading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InvoicesTab() {
  const api = useApi();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [inv, cl] = await Promise.all([api('/admin/invoices'), api('/clients')]);
    if (inv) setInvoices(inv.invoices);
    if (cl) setClients(cl.clients);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, []);

  if (selectedId !== null) {
    return <InvoiceDetail invoiceId={selectedId} onBack={() => setSelectedId(null)} onStatusChange={load} />;
  }

  return (
    <div className="space-y-4">
      {showModal && <GenerateModal clients={clients} onClose={() => setShowModal(false)} onCreated={(id) => { setShowModal(false); load(); setSelectedId(id); }} />}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800">Invoices</h3>
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#1f4e79] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#163a5a] transition-colors"
          >+ Generate Invoice</button>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : invoices.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-slate-400 text-sm">No invoices yet.</p>
            <p className="text-slate-400 text-xs mt-1">Generate one from completed visits.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs uppercase border-b border-slate-100">
                {['Invoice #', 'Client', 'Period', 'Hours', 'Amount', 'Status', ''].map((h, i) => (
                  <th key={i} className="pb-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="py-2.5 pr-4 font-mono text-xs font-medium text-slate-700">{inv.invoice_number}</td>
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{inv.client_name}</td>
                  <td className="py-2.5 pr-4 text-slate-500 text-xs">{fmt(inv.period_start)} – {fmt(inv.period_end)}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{inv.total_hours.toFixed(2)} hrs</td>
                  <td className="py-2.5 pr-4 font-semibold text-slate-800">${inv.total_amount.toFixed(2)}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${statusColors[inv.status] ?? 'bg-slate-100 text-slate-600'}`}>{inv.status}</span>
                  </td>
                  <td className="py-2.5">
                    <button onClick={() => setSelectedId(inv.id)} className="text-xs font-medium text-[#1f4e79] hover:underline">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
