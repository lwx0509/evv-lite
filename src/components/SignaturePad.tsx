import { useRef, useState, useEffect } from 'react';

const REASON_CODES = [
  { value: 'patient_refused',      label: 'Patient refused to sign' },
  { value: 'patient_unavailable',  label: 'Patient unavailable / asleep' },
  { value: 'cognitive_impairment', label: 'Cognitive impairment' },
  { value: 'physical_impairment',  label: 'Physical impairment' },
  { value: 'other',                label: 'Other reason' },
];

type Mode = 'draw' | 'type' | 'reason';

interface SignaturePadProps {
  onConfirm: (data: string | null, reasonCode: string | null) => void;
  onCancel: () => void;
}

export function SignaturePad({ onConfirm, onCancel }: SignaturePadProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const typeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode]           = useState<Mode>('draw');
  const [hasDrawn, setHasDrawn]   = useState(false);
  const [typedName, setTypedName] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const drawing  = useRef(false);
  const lastPos  = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [mode]);

  // Render typed name onto hidden canvas whenever it changes
  useEffect(() => {
    const canvas = typeCanvasRef.current;
    if (!canvas || mode !== 'type') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (typedName) {
      ctx.font = `italic 48px Georgia, "Times New Roman", serif`;
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typedName, canvas.width / 2, canvas.height / 2);
    }
  }, [typedName, mode]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getPos(e, canvas);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, canvas);
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      setHasDrawn(true);
    }
    lastPos.current = pos;
  }

  function stopDraw() {
    drawing.current  = false;
    lastPos.current  = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function handleConfirm() {
    if (mode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      onConfirm(canvas.toDataURL('image/png'), null);
    } else if (mode === 'type') {
      const canvas = typeCanvasRef.current;
      if (!canvas) return;
      onConfirm(canvas.toDataURL('image/png'), null);
    } else {
      onConfirm(null, reasonCode);
    }
  }

  const canConfirm =
    mode === 'draw'   ? hasDrawn :
    mode === 'type'   ? typedName.trim().length > 0 :
    Boolean(reasonCode);

  const TAB = 'flex-1 py-2 text-xs font-medium transition-colors';
  const activeTab   = 'bg-[#1f4e79] text-white';
  const inactiveTab = 'bg-white text-slate-500';

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Client signature</p>

        {/* Mode tabs */}
        <div className="flex rounded-lg overflow-hidden border border-slate-200 mb-3">
          <button type="button" onClick={() => setMode('draw')}   className={`${TAB} ${mode === 'draw'   ? activeTab : inactiveTab}`}>Draw</button>
          <button type="button" onClick={() => setMode('type')}   className={`${TAB} ${mode === 'type'   ? activeTab : inactiveTab} border-x border-slate-200`}>Type name</button>
          <button type="button" onClick={() => setMode('reason')} className={`${TAB} ${mode === 'reason' ? 'bg-amber-500 text-white' : inactiveTab}`}>Unable to sign</button>
        </div>

        {/* Draw mode */}
        {mode === 'draw' && (
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={600} height={200}
              className="w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 touch-none"
              style={{ height: 140 }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-slate-300 text-sm">Sign with finger or stylus</p>
              </div>
            )}
            {hasDrawn && (
              <button type="button" onClick={clearCanvas}
                className="absolute top-2 right-2 text-[11px] text-slate-400 bg-white border border-slate-200 px-2 py-1 rounded"
              >Clear</button>
            )}
          </div>
        )}

        {/* Type name mode */}
        {mode === 'type' && (
          <div className="space-y-2">
            <input
              type="text"
              value={typedName}
              onChange={e => setTypedName(e.target.value)}
              placeholder="Client's full name"
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
            {typedName.trim() && (
              <div className="w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center"
                style={{ height: 90 }}>
                <span style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontSize: 32, color: '#1e293b' }}>
                  {typedName}
                </span>
              </div>
            )}
            {/* Hidden canvas used to capture typed sig as PNG */}
            <canvas ref={typeCanvasRef} width={600} height={200} className="hidden" />
          </div>
        )}

        {/* Unable to sign mode */}
        {mode === 'reason' && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Select the reason the client could not sign:</p>
            {REASON_CODES.map(rc => (
              <label key={rc.value} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio" name="reason_code" value={rc.value}
                  checked={reasonCode === rc.value}
                  onChange={() => setReasonCode(rc.value)}
                  className="accent-amber-500"
                />
                <span className="text-sm text-slate-700">{rc.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canConfirm}
        className="w-full bg-emerald-600 disabled:opacity-40 active:bg-emerald-700 text-white text-base font-bold py-3.5 rounded-xl transition-colors shadow-sm"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        Confirm check-out
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="w-full text-slate-400 text-sm py-1"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        Back
      </button>
    </div>
  );
}
