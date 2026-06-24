import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Shield, Clock, MapPin } from 'lucide-react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 6500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-10 px-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center relative w-full max-w-2xl">
        <motion.div
          className="mx-auto w-16 h-16 sm:w-24 sm:h-24 bg-blue-600 rounded-2xl flex items-center justify-center mb-5 shadow-[0_0_40px_rgba(37,99,235,0.4)]"
          initial={{ rotate: -90, scale: 0, borderRadius: '50%' }}
          animate={{
            rotate: phase >= 1 ? 0 : -90,
            scale:  phase >= 1 ? 1 : 0,
            borderRadius: phase >= 1 ? '16px' : '50%',
          }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <Shield className="w-8 h-8 sm:w-12 sm:h-12 text-white" />
        </motion.div>

        <motion.h1
          className="font-display font-bold tracking-tight text-white leading-none mb-4"
          style={{ fontSize: 'clamp(28px, 5vw, 64px)' }}
          initial={{ y: 40, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 40, opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          Home Care EVV,<br />
          <span className="text-blue-400">Simplified.</span>
        </motion.h1>

        <motion.p
          className="text-slate-300 mx-auto px-4"
          style={{ fontSize: 'clamp(13px, 1.8vw, 20px)', maxWidth: '52ch' }}
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 2 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Professional visit verification built specifically for private-pay home care agencies.
        </motion.p>

        <div className="flex flex-wrap gap-3 justify-center mt-8 px-2">
          {[
            { icon: Clock,   text: 'Automated Tracking' },
            { icon: MapPin,  text: 'GPS Verification' },
            { icon: Shield,  text: 'Audit Ready' },
          ].map((item, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-2 bg-slate-800/80 px-4 py-2.5 rounded-full border border-slate-700"
              initial={{ y: 30, opacity: 0 }}
              animate={phase >= 3 ? { y: 0, opacity: 1 } : { y: 30, opacity: 0 }}
              transition={{ duration: 0.6, delay: i * 0.15, ease: 'easeOut' }}
            >
              <item.icon className="w-4 h-4 text-blue-400 shrink-0" />
              <span style={{ fontSize: 'clamp(11px, 1.2vw, 15px)' }} className="font-medium whitespace-nowrap">
                {item.text}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
