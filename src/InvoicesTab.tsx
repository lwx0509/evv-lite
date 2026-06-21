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
type UnbilledVisit = {
  id: number; scheduled_start: string; scheduled_end: string;
  check_in_time: string | null; check_out_time: string | null;
  client_name: string; client_id: number; caregiver_name: string; hours: number;
};

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- Invoice Detail ----------

function InvoiceDetail({ invoiceId, onBack, onStatusChange }: {
  invoiceId: number; onBack: () => void; onStatusChange: () => void;
}) {
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
  const isPaid = invoice.status === 'paid';

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to invoices
      </button>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-[#1f4e79] text-white px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-white/60 uppercase tracking-wide mb-1">Invoice</p>
            <p className="text-2xl font-bold">{invoice.invoice_number}</p>
            <p className="text-white/70 text-sm mt-1">{agency_name}</p>
          </div>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wide ${
            isPaid ? 'bg-emerald-400/25 text-emerald-100' : 'bg-white/15 text-white/80'
          }`}>{isPaid ? 'Paid' : 'Unpaid'}</span>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div><p className="text-slate-400 text-xs mb-0.5">Bill to</p><p className="font-semibold text-slate-800">{invoice.client_name}</p></div>
            <div><p className="text-slate-400 text-xs mb-0.5">Service period</p><p className="font-semibold text-slate-800">{fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}</p></div>
            <div><p className="text-slate-400 text-xs mb-0.5">Rate</p><p className="font-semibold text-slate-800">${invoice.rate_per_hour.toFixed(2)} / hr</p></div>
            <div><p className="text-slate-400 text-xs mb-0.5">Created</p><p className="font-semibold text-slate-800">{fmtDate(invoice.created_at)}</p></div>
          </div>

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
                  <td className="py-2.5 pr-4 text-slate-700">{fmtDate(item.scheduled_start)}</td>
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

          <div className="flex items-center gap-2 pt-4 border-t border-slate-100">
            {isPaid ? (
              <button onClick={() => updateStatus('draft')} disabled={updating}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors">
                Mark as Unpaid
              </button>
            ) : (
              <button onClick={() => updateStatus('paid')} disabled={updating}
                className="text-xs font-bold px-4 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                ✓ Mark as Paid
              </button>
            )}
            <button onClick={() => window.print()}
              className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1f4e79] text-white hover:bg-[#163a5a] transition-colors">
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Rate modal (per-visit invoicing) ----------

function RateModal({ visit, onClose, onCreated }: {
  visit: UnbilledVisit; onClose: () => void; onCreated: (id: number) => void;
}) {
  const api = useApi();
  const [rate, setRate] = useState('25.00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const amount = (parseFloat(rate) || 0) * visit.hours;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await api('/admin/invoices', {
        method: 'POST',
        body: JSON.stringify({ visit_ids: [visit.id], rate_per_hour: parseFloat(rate) }),
      });
      if (data?.id) onCreated(data.id);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xs" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Generate Invoice</h3>
        <p className="text-xs text-slate-500 mb-4">{visit.client_name} · {fmtDay(visit.scheduled_start)}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Rate per hour ($)</label>
            <input type="number" step="0.01" min="0" value={rate} required autoFocus
              onChange={e => setRate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30" />
          </div>
          <div className="flex items-center justify-between text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
            <span>{visit.hours.toFixed(2)} hrs</span>
            <span className="font-bold text-[#1f4e79]">${amount.toFixed(2)}</span>
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium py-2 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-[#1f4e79] disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg hover:bg-[#163a5a] transition-colors">
              {loading ? 'Creating…' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Main tab ----------

export function InvoicesTab() {
  const api = useApi();
  const [unbilled, setUnbilled] = useState<UnbilledVisit[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [rateTarget, setRateTarget] = useState<UnbilledVisit | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [inv, unb] = await Promise.all([
      api('/admin/invoices'),
      api('/admin/unbilled-visits'),
    ]);
    if (inv)  setInvoices(inv.invoices ?? []);
    if (unb)  setUnbilled(unb.visits ?? []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, []);

  const togglePaid = async (inv: Invoice) => {
    const next = inv.status === 'paid' ? 'draft' : 'paid';
    setTogglingId(inv.id);
    try {
      await api(`/admin/invoices/${inv.id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
      setInvoices(list => list.map(i => i.id === inv.id ? { ...i, status: next } : i));
    } finally { setTogglingId(null); }
  };

  if (selectedId !== null) {
    return <InvoiceDetail invoiceId={selectedId} onBack={() => setSelectedId(null)} onStatusChange={load} />;
  }

  return (
    <div className="space-y-6">
      {rateTarget && (
        <RateModal
          visit={rateTarget}
          onClose={() => setRateTarget(null)}
          onCreated={(id) => { setRateTarget(null); load(); setSelectedId(id); }}
        />
      )}

      {/* ── Unbilled Visits ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Unbilled Visits</h3>
            <p className="text-xs text-slate-400 mt-0.5">Completed visits with no invoice yet</p>
          </div>
          {!loading && unbilled.length > 0 && (
            <span className="text-xs font-semibold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
              {unbilled.length} pending
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm px-5 py-6">Loading…</p>
        ) : unbilled.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-2xl mb-2">✓</div>
            <p className="text-slate-500 text-sm font-medium">All visits are invoiced</p>
            <p className="text-slate-400 text-xs mt-1">No unbilled completed visits.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {unbilled.map(v => (
              <div key={v.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{v.client_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {fmtDay(v.scheduled_start)} · {fmtTime(v.scheduled_start)}–{fmtTime(v.scheduled_end)} · {v.caregiver_name}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-700">{v.hours.toFixed(2)} hrs</p>
                </div>
                <button
                  onClick={() => setRateTarget(v)}
                  className="shrink-0 bg-[#1f4e79] hover:bg-[#163a5a] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  Invoice
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Invoices List ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">Invoices</h3>
          <p className="text-xs text-slate-400 mt-0.5">Click the badge to toggle paid/unpaid</p>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm px-5 py-6">Loading…</p>
        ) : invoices.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-slate-400 text-sm">No invoices yet.</p>
            <p className="text-slate-400 text-xs mt-1">Generate one from an unbilled visit above.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {invoices.map(inv => {
              const isPaid = inv.status === 'paid';
              const toggling = togglingId === inv.id;
              return (
                <div key={inv.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs font-medium text-slate-500">{inv.invoice_number}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 truncate">{inv.client_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(inv.period_start)} – {fmtDate(inv.period_end)} · {inv.total_hours.toFixed(2)} hrs
                    </p>
                  </div>

                  <p className="text-base font-bold text-slate-800 shrink-0">${inv.total_amount.toFixed(2)}</p>

                  {/* Clickable PAID / UNPAID badge */}
                  <button
                    onClick={() => togglePaid(inv)}
                    disabled={toggling}
                    title={isPaid ? 'Click to mark unpaid' : 'Click to mark paid'}
                    className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide transition-colors disabled:opacity-50 ${
                      isPaid
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {toggling ? '…' : isPaid ? 'Paid' : 'Unpaid'}
                  </button>

                  <button
                    onClick={() => setSelectedId(inv.id)}
                    className="shrink-0 text-xs font-medium text-[#1f4e79] hover:underline"
                  >
                    View
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
