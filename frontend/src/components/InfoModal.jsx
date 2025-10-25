import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes } from 'react-icons/fa';

function InfoModal({ isOpen, onClose, title, children }) {
  const closeBtnRef = useRef(null);

  // Manage Escape key to close the modal and focus the close button when opened
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (onClose) onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Focus the close button for immediate keyboard access
    const t = setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(t);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="modal-content info-modal" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
            <button
              type="button"
              aria-label="Close"
              className="modal-close"
              onClick={(e) => { e.stopPropagation(); if (onClose) onClose(); }}
              title="Close"
              ref={closeBtnRef}
            >
              <FaTimes />
            </button>
            <h3>{title}</h3>
            <div className="modal-body">
              {children}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default InfoModal;
