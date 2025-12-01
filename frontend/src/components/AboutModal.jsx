import Modal from './Modal.jsx';

export default function AboutModal({ isOpen, onClose, version, gitSha, buildTimestamp, backendOrigin }) {
  const shortSha = gitSha ? String(gitSha).slice(0, 8) : '';
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="About" compact>
      <div className="about-grid">
        <div className="about-row"><strong>Application</strong><span>Customer Management Portal</span></div>
        <div className="about-row"><strong>Version</strong><span>{version || '—'}</span></div>
        <div className="about-row"><strong>Git SHA</strong><span>{gitSha ? (<code title={gitSha}>{shortSha}</code>) : '—'}</span></div>
        <div className="about-row"><strong>Build Time</strong><span>{buildTimestamp || '—'}</span></div>
        <div className="about-row"><strong>Backend</strong><span>{backendOrigin || window.location.origin}</span></div>
      </div>
      <style>{`
        .about-grid { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px; align-items: center; }
        .about-row { display: contents; }
        .about-row strong { opacity: 0.75; font-weight: 600; }
        .about-row span { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
      `}</style>
    </Modal>
  );
}
