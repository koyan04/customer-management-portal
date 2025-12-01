import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBackendOrigin } from '../lib/backendOrigin';
import { FaUserCheck, FaUserSlash } from 'react-icons/fa';

export default function UserEnabledToggle({ user, onChange }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const { token } = useAuth();

  const enabled = !!user?.enabled;

  const handleToggle = async () => {
    setError(null);
    setPending(true);
    const next = !enabled;
    try {
      // Optimistic update callback
      onChange && onChange({ ...user, enabled: next }, { optimistic: true });
      const backendOrigin = getBackendOrigin();
      const res = await fetch(`${backendOrigin}/api/users/${user.id}/enabled`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ enabled: next })
      });
      if (!res.ok) throw new Error(`Toggle failed: ${res.status}`);
      const updated = await res.json();
      onChange && onChange(updated, { optimistic: false });
    } catch (e) {
      setError(e.message || String(e));
      // rollback optimistic change
      onChange && onChange(user, { rollback: true });
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-pressed={enabled}
      title={enabled ? 'Disable user' : 'Enable user'}
      className="icon-btn enable-toggle-btn"
    >
      {pending ? (
        <span style={{ fontSize: '0.82rem' }}>Saving…</span>
      ) : enabled ? (
        <FaUserCheck aria-hidden />
      ) : (
        <FaUserSlash aria-hidden />
      )}
      {error && (
        <span style={{ marginLeft: 8, color: '#d73a49' }}>Error: {error}</span>
      )}
    </button>
  );
}
