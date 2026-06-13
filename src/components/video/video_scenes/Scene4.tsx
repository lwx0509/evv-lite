import { AnimatePresence, motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { LayoutDashboard, Download, FileSpreadsheet, Users } from 'lucide-react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // Animate rows
      setTimeout(() => setPhase(3), 4500), // Export
      setTimeout(() => setPhase(4), 7500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw] z-10"
      initial={{ x: '-100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Left: Text */}
      <div className="w-[35%] pr-10">
        <motion.div 
          className="w-16 h-16 rounded-xl bg-green-500/20 flex items-center justify-center mb-6 border border-green-500/30"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
        >
          <LayoutDashboard className="w-8 h-8 text-green-400" />
        </motion.div>
        <motion.h2 
          className="text-[3.5vw] font-display font-bold leading-tight mb-4"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ delay: 0.1 }}
        >
          Manage with<br/><span className="text-green-400">Confidence.</span>
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-slate-300 mb-8"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ delay: 0.2 }}
        >
          Powerful scheduling dashboard built for agency admins. One-click CSV payroll exports.
        </motion.p>
        
        <motion.div 
          className="bg-green-600 rounded-xl p-4 flex items-center justify-center gap-3 w-max"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1, scale: [0.9, 1.05, 1] } : { opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Download className="w-6 h-6 text-white" />
          <span className="font-bold text-lg">Export CSV Payroll</span>
        </motion.div>
      </div>

      {/* Right: Dashboard Mockup */}
      <motion.div 
        className="w-[60%] h-[70vh] bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl flex flex-col"
        initial={{ y: 50, opacity: 0, rotateX: 10 }}
        animate={phase >= 1 ? { y: 0, opacity: 1, rotateX: 0 } : { y: 50, opacity: 0, rotateX: 10 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.3 }}
        style={{ perspective: 1000 }}
      >
        <div className="h-16 bg-slate-800 border-b border-slate-700 flex items-center px-6 justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-400" />
            <span className="font-bold">Staff Schedule</span>
          </div>
          <div className="flex gap-2">
            <div className="w-24 h-8 rounded bg-slate-700"></div>
            <div className="w-8 h-8 rounded bg-slate-700"></div>
          </div>
        </div>
        
        <div className="p-6 flex-1 flex flex-col gap-3 relative">
          {[
            { name: "Sarah Jenkins", client: "Johnson Res.", time: "9:00 - 13:00", status: "Verified", color: "bg-green-500/20 text-green-400" },
            { name: "Michael Chang", client: "Smith Home", time: "10:00 - 14:00", status: "Active", color: "bg-blue-500/20 text-blue-400" },
            { name: "Amanda Ross", client: "Williams Apt", time: "14:00 - 18:00", status: "Scheduled", color: "bg-slate-700 text-slate-300" },
            { name: "David Lee", client: "Brown Res.", time: "15:00 - 19:00", status: "Scheduled", color: "bg-slate-700 text-slate-300" }
          ].map((row, i) => (
            <motion.div 
              key={i}
              className="bg-slate-800 rounded-lg p-4 flex items-center justify-between border border-slate-700"
              initial={{ x: 50, opacity: 0 }}
              animate={phase >= 2 ? { x: 0, opacity: 1 } : { x: 50, opacity: 0 }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
            >
              <div className="w-[30%] font-bold">{row.name}</div>
              <div className="w-[30%] text-slate-400">{row.client}</div>
              <div className="w-[20%] text-slate-400 font-mono text-sm">{row.time}</div>
              <div className={`w-[20%] px-3 py-1 rounded-full text-xs text-center font-bold ${row.color}`}>
                {row.status}
              </div>
            </motion.div>
          ))}

          {/* Export Animation overlay */}
          <AnimatePresence>
            {phase >= 3 && (
              <motion.div 
                className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div 
                  className="bg-green-600 rounded-full p-6 mb-4"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1, rotate: 360 }}
                  transition={{ type: 'spring', damping: 15 }}
                >
                  <FileSpreadsheet className="w-12 h-12 text-white" />
                </motion.div>
                <h3 className="text-2xl font-bold">Payroll.csv Generated</h3>
                <p className="text-slate-300 mt-2">Ready for QuickBooks</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
