import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { 
  intro: 8000, 
  gps: 9000, 
  exceptions: 9000, 
  admin: 9000, 
  outro: 10000 
};

export default function VideoTemplate({ showBrand = true }: { showBrand?: boolean }) {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-900 text-slate-100 font-body">
      {/* Persistent Background */}
      <div className="absolute inset-0">
        <motion.div 
          className="absolute inset-0 opacity-20"
          animate={{ 
            scale: [1, 1.1, 1],
            rotate: [0, 2, -2, 0]
          }}
          transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
        >
          <img src={`${import.meta.env.BASE_URL}images/healthcare-bg.png`} alt="" className="w-full h-full object-cover" />
        </motion.div>
        
        {/* Subtle grid/medical cross overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>
      </div>

      {/* Persistent Midground — full-bleed accent layer */}
      <motion.div
        className="absolute inset-0 border border-blue-500/10 bg-transparent"
        animate={{
          borderColor: currentScene === 2 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(59, 130, 246, 0.08)',
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />
      
      {/* Persistent Brand Accent — hidden when used as background */}
      {showBrand && (
        <motion.div 
          className="absolute top-8 left-12 flex items-center gap-3 z-50"
          animate={{
            opacity: currentScene === 0 ? 0 : 1,
            y: currentScene === 0 ? -20 : 0
          }}
          transition={{ duration: 1, ease: 'easeOut' }}
        >
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-display font-bold text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]">
            E
          </div>
          <span className="font-display font-bold text-xl tracking-tight">EVV-lite</span>
        </motion.div>
      )}

      {/* Scene Content */}
      <div className={showBrand ? '' : 'pointer-events-none select-none'}>
        <AnimatePresence mode="sync">
          {currentScene === 0 && <Scene1 key="intro" />}
          {currentScene === 1 && <Scene2 key="gps" />}
          {currentScene === 2 && <Scene3 key="exceptions" />}
          {currentScene === 3 && <Scene4 key="admin" />}
          {currentScene === 4 && <Scene5 key="outro" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
