import { useState } from 'react';
import { FaCopy, FaCheck } from 'react-icons/fa';
import { copyToClipboard } from '../lib/clipboard';

export function SubscriptionToast({ url, filename, onCopySuccess }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e?.stopPropagation?.();
    if (!url) return;
    const success = await copyToClipboard(url);
    if (success) {
      setCopied(true);
      if (onCopySuccess) onCopySuccess();
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="subscription-toast" style={{ minWidth: '260px', maxWidth: '100%', marginTop: '6px' }}>
      {filename && (
        <div style={{ fontSize: '0.82rem', marginBottom: '6px', opacity: 0.9 }}>
          Saved as <strong>{filename}</strong>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(0, 0, 0, 0.45)',
          padding: '6px 8px',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.18)',
        }}
      >
        <input
          type="text"
          readOnly
          value={url}
          onClick={(e) => e.target.select()}
          title={url}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#eafffb',
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            flex: 1,
            outline: 'none',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied to clipboard' : 'Copy subscription link'}
          aria-label="Copy subscription link"
          style={{
            background: copied ? '#10b981' : 'rgba(0, 191, 165, 0.35)',
            border: '1px solid rgba(0, 191, 165, 0.6)',
            color: '#fff',
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '0.78rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            transition: 'all 0.2s',
          }}
        >
          {copied ? <FaCheck /> : <FaCopy />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

export default SubscriptionToast;
