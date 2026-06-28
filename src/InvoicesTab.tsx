import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

type Invoice = {
  id: number; invoice_number: string; client_id: number; client_name: string;
  period_start: string; period_end: string; rate_per_hour: number;
  total_hours: number; total_amount: number; status: string; created_at: string;
  paid_at: string | null;
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

const SAVED_EMAILS_KEY = 'evv_saved_invoice_emails';

function getSavedEmails(): string[] {
  try { return JSON.parse(localStorage.getItem(SAVED_EMAILS_KEY) || '[]'); }
  catch { return []; }
}
function saveEmail(email: string) {
  const list = getSavedEmails();
  if (!list.includes(email)) {
    localStorage.setItem(SAVED_EMAILS_KEY, JSON.stringify([email, ...list].slice(0, 20)));
  }
}
function removeSavedEmail(email: string) {
  const list = getSavedEmails().filter(e => e !== email);
  localStorage.setItem(SAVED_EMAILS_KEY, JSON.stringify(list));
}

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

// ── Export modal ──────────────────────────────────────────────────────────────

type ExportFilter = 'all' | 'paid' | 'unpaid';
type ExportRow = {
  invoice_number: string; client_name: string;
  period_start: string; period_end: string;
  total_hours: number; rate_per_hour: number; total_amount: number;
  status: string; invoice_date: string; payment_date: string;
};

const FILTER_OPTS: { value: ExportFilter; label: string }[] = [
  { value: 'all',    label: 'All Invoices' },
  { value: 'paid',   label: 'Paid Only'    },
  { value: 'unpaid', label: 'Unpaid Only'  },
];

function ExportModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [filter,    setFilter]    = useState<ExportFilter>('paid');
  const [rows,      setRows]      = useState<ExportRow[] | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [dlLoading, setDlLoading] = useState(false);
  const [error,     setError]     = useState('');

  const load = useCallback(async (f: ExportFilter) => {
    setLoading(true); setError(''); setRows(null);
    try {
      const res = await fetch(`/api/admin/invoices/export?filter=${f}&format=json`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load preview');
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(filter); }, [filter]);

  const download = async () => {
    setDlLoading(true);
    try {
      const res = await fetch(`/api/admin/invoices/export?filter=${filter}&format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `invoices_${filter}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
    finally { setDlLoading(false); }
  };

  const totalAmount = rows?.reduce((s, r) => s + r.total_amount, 0) ?? 0;
  const totalHours  = rows?.reduce((s, r) => s + r.total_hours,  0) ?? 0;

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl mb-10" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Export Invoices</h3>
            <p className="text-xs text-slate-400 mt-0.5">Preview before downloading</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Filter tabs + summary */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 gap-4">
          <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs font-medium shrink-0">
            {FILTER_OPTS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-4 py-2 transition-colors ${filter === opt.value ? 'bg-[#1f4e79] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              >{opt.label}</button>
            ))}
          </div>

          {rows && rows.length > 0 && (
            <div className="flex items-center gap-6 text-xs text-slate-500">
              <span><span className="font-bold text-slate-700">{rows.length}</span> invoice{rows.length !== 1 ? 's' : ''}</span>
              <span><span className="font-bold text-slate-700">{totalHours.toFixed(2)}</span> hrs</span>
              <span className="font-bold text-[#1f4e79] text-sm">${totalAmount.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Table preview */}
        <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading preview…</div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">{error}</div>
          ) : rows && rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-sm gap-1">
              <span>No invoices match this filter.</span>
            </div>
          ) : rows ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="text-left text-slate-500 uppercase tracking-wide text-[10px] border-b border-slate-200">
                  {['Invoice #','Client','Period','Hours','Rate/hr','Amount','Status','Invoice Date','Payment Date'].map(h => (
                    <th key={h} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isPaid = r.status === 'paid';
                  return (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-2.5 font-mono font-medium text-slate-700 whitespace-nowrap">{r.invoice_number}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{r.client_name}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.period_start} – {r.period_end}</td>
                      <td className="px-4 py-2.5 text-slate-700 text-right tabular-nums">{r.total_hours.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-slate-700 text-right tabular-nums">${r.rate_per_hour.toFixed(2)}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-800 text-right tabular-nums">${r.total_amount.toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {isPaid ? 'Paid' : 'Unpaid'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.invoice_date || '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {r.payment_date
                          ? <span className="text-emerald-600 font-medium">{r.payment_date}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 1 && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-200 sticky bottom-0">
                  <tr>
                    <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-slate-500">Total</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-700 tabular-nums">{totalHours.toFixed(2)}</td>
                    <td />
                    <td className="px-4 py-2.5 text-right font-bold text-[#1f4e79] tabular-nums">${totalAmount.toFixed(2)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 gap-3">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
          <button
            onClick={download}
            disabled={dlLoading || !rows || rows.length === 0}
            className="flex items-center gap-2 bg-[#1f4e79] hover:bg-[#163a5a] disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {dlLoading ? 'Downloading…' : `Download CSV${rows ? ` (${rows.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Print modal ──────────────────────────────────────────────────────────────

function PrintModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Print Invoice</h3>
        <p className="text-xs text-slate-400 mb-5">Choose how you'd like to output this invoice</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => { onClose(); setTimeout(() => window.print(), 150); }}
            className="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-[#1f4e79] bg-[#1f4e79]/5 hover:bg-[#1f4e79]/10 transition-colors text-center"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1f4e79" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <div>
              <p className="text-sm font-semibold text-[#1f4e79]">Save as PDF</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Download to device</p>
            </div>
          </button>
          <button
            onClick={() => { onClose(); setTimeout(() => window.print(), 150); }}
            className="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-center"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            <div>
              <p className="text-sm font-semibold text-slate-700">Send to Printer</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Physical / network printer</p>
            </div>
          </button>
        </div>
        <p className="text-[11px] text-slate-400 text-center mb-4">
          Your system's print dialog will open — select "Save as PDF" or choose a printer from the list.
        </p>
        <button onClick={onClose} className="w-full text-sm text-slate-400 py-1 hover:text-slate-600 transition-colors">Cancel</button>
      </div>
    </div>
  );
}

// ── Email modal ───────────────────────────────────────────────────────────────

function EmailModal({ invoiceId, invoiceNumber, clientName, onClose }: {
  invoiceId: number; invoiceNumber: string; clientName: string; onClose: () => void;
}) {
  const api = useApi();
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState<string[]>(() => getSavedEmails());
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [sent, setSent]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!to) return;
    setError(''); setLoading(true);
    try {
      await api(`/admin/invoices/${invoiceId}/email`, {
        method: 'POST',
        body: JSON.stringify({ to_email: to }),
      });
      saveEmail(to);
      setSaved(getSavedEmails());
      setSent(true);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const pickSaved = (addr: string) => {
    setEmail(addr);
    inputRef.current?.focus();
  };

  const deleteSaved = (addr: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    removeSavedEmail(addr);
    setSaved(getSavedEmails());
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p className="text-base font-semibold text-slate-800 mb-1">Invoice sent!</p>
            <p className="text-sm text-slate-400 mb-5">{invoiceNumber} emailed to <span className="font-medium text-slate-600">{email}</span></p>
            <button onClick={onClose} className="w-full bg-[#1f4e79] text-white text-sm font-medium py-2.5 rounded-xl hover:bg-[#163a5a] transition-colors">Done</button>
          </div>
        ) : (
          <>
            <h3 className="text-base font-semibold text-slate-800 mb-0.5">Email Invoice</h3>
            <p className="text-xs text-slate-400 mb-4">{invoiceNumber} · {clientName}</p>

            {saved.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-slate-500 mb-2">Saved addresses</p>
                <div className="flex flex-wrap gap-1.5">
                  {saved.map(addr => (
                    <div key={addr} className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 rounded-full pl-3 pr-1 py-1 cursor-pointer group transition-colors"
                      onClick={() => pickSaved(addr)}>
                      <span className="text-xs text-slate-700 font-medium">{addr}</span>
                      <button
                        onClick={ev => deleteSaved(addr, ev)}
                        className="w-4 h-4 rounded-full bg-slate-300 hover:bg-red-400 flex items-center justify-center text-slate-600 hover:text-white transition-colors ml-0.5"
                        title="Remove saved address"
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={send} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Send to</label>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="client@example.com"
                  required
                  autoFocus={saved.length === 0}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30 focus:border-transparent"
                />
              </div>
              {error && <p className="text-red-600 text-xs">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !email.trim()}
                  className="flex-1 bg-[#1f4e79] disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-[#163a5a] transition-colors">
                  {loading ? 'Sending…' : 'Send Email'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── Invoice Detail ────────────────────────────────────────────────────────────

function InvoiceDetail({ invoiceId, onBack, onStatusChange }: {
  invoiceId: number; onBack: () => void; onStatusChange: () => void;
}) {
  const api = useApi();
  const [data, setData] = useState<{ invoice: Invoice; items: InvoiceItem[]; agency_name: string } | null>(null);
  const [updating, setUpdating]     = useState(false);
  const [showPrint, setShowPrint]   = useState(false);
  const [showEmail, setShowEmail]   = useState(false);

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
    <>
      {showPrint && <PrintModal onClose={() => setShowPrint(false)} />}
      {showEmail && (
        <EmailModal
          invoiceId={invoiceId}
          invoiceNumber={invoice.invoice_number}
          clientName={invoice.client_name}
          onClose={() => setShowEmail(false)}
        />
      )}

      {/* Print-only styles */}
      <style>{`
        @media print {
          body > *:not(#invoice-printable) { display: none !important; }
          #invoice-printable { display: block !important; position: fixed; inset: 0; background: white; z-index: 9999; padding: 32px; }
        }
      `}</style>

      <div>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to invoices
        </button>

        <div id="invoice-printable" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Header */}
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
            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div><p className="text-slate-400 text-xs mb-0.5">Bill to</p><p className="font-semibold text-slate-800">{invoice.client_name}</p></div>
              <div><p className="text-slate-400 text-xs mb-0.5">Service period</p><p className="font-semibold text-slate-800">{fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}</p></div>
              <div><p className="text-slate-400 text-xs mb-0.5">Rate</p><p className="font-semibold text-slate-800">${invoice.rate_per_hour.toFixed(2)} / hr</p></div>
              <div><p className="text-slate-400 text-xs mb-0.5">Created</p><p className="font-semibold text-slate-800">{fmtDate(invoice.created_at)}</p></div>
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

            {/* Action bar */}
            <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-slate-100 print:hidden">
              {/* Paid / Unpaid toggle */}
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

              {/* Spacer */}
              <span className="flex-1" />

              {/* Email */}
              <button onClick={() => setShowEmail(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                Email
              </button>

              {/* Print */}
              <button onClick={() => setShowPrint(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"/>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
                PRINT
              </button>

              {/* Save / close */}
              <button onClick={onBack}
                className="flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg bg-[#1f4e79] text-white hover:bg-[#163a5a] transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Rate modal (per-visit invoicing) ─────────────────────────────────────────

type Client = { id: number; name: string };

function PeriodInvoiceModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (id: number) => void;
}) {
  const api = useApi();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [periodType, setPeriodType] = useState<'day' | 'week' | 'month'>('month');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState('25.00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/clients').then(d => { if (d) setClients(d.clients ?? []); });
  }, []);

  const getPeriod = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    if (periodType === 'day') return { start: selectedDate, end: selectedDate };
    if (periodType === 'week') {
      const day = d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
    }
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  };

  const { start, end } = getPeriod();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) { setError('Select a client'); return; }
    setError(''); setLoading(true);
    try {
      const data = await api('/admin/invoices', {
        method: 'POST',
        body: JSON.stringify({ client_id: parseInt(clientId), period_start: start, period_end: end, rate_per_hour: parseFloat(rate) }),
      });
      if (data?.id) onCreated(data.id);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Create Period Invoice</h3>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30">
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Period type</label>
            <div className="flex gap-2">
              {(['day', 'week', 'month'] as const).map(t => (
                <button key={t} type="button" onClick={() => setPeriodType(t)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    periodType === t ? 'bg-[#1f4e79] text-white border-[#1f4e79]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#1f4e79]'
                  }`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              {periodType === 'day' ? 'Date' : periodType === 'week' ? 'Any date in the week' : 'Any date in the month'}
            </label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30" />
            <p className="text-xs text-slate-400 mt-1">Period: {start} → {end}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Rate per hour ($)</label>
            <input type="number" step="0.01" min="0" value={rate} required onChange={e => setRate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e79]/30" />
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

function RateModal({ visit, onClose, onCreated }: {
  visit: UnbilledVisit; onClose: () => void; onCreated: (id: number) => void;
}) {
  const api = useApi();
  const [rate, setRate]     = useState('25.00');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
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

// ── Main tab ──────────────────────────────────────────────────────────────────

export function InvoicesTab() {
  const api = useApi();
  const [unbilled, setUnbilled]   = useState<UnbilledVisit[]>([]);
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [loading, setLoading]     = useState(true);
  const [rateTarget, setRateTarget]   = useState<UnbilledVisit | null>(null);
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [togglingId, setTogglingId]   = useState<number | null>(null);
  const [showExport, setShowExport]   = useState(false);
  const [showPeriodModal, setShowPeriodModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [inv, unb] = await Promise.all([
      api('/admin/invoices'),
      api('/admin/unbilled-visits'),
    ]);
    if (inv) setInvoices(inv.invoices ?? []);
    if (unb) setUnbilled(unb.visits ?? []);
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
    return (
      <InvoiceDetail
        invoiceId={selectedId}
        onBack={() => { setSelectedId(null); load(); }}
        onStatusChange={() => {}}
      />
    );
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
      {showPeriodModal && (
        <PeriodInvoiceModal
          onClose={() => setShowPeriodModal(false)}
          onCreated={(id) => { setShowPeriodModal(false); load(); setSelectedId(id); }}
        />
      )}
      {showExport && (
        <ExportModal
          token={localStorage.getItem('evv_token') ?? ''}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* ── Unbilled Visits ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Unbilled Visits</h3>
            <p className="text-xs text-slate-400 mt-0.5">Completed visits with no invoice yet</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowPeriodModal(true)}
              className="text-xs font-semibold bg-[#1f4e79] text-white px-3 py-1.5 rounded-lg hover:bg-[#163a5a] transition-colors">
              + Period Invoice
            </button>
            {!loading && unbilled.length > 0 && (
              <span className="text-xs font-semibold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                {unbilled.length} pending
              </span>
            )}
          </div>
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
                <p className="text-sm font-bold text-slate-700 shrink-0">{v.hours.toFixed(2)} hrs</p>
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
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Invoices</h3>
            <p className="text-xs text-slate-400 mt-0.5">Click the badge to toggle paid / unpaid</p>
          </div>
          {!loading && invoices.length > 0 && (
            <button
              onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          )}
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
              const isPaid   = inv.status === 'paid';
              const toggling = togglingId === inv.id;
              return (
                <div key={inv.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs font-medium text-slate-400">{inv.invoice_number}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 truncate">{inv.client_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(inv.period_start)} – {fmtDate(inv.period_end)} · {inv.total_hours.toFixed(2)} hrs
                      {isPaid && inv.paid_at && (
                        <span className="ml-2 text-emerald-600 font-medium">· Paid {fmtDate(inv.paid_at)}</span>
                      )}
                    </p>
                  </div>

                  <p className="text-base font-bold text-slate-800 shrink-0">${inv.total_amount.toFixed(2)}</p>

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
