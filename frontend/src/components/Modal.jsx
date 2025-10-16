import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Modal({ isOpen, onClose, title, children, compact, actions, className, busy }) {
  if (!isOpen) return null;

  // subtle scale animation for compact modals to smooth the transform effect
  const initialScale = compact ? 0.92 : 1;
  const animateScale = compact ? 0.88 : 1;
  const exitScale = compact ? 0.92 : 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
  <motion.div
  className={`modal-content ${compact ? 'compact-form' : ''} ${className || ''}`}
  aria-busy={busy ? 'true' : 'false'}
            initial={{ y: -50, opacity: 0, scale: initialScale }}
            animate={{ y: 0, opacity: 1, scale: animateScale }}
            exit={{ y: 50, opacity: 0, scale: exitScale }}
            transition={{ type: 'spring', stiffness: 330, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Visual busy overlay is intentionally not rendered here to avoid duplicate overlays.
                Child content (modal body) should render the .modal-busy-overlay inside .modal-content
                when appropriate. Modal still exposes aria-busy and an sr-only live region for screen readers. */}
            {title && <h3>{title}</h3>}
            <div className="modal-body">
              {children}
              <div className="sr-only" aria-live="polite">{busy ? 'Processing, please wait.' : ''}</div>
            </div>
            <div className="modal-actions">
              {actions ? actions : <button onClick={onClose} className="btn-secondary">Close</button>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
