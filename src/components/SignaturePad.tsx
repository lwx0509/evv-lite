import { useRef, useState, useEffect } from 'react';

const REASON_CODES = [
  { value: 'patient_refused', label: 'Patient refused to sign' },
  { value: 'patient_unavailable', label: 'Patient unavailable / asleep' },
  { value: 'cognitive_impairment', label: 'Cognitive impairment' },
  { value: 'physical_impairment', label: 'Physical impairment' },
  { value: 'other', label: 'Other reason' },
];

interface SignaturePadProps {
  onConfirm: (data: string | null, reasonCode: string | null) => void;
  onCancel: () => void;
}

export function SignaturePad({ onConfirm, onCancel }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'draw' | 'reason'>('draw');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

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

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
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
    drawing.current = false;
    lastPos.current = null;
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
    } else {
      onConfirm(null, reasonCode);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">Client signature</p>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs font-medium mb-3">
          <button
            onClick={() => setMode('draw')}
            className={`flex-1 py-2 transition-colors ${mode === 'draw' ? 'bg-[#1f4e79] text-white' : 'bg-white text-slate-500'}`}
          >
            Sign here
          </button>
          <button
            onClick={() => setMode('reason')}
            className={`flex-1 py-2 transition-colors ${mode === 'reason' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500'}`}
          >
            Unable to sign
          </button>
        </div>

        {mode === 'draw' ? (
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              className="w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 touch-none"
              style={{ height: 140 }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-slate-300 text-sm">Sign above</p>
              </div>
            )}
            {hasDrawn && (
              <button
                onClick={clearCanvas}
                className="absolute top-2 right-2 text-[11px] text-slate-400 bg-white border border-slate-200 px-2 py-1 rounded"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Select the reason the client could not sign:</p>
            {REASON_CODES.map(rc => (
              <label key={rc.value} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="reason_code"
                  value={rc.value}
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
        onClick={handleConfirm}
        disabled={mode === 'draw' ? !hasDrawn : !reasonCode}
        className="w-full bg-emerald-600 disabled:opacity-40 active:bg-emerald-700 text-white text-base font-bold py-3.5 rounded-xl transition-colors shadow-sm"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        Confirm check-out
      </button>
      <button
        onClick={onCancel}
        className="w-full text-slate-400 text-sm py-1"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        Back
      </button>
    </div>
  );
}
