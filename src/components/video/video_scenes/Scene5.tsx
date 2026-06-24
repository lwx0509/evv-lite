import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Shield, ArrowRight } from 'lucide-react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 bg-blue-600">
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.1)_0,transparent_60%)]"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="text-center relative z-20 text-white px-4 w-full max-w-2xl">
        <motion.div
          className="mx-auto w-16 h-16 sm:w-24 sm:h-24 bg-white rounded-2xl flex items-center justify-center mb-5 shadow-2xl"
          initial={{ y: -50, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: -50, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <Shield className="w-8 h-8 sm:w-12 sm:h-12 text-blue-600" />
        </motion.div>

        <motion.h1
          className="font-display font-bold tracking-tight leading-none mb-4"
          style={{ fontSize: 'clamp(28px, 6vw, 72px)' }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Visiting Systems
        </motion.h1>

        <motion.div
          className="text-blue-100 font-medium mx-auto mb-10"
          style={{ fontSize: 'clamp(13px, 2vw, 22px)', maxWidth: '46ch' }}
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 2 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
        >
          The trusted EVV partner for private-pay home care agencies.
        </motion.div>

        <motion.div
          className="inline-flex items-center gap-3 bg-white text-blue-600 px-6 py-3.5 rounded-full font-bold shadow-2xl"
          style={{ fontSize: 'clamp(14px, 1.8vw, 20px)' }}
          initial={{ y: 30, opacity: 0 }}
          animate={phase >= 3 ? { y: 0, opacity: 1 } : { y: 30, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <span>Get Started Today</span>
          <ArrowRight className="w-5 h-5" />
        </motion.div>
      </div>
    </motion.div>
  );
}
