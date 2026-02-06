import { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Bar } from 'react-chartjs-2';
// using native date inputs with calendar pick UI
import { FiCalendar, FiClock, FiTrendingUp, FiGlobe, FiSave, FiCheck } from 'react-icons/fi';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import formatWithAppTZ, { getStoredTimezone } from '../lib/timezone';
import TopProgressBar from '../components/TopProgressBar.jsx';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function fmtCurrency(cents, currency = 'USD') {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinancialPage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [duration, setDuration] = useState('last6');
  const [startDate, setStartDate] = useState(null); // Date
  const [endDate, setEndDate] = useState(null); // Date
  const [accounts, setAccounts] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [generatingSnapshot, setGeneratingSnapshot] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState('');
  // validationMsg was unused; keeping placeholder for future form validation feature
  // validationMsg placeholder removed (unused) – reintroduce when adding form validation UI

  // Fetch accounts list for ADMIN user selector
  useEffect(() => {
    const role = user && (user.user?.role || user.role);
    if (role === 'ADMIN' && token) {
      axios.get('/api/admin/accounts', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          const accts = Array.isArray(res.data) ? res.data : [];
          setAccounts(accts);
        })
        .catch(err => console.error('Failed to fetch accounts:', err));
    }
  }, [token, user]);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      // Allow global ADMIN and SERVER_ADMIN to call this API. Others are forbidden.
      const role = user && (user.user?.role || user.role);
      if (role && role !== 'ADMIN' && role !== 'SERVER_ADMIN') {
        setError('Forbidden');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const params = selectedUserId ? { userId: selectedUserId } : {};
        console.log('[DEBUG FinancialPage] Fetching with params:', params, 'selectedUserId:', selectedUserId);
        const res = await axios.get('/api/admin/financial', { headers, params, validateStatus: () => true });
        if (res.status !== 200) throw new Error(res.data && res.data.msg ? res.data.msg : `Status ${res.status}`);
        if (!mounted) return;
        setData(res.data);
          // initialize default date range to last 6 months when data loads
          try {
            const months = (res.data && res.data.months) || [];
            if (months && months.length) {
              const lastIdx = months.length - 1;
              const startIdx = Math.max(0, months.length - 6);
              const start = new Date(months[startIdx].month + '-01');
              const end = new Date(months[lastIdx].month + '-01');
              setStartDate(start);
              setEndDate(end);
            }
          } catch (e) {
            // ignore
          }
      } catch (e) {
        if (!mounted) return;
        setError(e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchData();
    return () => { mounted = false; };
  }, [token, user, selectedUserId]);

  // Generate snapshot for a specific month
  const generateSnapshot = async (monthStr) => {
    const role = user && (user.user?.role || user.role);
    if (role !== 'ADMIN') {
      setSnapshotMessage('❌ Only ADMIN can generate snapshots');
      setTimeout(() => setSnapshotMessage(''), 5000);
      return;
    }
    setGeneratingSnapshot(true);
    setSnapshotMessage('');
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const url = monthStr 
        ? `/api/admin/financial/snapshot?month=${monthStr}`
        : '/api/admin/financial/snapshot';
      const res = await axios.post(url, {}, { headers, validateStatus: () => true });
      if (res.status !== 200) throw new Error(res.data?.msg || `Status ${res.status}`);
      setSnapshotMessage(`✅ Snapshot generated for ${res.data.month || monthStr || 'previous month'}`);
      // Refresh the financial data to show new snapshot
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setSnapshotMessage(`❌ Failed: ${err.message}`);
    } finally {
      setGeneratingSnapshot(false);
      setTimeout(() => setSnapshotMessage(''), 5000);
    }
  };

  // helper: convert month string 'YYYY-MM' to yyyy-mm-01 date string
  const monthToISO = (monthStr) => (monthStr ? `${monthStr}-01` : null);

  // helper: ensure we always work with Date objects
  const toDate = (v) => {
    if (!v) return null;
    if (v instanceof Date) return v;
    // allow strings like 'YYYY-MM' or 'YYYY-MM-01' or full ISO
    // for 'YYYY-MM' append '-01' to create a valid date
    if (/^\d{4}-\d{2}$/.test(v)) return new Date(v + '-01');
    return new Date(v);
  };

  // compute filtered months according to startDate/endDate
  const filteredMonths = useMemo(() => {
    if (!data || !data.months) return [];
    if (!startDate || !endDate) return data.months;
    const sDate = toDate(startDate);
    const eDate = toDate(endDate);
    if (!sDate || !eDate) return data.months;
    const s = new Date(Date.UTC(sDate.getUTCFullYear(), sDate.getUTCMonth(), 1));
    const e = new Date(Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), 1));
    // normalize to month starts for comparison
    return data.months.filter(m => {
      const md = new Date(monthToISO(m.month));
      return md.getTime() >= s.getTime() && md.getTime() <= e.getTime();
    });
  }, [data, startDate, endDate]);

  // sums for various ranges
  const sumRange = (monthsArr) => monthsArr.reduce((acc, m) => acc + Number(m.revenue_cents || 0), 0);

  const thisMonthSum = useMemo(() => {
    if (!data || !data.months) return 0;
    const last = data.months[data.months.length - 1];
    return Number(last && last.revenue_cents || 0);
  }, [data]);


  const last6Sum = useMemo(() => {
    if (!data || !data.months) return 0;
    const months = data.months.slice(-6);
    return sumRange(months);
  }, [data]);

  const last12Sum = useMemo(() => {
    if (!data || !data.months) return 0;
    const months = data.months.slice(-12);
    return sumRange(months);
  }, [data]);

  const allTimeSum = useMemo(() => sumRange((data && data.months) || []), [data]);

  const thisYearSum = useMemo(() => {
    if (!data || !data.months) return 0;
    const year = (data && data.year) || new Date().getUTCFullYear();
    const months = data.months.filter(m => m.month.startsWith(String(year)));
    return sumRange(months);
  }, [data]);

  const lastYearSum = useMemo(() => {
    if (!data || !data.months) return 0;
    const year = ((data && data.year) || new Date().getUTCFullYear()) - 1;
    const months = data.months.filter(m => m.month.startsWith(String(year)));
    return sumRange(months);
  }, [data]);

  // tableMonths sorted ascending by month (YYYY-MM)
  const tableMonths = useMemo(() => {
    if (!filteredMonths) return [];
    return [...filteredMonths].sort((a, b) => (a.month || '').localeCompare(b.month || ''));
  }, [filteredMonths]);

  const totals = useMemo(() => {
    return tableMonths.reduce((acc, m) => {
      acc.mini += (m.counts && Number(m.counts.Mini)) || 0;
      acc.basic += (m.counts && Number(m.counts.Basic)) || 0;
      acc.unlimited += (m.counts && Number(m.counts.Unlimited)) || 0;
      acc.revenue += Number(m.revenue_cents || 0);
      return acc;
    }, { mini: 0, basic: 0, unlimited: 0, revenue: 0 });
  }, [tableMonths]);

  const onBarClick = useCallback((evt, elements) => {
    if (!elements.length) return;
    // elements[0] corresponds to datasetIndex and index
    const [{ index }] = elements;
    if (data && data.months && data.months[index]) {
      setSelectedMonth(data.months[index]);
    }
  }, [data]);

  if (loading) return (
    <div className="app-container">
      <TopProgressBar active={true} />
    </div>
  );
  if (error) {
    // friendly UI for forbidden vs other errors
    if (String(error).toLowerCase().includes('forbid')) {
      return (
        <div className="app-container">
          <div className="forbidden-panel">
            <div className="forbidden-icon" aria-hidden="true">🔒</div>
            <div>
              <h3 className="forbidden-title">Access denied</h3>
              <p className="forbidden-desc">You don't have permission to view financial reports for the selected servers.</p>
              <p className="forbidden-help">If you believe this is an error, contact a global administrator or request access to the servers you manage.</p>
              <div className="forbidden-cta">
                <a className="btn btn-secondary" href="/server-list">View Server List</a>
                <button className="btn" onClick={() => window.location.reload()}>Retry</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return <div className="app-container">Failed to load financials: {error}</div>;
  }
  if (!data) return <div className="app-container">No data</div>;

  const months = data.months || [];
  // derived chart arrays (currently unused independently; kept for potential summary chips)
  const labels = months.map(m => m.month); // eslint-disable-line no-unused-vars
  const revenues = months.map(m => Number(m.revenue_cents || 0) / 100); // eslint-disable-line no-unused-vars
  const currency = (months[0] && months[0].rawAudit && months[0].rawAudit.currency) || (months[0] && months[0].currentApp && months[0].currentApp.currency) || 'USD';

  const chartData = {
    labels: filteredMonths.map(m => m.month),
    datasets: (duration === 'this' || filteredMonths.length === 1) ? [
      {
        label: 'Mini',
        data: filteredMonths.map(m => Number((m.counts && m.counts.Mini) || 0)),
        backgroundColor: 'rgba(75,192,192,0.85)'
      },
      {
        label: 'Basic',
        data: filteredMonths.map(m => Number((m.counts && m.counts.Basic) || 0)),
        backgroundColor: 'rgba(54,162,235,0.85)'
      },
      {
        label: 'Unlimited',
        data: filteredMonths.map(m => Number((m.counts && m.counts.Unlimited) || 0)),
        backgroundColor: 'rgba(255,159,64,0.85)'
      }
    ] : [
      {
        label: `Revenue (${currency})`,
        data: filteredMonths.map(m => Math.round(Number(m.revenue_cents || 0) / 100)),
        backgroundColor: 'rgba(54, 162, 235, 0.6)'
      }
    ]
  };


  const options = {
    responsive: true,
    plugins: {
      legend: { display: (duration === 'this' || filteredMonths.length === 1) ? true : false },
      tooltip: { mode: 'index', intersect: false,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed && ctx.parsed.y != null ? Number(ctx.parsed.y) : ctx.parsed || 0;
            // for revenue dataset show currency, otherwise just the number
            if ((duration === 'this' || filteredMonths.length === 1) && ctx.dataset && ctx.dataset.label) {
              return `${ctx.dataset.label}: ${val.toLocaleString()}`;
            }
            return `${val.toLocaleString()} ${currency}`;
          }
        }
      }
    },
    onClick: (evt, elements, chart) => {
      // use chart to get elements at event
      const elems = chart.getElementsAtEventForMode(evt.native, 'nearest', { intersect: true }, true);
      if (elems && elems.length) {
        onBarClick(evt, elems);
      }
    },
    scales: { x: { stacked: (duration === 'this' || filteredMonths.length === 1) }, y: { beginAtZero: true, stacked: (duration === 'this' || filteredMonths.length === 1) } }
  };

  // simple data-labels plugin to draw values on top of bars (avoids external dependency)
  // Removed inline barDataLabelsPlugin (unused) – can be restored if value labels are desired.

  return (
    <div className="app-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 className="admin-title" style={{ margin: 0 }}>
          <FiTrendingUp aria-hidden style={{ marginRight: 10, verticalAlign: 'middle' }} />
          Financials
        </h2>
        
        {/* User Selector - Only for ADMIN role */}
        {(user && (user.user?.role || user.role) === 'ADMIN') && accounts.length > 0 && (
          <div className="glass-panel" style={{ 
            padding: '0.75rem 1rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <FiGlobe style={{ fontSize: '1.2rem', color: '#666' }} />
            <label htmlFor="user-selector" style={{ fontWeight: '600', color: '#333', whiteSpace: 'nowrap' }}>View as:</label>
            <select 
              id="user-selector"
              value={selectedUserId || ''}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedUserId(val ? Number(val) : null);
              }}
              style={{ 
                padding: '0.5rem 0.75rem', 
                borderRadius: '6px', 
                border: '2px solid #e0e0e0',
                minWidth: '220px',
                fontSize: '0.95rem',
                fontWeight: '500',
                backgroundColor: 'white',
                cursor: 'pointer',
                transition: 'border-color 0.2s ease'
              }}
              onFocus={(e) => e.target.style.borderColor = '#4CAF50'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            >
              <option value="">📊 All Users (Admin View)</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  👤 {acc.display_name || acc.username} - {acc.role === 'ADMIN' ? '🔑 Admin' : acc.role === 'SERVER_ADMIN' ? '🛠️ Server Admin' : '👁️ Viewer'}
                </option>
              ))}
            </select>
            {selectedUserId && (
              <button 
                onClick={() => setSelectedUserId(null)}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: '#f44336',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  transition: 'background-color 0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#d32f2f'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#f44336'}
                title="Clear selection"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      
      <p>Year: {data.year} — Year-to-date revenue: {fmtCurrency(data.yearTotals.revenue_cents, currency)}</p>

      <div className="stat-banners">
        <div className="stat-banner glass-panel">
          <div className="stat-label"><FiCalendar style={{verticalAlign:'middle', marginRight:6}}/>This month</div>
          <div className="stat-value"><span className="stat-amount">{Math.round(thisMonthSum/100).toLocaleString()}</span> <span className="stat-currency">{currency}</span></div>
        </div>
        <div className="stat-banner glass-panel">
          <div className="stat-label"><FiClock style={{verticalAlign:'middle', marginRight:6}}/>Last 6 months</div>
          <div className="stat-value"><span className="stat-amount">{Math.round(last6Sum/100).toLocaleString()}</span> <span className="stat-currency">{currency}</span></div>
        </div>
        <div className="stat-banner glass-panel">
          <div className="stat-label"><FiTrendingUp style={{verticalAlign:'middle', marginRight:6}}/>Last 12 months</div>
          <div className="stat-value"><span className="stat-amount">{Math.round(last12Sum/100).toLocaleString()}</span> <span className="stat-currency">{currency}</span></div>
        </div>
        <div className="stat-banner glass-panel">
          <div className="stat-label">This year</div>
          <div className="stat-value"><span className="stat-amount">{Math.round(thisYearSum/100).toLocaleString()}</span> <span className="stat-currency">{currency}</span></div>
        </div>
        <div className="stat-banner glass-panel">
          <div className="stat-label">Last year</div>
          <div className="stat-value"><span className="stat-amount">{Math.round(lastYearSum/100).toLocaleString()}</span> <span className="stat-currency">{currency}</span></div>
        </div>
        <div className="stat-banner glass-panel">
          <div className="stat-label"><FiGlobe style={{verticalAlign:'middle', marginRight:6}}/>All time total</div>
          <div className="stat-value"><span className="stat-amount">{Math.round(allTimeSum/100).toLocaleString()}</span> <span className="stat-currency">{currency}</span></div>
        </div>
      </div>

      {/* Snapshot Management - Only for ADMIN */}
      {(user && (user.user?.role || user.role) === 'ADMIN') && (
        <div className="glass-panel" style={{ 
          padding: '1rem', 
          marginBottom: '1rem', 
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FiSave />
                Financial Snapshots
              </h3>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>
                Generate permanent monthly snapshots based on user counts and prices at month-end. 
                Snapshots are read-only and won't change with future price or user updates.
              </p>
            </div>
            <button 
              onClick={() => generateSnapshot()}
              disabled={generatingSnapshot}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: generatingSnapshot ? '#ccc' : '#4CAF50',
                color: 'white',
                cursor: generatingSnapshot ? 'not-allowed' : 'pointer',
                fontSize: '0.95rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'background-color 0.2s ease',
                whiteSpace: 'nowrap'
              }}
              onMouseEnter={(e) => !generatingSnapshot && (e.target.style.backgroundColor = '#45a049')}
              onMouseLeave={(e) => !generatingSnapshot && (e.target.style.backgroundColor = '#4CAF50')}
              title="Generate snapshot for the previous month"
            >
              {generatingSnapshot ? '⏳ Generating...' : '📸 Generate Previous Month'}
            </button>
          </div>
          {snapshotMessage && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem',
              borderRadius: '6px',
              backgroundColor: snapshotMessage.startsWith('✅') ? '#d4edda' : '#f8d7da',
              color: snapshotMessage.startsWith('✅') ? '#155724' : '#721c24',
              border: `1px solid ${snapshotMessage.startsWith('✅') ? '#c3e6cb' : '#f5c6cb'}`,
              fontSize: '0.9rem'
            }}>
              {snapshotMessage}
            </div>
          )}
        </div>
      )}

      <div className="duration-controls">
        <div className="duration-buttons">
          <button onClick={() => {
            setDuration('this');
            const last = data.months[data.months.length-1];
            setStartDate(toDate(monthToISO(last.month)));
            setEndDate(toDate(monthToISO(last.month)));
          }}>This month</button>
          <button onClick={() => {
            setDuration('last6');
            const startIdx = Math.max(0, data.months.length-6);
            setStartDate(toDate(monthToISO(data.months[startIdx].month)));
            setEndDate(toDate(monthToISO(data.months[data.months.length-1].month)));
          }}>Last 6 months</button>
          <button onClick={() => {
            setDuration('last12');
            setStartDate(toDate(monthToISO(data.months[0].month)));
            setEndDate(toDate(monthToISO(data.months[data.months.length-1].month)));
          }}>Last 12 months</button>
          <button onClick={() => {
            setDuration('thisYear');
            const y = data.year;
            const start = `${y}-01-01`;
            const end = `${y}-12-01`;
            setStartDate(toDate(start));
            setEndDate(toDate(end));
          }}>This year</button>
          <button onClick={() => {
            setDuration('lastYear');
            const y = data.year - 1;
            setStartDate(toDate(`${y}-01-01`));
            setEndDate(toDate(`${y}-12-01`));
          }}>Last year</button>
        </div>
        <div className="date-pickers">
          <div style={{display:'flex', gap:12, alignItems:'flex-start'}}>
            <div>
              <div style={{fontSize:12, marginBottom:6, color:'inherit', fontWeight:700}}>Pick range</div>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <label style={{display:'flex', flexDirection:'column', fontSize:12}}>
                  Start
                  <span className="date-input-wrapper">
                    <input
                      type="date"
                      value={startDate ? (() => {
                        const d = toDate(startDate);
                        if (!d) return '';
                        const yyyy = d.getUTCFullYear();
                        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                        const dd = String(d.getUTCDate()).padStart(2, '0');
                        return `${yyyy}-${mm}-${dd}`;
                      })() : ''}
                      onChange={(e) => setStartDate(toDate(e.target.value))}
                    />
                    <span className="date-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                        <title>Calendar</title>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" stroke="currentColor" fill="none" />
                        <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" stroke="currentColor" />
                        <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" stroke="currentColor" />
                        <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" stroke="currentColor" />
                      </svg>
                    </span>
                  </span>
                </label>
                <label style={{display:'flex', flexDirection:'column', fontSize:12}}>
                  End
                  <span className="date-input-wrapper">
                    <input
                      type="date"
                      value={endDate ? (() => {
                        const d = toDate(endDate);
                        if (!d) return '';
                        const yyyy = d.getUTCFullYear();
                        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                        const dd = String(d.getUTCDate()).padStart(2, '0');
                        return `${yyyy}-${mm}-${dd}`;
                      })() : ''}
                      onChange={(e) => setEndDate(toDate(e.target.value))}
                    />
                    <span className="date-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                        <title>Calendar</title>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" stroke="currentColor" fill="none" />
                        <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" stroke="currentColor" />
                        <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" stroke="currentColor" />
                        <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" stroke="currentColor" />
                      </svg>
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {startDate && endDate && startDate.getTime() > endDate.getTime() ? (
        <div style={{color:'#ffdcdd', background:'#4b1a1a', padding:'8px 12px', borderRadius:6, marginBottom:12}}>Start date must be before or equal to End date.</div>
      ) : null}

      <div className="financial-grid">
      <section className="financial-summary glass-panel">
        <h3>Monthly statements (last 12 months)</h3>
        <div className="chart-wrapper">
          <Bar data={chartData} options={options} />
        </div>

        {selectedMonth ? (
          <div className="financial-month-details glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0 }}>Details for {formatWithAppTZ(toDate(monthToISO(selectedMonth.month)), { month: 'long', year: 'numeric' })}</h4>
              {selectedMonth.is_snapshot && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  backgroundColor: '#d4edda',
                  color: '#155724',
                  fontSize: '0.75rem',
                  fontWeight: '600'
                }}>
                  <FiCheck size={12} /> Snapshot
                </span>
              )}
            </div>
            <div>Revenue: {fmtCurrency(selectedMonth.revenue_cents, currency)}</div>
            <div>Mini: {selectedMonth.counts.Mini} × {fmtCurrency(selectedMonth.prices.price_mini_cents || 0, currency)}</div>
            <div>Basic: {selectedMonth.counts.Basic} × {fmtCurrency(selectedMonth.prices.price_basic_cents || 0, currency)}</div>
            <div>Unlimited: {selectedMonth.counts.Unlimited} × {fmtCurrency(selectedMonth.prices.price_unlimited_cents || 0, currency)}</div>
            {selectedMonth.is_snapshot && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#666', fontStyle: 'italic' }}>
                This is a permanent snapshot from month-end. Values won't change with future updates.
              </div>
            )}
          </div>
        ) : (
          <div className="financial-month-details glass-panel">
            <em>Click a bar to see breakdown for that month.</em>
          </div>
        )}
      </section>

      <section className="monthly-table-section glass-panel">
        <h3><FiCalendar style={{ verticalAlign: 'middle', marginRight: 10 }} />Monthly revenue</h3>
        <div className="table-scroll">
          <table className="monthly-table" role="table" aria-label="Monthly revenue table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Month</th>
                <th style={{textAlign:'right'}}><span className="full">Mini</span><span className="abbr">M</span></th>
                <th style={{textAlign:'right'}}><span className="full">Basic</span><span className="abbr">B</span></th>
                <th style={{textAlign:'right'}}><span className="full">Unlimited</span><span className="abbr">UL</span></th>
                <th style={{textAlign:'right'}}>Revenue</th>
                <th style={{textAlign:'center'}}>Status</th>
              </tr>
            </thead>
            <tbody>
        {tableMonths.map((m) => {
          // Always format the month column as the full month name (MMMM)
          const monthDate = toDate(monthToISO(m.month));
          // Use Intl.DateTimeFormat directly for an isolated MMMM (full month name)
          // while respecting the app timezone setting. We avoid formatWithAppTZ here
          // because it injects default date/time styles when year/time are not present.
          const tz = getStoredTimezone();
          const fmtOpts = tz && tz !== 'auto' ? { month: 'long', timeZone: tz } : { month: 'long' };
          const monthName = monthDate ? new Intl.DateTimeFormat(undefined, fmtOpts).format(monthDate) : (m.month || '');
          const year = monthDate ? monthDate.getUTCFullYear() : (m.month || '').slice(0,4);
          const isCurrentMonth = m.month === new Date().toISOString().slice(0, 7);
          const role = user && (user.user?.role || user.role);
          return (
            <tr key={m.month}>
              <td>{year}</td>
              <td>{monthName}</td>
                    <td style={{textAlign:'right'}}>{(m.counts && m.counts.Mini) || 0}</td>
                    <td style={{textAlign:'right'}}>{(m.counts && m.counts.Basic) || 0}</td>
                    <td style={{textAlign:'right'}}>{(m.counts && m.counts.Unlimited) || 0}</td>
                    <td style={{textAlign:'right'}}>{Math.round(Number(m.revenue_cents || 0) / 100).toLocaleString()} <span className="table-currency">{currency}</span></td>
                    <td style={{textAlign:'center'}}>
                      {m.is_snapshot ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: '#d4edda',
                          color: '#155724',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }} title="Permanent snapshot">
                          <FiCheck size={12} /> Snapshot
                        </span>
                      ) : isCurrentMonth ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: '#fff3cd',
                          color: '#856404',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }} title="Current month - changes in real-time">
                          Current
                        </span>
                      ) : role === 'ADMIN' ? (
                        <button
                          onClick={() => generateSnapshot(m.month)}
                          disabled={generatingSnapshot}
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: generatingSnapshot ? '#e0e0e0' : '#007bff',
                            color: 'white',
                            cursor: generatingSnapshot ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            whiteSpace: 'nowrap'
                          }}
                          title={`Generate snapshot for ${monthName} ${year}`}
                        >
                          Generate
                        </button>
                      ) : (
                        <span style={{
                          display: 'inline-flex',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: '#f8f9fa',
                          color: '#6c757d',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          Calculated
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Totals</strong></td>
                <td></td>
                <td style={{textAlign:'right'}}><strong>{totals.mini}</strong></td>
                <td style={{textAlign:'right'}}><strong>{totals.basic}</strong></td>
                <td style={{textAlign:'right'}}><strong>{totals.unlimited}</strong></td>
                <td style={{textAlign:'right'}}><strong>{Math.round(totals.revenue/100).toLocaleString()} <span className="table-currency">{currency}</span></strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      </div>
    </div>
  );
}
