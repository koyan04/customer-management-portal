import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function Toast({ open, onClose, title, message, variant = 'success', duration = 3500 }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onClose && onClose(), duration);
    return () => clearTimeout(t);
  }, [open, onClose, duration]);

  const palette = variant === 'error'
    ? { bg: 'rgba(201,60,60,0.95)', border: 'rgba(231,76,60,0.45)', color: '#fff' }
    : variant === 'info'
    ? { bg: 'rgba(13,26,38,0.90)', border: 'rgba(0,191,165,0.35)', color: '#eafffb' }
    : { bg: 'rgba(8,46,37,0.92)', border: 'rgba(0,191,165,0.45)', color: '#eafffb' }; // success

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 2000,
            background: palette.bg,
            color: palette.color,
            border: `1px solid ${palette.border}`,
            borderRadius: 10,
            padding: '10px 14px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.25), inset 0 1px rgba(255,255,255,0.06)'
          }}
          role="status" aria-live="polite"
        >
          {title && <div style={{ fontWeight: 800, marginBottom: 4 }}>{title}</div>}
          {message && <div style={{ opacity: 0.96 }}>{message}</div>}
          <button
            onClick={onClose}
            style={{
              marginLeft: 10, marginTop: 8,
              background: 'transparent', color: palette.color,
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
              padding: '4px 8px', cursor: 'pointer'
            }}
          >
            Close
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Toast;
