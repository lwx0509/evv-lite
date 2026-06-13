import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    const url = `${window.location.origin}/video`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement('textarea');
      el.value = url;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, []);

  return (
    <button
      onClick={copy}
      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg transition-colors relative overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {copied ? (
          <motion.span
            key="check"
            className="flex items-center gap-2"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <CheckIcon />
            <span className="text-emerald-400">Copied!</span>
          </motion.span>
        ) : (
          <motion.span
            key="link"
            className="flex items-center gap-2"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <LinkIcon />
            Copy Embed Link
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
