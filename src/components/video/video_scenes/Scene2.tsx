import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { MapPin, CheckCircle2, User } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 7500), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[15vw] z-10"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-50%', opacity: 0 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Map Background Layer for this scene */}
      <motion.div 
        className="absolute inset-0 -z-10 opacity-30"
        initial={{ scale: 1.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.3 }}
        transition={{ duration: 2, ease: "easeOut" }}
      >
        <img src={`${import.meta.env.BASE_URL}images/gps-map-bg.png`} alt="" className="w-full h-full object-cover" />
      </motion.div>

      {/* Left Content */}
      <div className="w-[40%]">
        <motion.div 
          className="w-16 h-16 rounded-xl bg-blue-500/20 flex items-center justify-center mb-6 border border-blue-500/30"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ duration: 0.6 }}
        >
          <MapPin className="w-8 h-8 text-blue-400" />
        </motion.div>
        <motion.h2 
          className="text-[3.5vw] font-display font-bold leading-tight mb-4"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Pinpoint<br/><span className="text-blue-400">Accuracy.</span>
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-slate-300"
          initial={{ y: 20, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Caregiver check-ins and check-outs are verified via GPS instantly.
        </motion.p>
      </div>

      {/* Right Content - Phone Mockup */}
      <motion.div 
        className="w-[30vw] h-[60vh] bg-slate-900 border-4 border-slate-700 rounded-[3rem] p-6 relative overflow-hidden shadow-2xl shadow-blue-900/20"
        initial={{ y: 100, rotateY: 20, opacity: 0 }}
        animate={phase >= 1 ? { y: 0, rotateY: -5, opacity: 1 } : { y: 100, rotateY: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.3 }}
        style={{ perspective: 1000 }}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-700 rounded-b-xl z-20"></div>
        
        <div className="mt-8 flex flex-col h-full gap-4">
          <div className="flex items-center gap-4 border-b border-slate-800 pb-4">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
              <User className="w-6 h-6 text-slate-400" />
            </div>
            <div>
              <div className="font-bold">Sarah Jenkins</div>
              <div className="text-sm text-slate-400">Caregiver</div>
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4 mt-4">
            <div className="text-sm text-slate-400 mb-1">Current Visit</div>
            <div className="font-bold text-lg">Johnson Residence</div>
            <div className="text-sm text-blue-400 mt-2">Scheduled: 9:00 AM - 1:00 PM</div>
          </div>

          <motion.div 
            className="mt-auto bg-blue-600 rounded-xl p-4 flex items-center justify-center gap-3 cursor-pointer"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={phase >= 2 ? { scale: 1, opacity: 1 } : { scale: 0.9, opacity: 0 }}
            whileHover={{ scale: 1.02 }}
          >
            {phase >= 3 ? (
              <motion.div 
                className="flex items-center gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <CheckCircle2 className="w-6 h-6 text-white" />
                <span className="font-bold">Checked In via GPS</span>
              </motion.div>
            ) : (
              <span className="font-bold text-lg">Slide to Check In</span>
            )}
          </motion.div>

          {/* Map Overlay simulation */}
          {phase >= 3 && (
             <motion.div 
             className="absolute top-[40%] left-[10%] right-[10%] h-[30%] bg-blue-900/80 backdrop-blur-md rounded-xl border border-blue-400 p-4 flex flex-col items-center justify-center"
             initial={{ scale: 0.8, opacity: 0 }}
             animate={{ scale: 1, opacity: 1 }}
             transition={{ type: 'spring' }}
           >
             <MapPin className="w-8 h-8 text-blue-400 mb-2" />
             <div className="font-bold text-center">Location Verified</div>
             <div className="text-xs text-blue-200 mt-1">Accuracy: 5 meters</div>
           </motion.div>
          )}

        </div>
      </motion.div>
    </motion.div>
  );
}
