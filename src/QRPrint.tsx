import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';

type Client = { id: number; name: string; address: string; payer_type: string };

export default function QRPrint() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [checkinUrl, setCheckinUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('evv_token');
    if (!token) { navigate('/'); return; }

    const url = `${window.location.origin}/mobile?client=${clientId}`;
    setCheckinUrl(url);

    fetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        const found = data.clients?.find((c: Client) => String(c.id) === clientId);
        if (!found) { setError('Client not found'); return; }
        setClient(found);
      })
      .catch(() => setError('Could not load client'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!checkinUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, checkinUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#1f4e79', light: '#ffffff' },
    });
  }, [checkinUrl, client]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Generating QR code…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  return (
    <>
      {/* Screen controls — hidden when printing */}
      <div className="no-print fixed top-0 left-0 right-0 bg-slate-800 text-white px-4 py-3 flex items-center justify-between z-50 shadow-md">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <span className="text-sm font-medium">QR Code — {client?.name}</span>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 bg-[#1f4e79] hover:bg-[#163a5a] text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print
        </button>
      </div>

      {/* Printable sheet — centered, clean */}
      <div className="min-h-screen bg-slate-100 no-print-bg flex items-center justify-center pt-16 pb-8 px-4">
        <div
          id="print-sheet"
          className="bg-white rounded-2xl shadow-xl overflow-hidden"
          style={{ width: 340, fontFamily: '-apple-system, Helvetica, Arial, sans-serif' }}
        >
          {/* Agency header */}
          <div style={{ background: '#1f4e79', padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 14, color: 'white',
              }}>E</div>
              <div>
                <p style={{ margin: 0, color: 'white', fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Visiting Systems</p>
                <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 }}>Sunrise Home Care</p>
              </div>
            </div>
          </div>

          {/* QR code section */}
          <div style={{ padding: '28px 24px 24px', textAlign: 'center' }}>
            <div style={{
              display: 'inline-block',
              padding: 12,
              border: '2px solid #e2e8f0',
              borderRadius: 16,
              marginBottom: 20,
              background: 'white',
            }}>
              <canvas ref={canvasRef} style={{ display: 'block' }} />
            </div>

            {/* Client info */}
            <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
              {client?.name}
            </h2>
            {client?.address && (
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                {client.address}
              </p>
            )}

            {/* Instruction */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '14px 16px',
              marginBottom: 16,
            }}>
              <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                Caregivers: scan to check in or out
              </p>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                Use your phone camera or QR scanner app. You'll need your Visiting Systems login.
              </p>
            </div>

            {/* URL for reference */}
            <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', wordBreak: 'break-all' }}>
              {checkinUrl}
            </p>
          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1' }}>
              Client ID #{clientId}
            </p>
            <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1' }}>
              visitingsystems.com
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .no-print-bg { background: white !important; padding: 0 !important; }
          #print-sheet {
            box-shadow: none !important;
            border-radius: 0 !important;
            width: 100% !important;
            max-width: 340px !important;
            margin: 0 auto !important;
          }
        }
      `}</style>
    </>
  );
}
