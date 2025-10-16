import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function ConfirmModal({ isOpen, onClose, onConfirm, title, children }) {
  if (!isOpen) return null;

  return (
    // AnimatePresence allows the component to animate when it's removed
    <AnimatePresence>
      {isOpen && (
        // This is the semi-transparent backdrop
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose} // Close modal if backdrop is clicked
        >
          {/* This is the modal content window */}
          <motion.div
            className="modal-content"
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the modal
          >
            <h3>{title}</h3>
            <p>{children}</p>
            <div className="modal-actions">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={onConfirm} className="btn-danger">Confirm Delete</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ConfirmModal;