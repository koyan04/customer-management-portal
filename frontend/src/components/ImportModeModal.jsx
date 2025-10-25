import React from 'react';
import Modal from './Modal.jsx';

export default function ImportModeModal({ isOpen, onClose, onSelect }) {
  const actions = (
    <>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import mode" compact actions={actions}>
      <p style={{ marginTop: 0 }}>Choose how to apply the imported rows to this server:</p>
      <ul style={{ margin: '0 0 0.75rem 1.1rem' }}>
        <li><strong>Merge</strong>: add new users; update existing by account name.</li>
        <li><strong>Overwrite</strong>: erase all current users for this server, then import from the file.</li>
      </ul>
      <div className="actions" style={{ marginTop: '0.25rem' }}>
        <button className="btn" onClick={() => onSelect('merge')}>Merge</button>
        <button className="btn btn-danger" onClick={() => onSelect('overwrite')}>Overwrite</button>
      </div>
    </Modal>
  );
}
