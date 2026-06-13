import { useState, useEffect } from 'react';

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).startRecording) {
      (window as any).startRecording();
    }
  }, []);

  useEffect(() => {
    const scenes = Object.values(durations);
    let isCancelled = false;

    const runLoop = async () => {
      let i = 0;
      while (!isCancelled) {
        setCurrentScene(i);
        await new Promise(r => setTimeout(r, scenes[i]));
        i++;
        if (i >= scenes.length) {
          if (typeof window !== 'undefined' && (window as any).stopRecording) {
            (window as any).stopRecording();
          }
          i = 0;
        }
      }
    };
    runLoop();
    
    return () => { isCancelled = true; };
  }, [JSON.stringify(durations)]);

  return { currentScene };
}
