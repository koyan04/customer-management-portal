import { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext.jsx';
import { getBackendOrigin } from '../lib/backendOrigin';

function formatTs(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch (_) { return '—'; }
}

export default function MatviewStatus() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const headers = useMemo(() => ({ Authorization: token ? `Bearer ${token}` : undefined }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const backendOrigin = getBackendOrigin();
      const r = await axios.get(backendOrigin + '/api/admin/matviews', { headers });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.msg || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!data) return;
    const mv = Array.isArray(data.matviews) ? data.matviews.find(m => m.name === 'user_status_matview') : null;
    setRefreshing(!!(mv && mv.refreshing));
  }, [data]);

  useEffect(() => {
    if (!refreshing) return;
    const id = setInterval(load, 1000);
    return () => clearInterval(id);
  }, [refreshing, load]);

  const trigger = async (mode = 'enqueue') => {
    setError(null);
    try {
      const backendOrigin = getBackendOrigin();
      await axios.post(backendOrigin + `/api/admin/matviews/user_status_matview/refresh?mode=${mode}`, {}, { headers });
      // optimistic: set refreshing state and poll
      setRefreshing(true);
      load();
    } catch (e) {
      setError(e.response?.data?.msg || e.message || 'Failed to trigger refresh');
    }
  };

  const mv = Array.isArray(data?.matviews) ? data.matviews.find(m => m.name === 'user_status_matview') : null;

  const stateText = mv?.refreshing ? 'Refreshing…' : (mv?.pending ? 'Queued' : 'Idle');

  return (
    <div className="matview-status-card" aria-live="polite">
      {/* Collapsed single-line status */}
      <button
        type="button"
        className="matview-collapsed"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
      >
        <span className="mv-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm1 15h-2v-2h2Zm0-4h-2V7h2Z"/></svg>
        </span>
        <strong className="mv-title">User Status Materialized View</strong>
        <span className="sep"> — </span>
        <span className="state">State: {stateText}</span>
        <span className="sep"> • </span>
        <span className="last">Last: {formatTs(mv?.last_success)}</span>
        {error && <span className="sep"> • </span>}
        {error && <span className="err">Error</span>}
        <span className="chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded details and actions */}
      {expanded && (
        <div className="matview-expanded">
          {error && <div className="error-toast" role="alert">{error}</div>}
          <div className="matview-body">
            <div className="matview-row">
              <span className="label">Last refresh:</span>
              <span className="value">{formatTs(mv?.last_success)}</span>
            </div>
            <div className="matview-row">
              <span className="label">State:</span>
              <span className="value">{stateText}</span>
            </div>
          </div>
          <div className="matview-actions">
            <button className={`mv-btn refresh ${refreshing ? 'spinning' : ''}`} onClick={() => trigger('enqueue')} disabled={loading || refreshing}>
              <span className="btn-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6Z"/></svg>
              </span>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="mv-btn now" onClick={() => trigger('now')} disabled={loading || refreshing}>
              <span className="btn-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
              </span>
              Refresh now
            </button>
            <button className="mv-btn reload" onClick={load} disabled={loading}>
              <span className="btn-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6Z"/></svg>
              </span>
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
