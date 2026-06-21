import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TOTAL_DURATION_MS = 45000;

type ExportState = 'idle' | 'requesting' | 'recording' | 'done' | 'error';

interface Props {
  inline?: boolean;
}

export function ExportOverlay({ inline }: Props) {
  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startExport = useCallback(async () => {
    setState('requesting');
    setErrorMsg('');

    let stream: MediaStream;
    try {
      stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: 30, displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
      } as any);
    } catch {
      setState('error');
      setErrorMsg('Screen capture was cancelled or denied. Please try again and select this tab.');
      return;
    }

    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4';

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    } catch {
      stream.getTracks().forEach(t => t.stop());
      setState('error');
      setErrorMsg('Your browser does not support the required video format.');
      return;
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'visiting-systems-video.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setState('done');
      setProgress(100);
    };

    stream.getVideoTracks()[0].onended = () => {
      if (recorder.state === 'recording') recorder.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setState('idle');
      setProgress(0);
    };

    recorder.start(200);
    startTimeRef.current = Date.now();
    setState('recording');
    setProgress(0);

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min((elapsed / TOTAL_DURATION_MS) * 100, 99);
      setProgress(pct);
      if (elapsed >= TOTAL_DURATION_MS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        recorder.stop();
      }
    }, 250);
  }, []);

  const cancel = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState('idle');
    setProgress(0);
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
  }, []);

  const content = (
    <AnimatePresence mode="wait">
      {state === 'idle' && (
        <motion.button
          key="btn"
          onClick={startExport}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg shadow-blue-900/40 transition-colors"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
        >
          <DownloadIcon />
          Export Video
        </motion.button>
      )}

      {state === 'requesting' && (
        <motion.div
          key="req"
          className="bg-slate-800 border border-slate-700 text-white text-sm px-4 py-3 rounded-xl shadow-xl max-w-[280px]"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          <p className="font-semibold mb-1">Select this tab</p>
          <p className="text-slate-400 text-xs">In the browser dialog, choose <strong className="text-white">This Tab</strong> to capture the video.</p>
        </motion.div>
      )}

      {state === 'recording' && (
        <motion.div
          key="rec"
          className="bg-slate-800 border border-slate-700 text-white text-sm px-4 py-3 rounded-xl shadow-xl w-[240px]"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-semibold">Recording…</span>
            </div>
            <button
              onClick={cancel}
              className="text-slate-500 hover:text-white text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="h-full bg-blue-500 rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.25, ease: 'linear' }}
            />
          </div>
          <p className="text-slate-400 text-xs mt-2">
            {Math.round(progress / 100 * 45)}s / 45s — don't switch tabs
          </p>
        </motion.div>
      )}

      {state === 'done' && (
        <motion.div
          key="done"
          className="bg-slate-800 border border-emerald-700/50 text-white text-sm px-4 py-3 rounded-xl shadow-xl flex items-center gap-3"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          <span className="text-emerald-400 text-base">✓</span>
          <div>
            <p className="font-semibold">Download started</p>
            <button onClick={reset} className="text-slate-400 hover:text-white text-xs transition-colors">Export again</button>
          </div>
        </motion.div>
      )}

      {state === 'error' && (
        <motion.div
          key="err"
          className="bg-slate-800 border border-red-700/50 text-white text-sm px-4 py-3 rounded-xl shadow-xl max-w-[280px]"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          <p className="font-semibold text-red-400 mb-1">Export failed</p>
          <p className="text-slate-400 text-xs mb-2">{errorMsg}</p>
          <button onClick={reset} className="text-blue-400 hover:text-blue-300 text-xs transition-colors">Try again</button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (inline) return <>{content}</>;

  return (
    <div className="fixed top-4 right-4 z-[100]">
      {content}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}
