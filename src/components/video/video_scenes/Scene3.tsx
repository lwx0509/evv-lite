import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock, MapPin } from 'lucide-react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 7500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center z-10 overflow-hidden"
      style={{ padding: 'clamp(16px, 8vw, 120px)' }}
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mb-6">
        <motion.h2
          className="font-display font-bold leading-tight"
          style={{ fontSize: 'clamp(20px, 3.5vw, 44px)' }}
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
        >
          Automatic <span className="text-red-400">Exception Flagging.</span>
        </motion.h2>
        <motion.p
          className="text-slate-300 mt-2"
          style={{ fontSize: 'clamp(12px, 1.5vw, 18px)', maxWidth: '50ch' }}
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ delay: 0.1 }}
        >
          Never miss a compliance issue. Visiting Systems automatically catches anomalies so you don't have to manually audit every visit.
        </motion.p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 w-full">
        {[
          { icon: Clock,         title: 'Late Start',        time: '9:24 AM', sched: '9:00 AM', color: 'text-amber-400',  bg: 'bg-amber-400/10',  border: 'border-amber-400/30' },
          { icon: MapPin,        title: 'Location Mismatch', time: '1:00 PM', sched: 'Offsite',  color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30' },
          { icon: AlertTriangle, title: 'Short Visit',       time: '3.2 hrs', sched: '4.0 hrs', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30' },
        ].map((alert, i) => (
          <motion.div
            key={i}
            className={`flex-1 rounded-2xl border ${alert.border} ${alert.bg} p-4 relative overflow-hidden`}
            initial={{ y: 50, opacity: 0 }}
            animate={phase >= 2 ? { y: 0, opacity: 1 } : { y: 50, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20, delay: i * 0.15 }}
          >
            <alert.icon className={`w-7 h-7 ${alert.color} mb-2`} />
            <h3 className="font-bold text-base mb-0.5">{alert.title}</h3>
            <div className="text-slate-300 text-xs mb-3">Flagged automatically</div>

            <div className="bg-slate-900/50 rounded-lg p-2 font-mono text-xs border border-slate-700">
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Actual:</span>
                <span className={alert.color}>{alert.time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sched:</span>
                <span>{alert.sched}</span>
              </div>
            </div>

            <motion.div
              className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 border-2 border-green-500/50 rounded-2xl"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.1 }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
            >
              <CheckCircle2 className="w-10 h-10 text-green-400 mb-2" />
              <div className="font-bold text-base">Resolved</div>
              <div className="text-xs text-green-200 text-center mt-0.5">Note attached</div>
            </motion.div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
