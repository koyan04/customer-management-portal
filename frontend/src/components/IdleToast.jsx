import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function IdleToast({ isOpen, remainingMs, onExtend, onClose }) {
  const seconds = Math.ceil((remainingMs || 0) / 1000);
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="idle-toast" initial={{ x: '100%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
          <div className="idle-toast-body">
            <div className="idle-toast-text">
              <strong>Session expiring</strong>
              <div className="idle-toast-sub">You will be logged out in {seconds}s due to inactivity.</div>
            </div>
            <div className="idle-toast-actions">
              <button className="btn" onClick={onClose}>Dismiss</button>
              <button className="btn primary" onClick={onExtend}>Extend ({seconds}s)</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
