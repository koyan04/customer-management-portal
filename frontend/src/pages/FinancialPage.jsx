import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Bar } from 'react-chartjs-2';
// using native date inputs with calendar pick UI
import { FiCalendar, FiClock, FiTrendingUp, FiGlobe } from 'react-icons/fi';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function fmtCurrency(cents, currency = 'USD') {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinancialPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [duration, setDuration] = useState('last6');
  const [startDate, setStartDate] = useState(null); // Date
  const [endDate, setEndDate] = useState(null); // Date
  const [validationMsg, setValidationMsg] = useState(null);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get('/api/admin/financial', { headers, validateStatus: () => true });
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
  }, [token]);

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

  if (loading) return <div className="app-container">Loading financials…</div>;
  if (error) return <div className="app-container">Failed to load financials: {error}</div>;
  if (!data) return <div className="app-container">No data</div>;

  const months = data.months || [];
  const labels = months.map(m => m.month);
  const revenues = months.map(m => Number(m.revenue_cents || 0) / 100);
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
  const barDataLabelsPlugin = {
    id: 'barDataLabels',
    afterDatasetsDraw: (chart) => {
      const { ctx, data } = chart;
      ctx.save();
      data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        meta.data.forEach((bar, i) => {
          const val = dataset.data[i];
          if (val == null) return;
          const x = bar.x !== undefined ? bar.x : bar.x;
          const y = bar.y !== undefined ? bar.y : bar.y;
          ctx.fillStyle = '#e6f7f0';
          ctx.font = '600 11px Inter, system-ui, Arial';
          ctx.textAlign = 'center';
          // position above bar
          const offset = (bar.height ? Math.min(12, Math.abs(bar.height)) : 12);
          ctx.fillText(String(val).replace(/\B(?=(\d{3})+(?!\d))/g, ','), x, y - offset);
        });
      });
      ctx.restore();
    }
  };

  return (
    <div className="app-container">
      <h2 className="admin-title">Financials</h2>
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
            <h4>Details for {selectedMonth.month}</h4>
            <div>Revenue: {fmtCurrency(selectedMonth.revenue_cents, currency)}</div>
            <div>Mini: {selectedMonth.counts.Mini} × {fmtCurrency(selectedMonth.prices.price_mini_cents || 0, currency)}</div>
            <div>Basic: {selectedMonth.counts.Basic} × {fmtCurrency(selectedMonth.prices.price_basic_cents || 0, currency)}</div>
            <div>Unlimited: {selectedMonth.counts.Unlimited} × {fmtCurrency(selectedMonth.prices.price_unlimited_cents || 0, currency)}</div>
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
                <th><span className="thead-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="1.5" stroke="currentColor" fill="none" />
                      <line x1="8" y1="2" x2="8" y2="6" strokeWidth="1.5" stroke="currentColor" />
                      <line x1="16" y1="2" x2="16" y2="6" strokeWidth="1.5" stroke="currentColor" />
                    </svg>
                  </span>Year</th>
                <th><span className="thead-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="1.5" stroke="currentColor" fill="none" />
                      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="1.5" stroke="currentColor" />
                    </svg>
                  </span>Month</th>
                <th style={{textAlign:'right'}}><span className="thead-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <circle cx="6" cy="8" r="3" strokeWidth="1.2" stroke="currentColor" fill="none" />
                    </svg>
                  </span>Mini</th>
                <th style={{textAlign:'right'}}><span className="thead-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <rect x="3" y="3" width="10" height="10" strokeWidth="1.2" stroke="currentColor" fill="none" />
                    </svg>
                  </span>Basic</th>
                <th style={{textAlign:'right'}}><span className="thead-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M8 2 L9.5 6.5 L14 7.2 L10.5 10.2 L11.5 14.5 L8 12.4 L4.5 14.5 L5.5 10.2 L2 7.2 L6.5 6.5 Z" strokeWidth="0.9" stroke="currentColor" fill="none" />
                    </svg>
                  </span>Unlimited</th>
                <th style={{textAlign:'right'}}><span className="thead-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <circle cx="10" cy="10" r="7" strokeWidth="1.2" stroke="currentColor" fill="none" />
                      <text x="10" y="13" textAnchor="middle" fontSize="8" fill="currentColor">$</text>
                    </svg>
                  </span>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {tableMonths.map((m) => {
                const d = toDate(monthToISO(m.month));
                const monthName = d ? d.toLocaleString(undefined, { month: 'long' }) : m.month;
                const year = d ? d.getUTCFullYear() : (m.month || '').slice(0,4);
                return (
                  <tr key={m.month}>
                    <td>{year}</td>
                    <td>{monthName}</td>
                    <td style={{textAlign:'right'}}>{(m.counts && m.counts.Mini) || 0}</td>
                    <td style={{textAlign:'right'}}>{(m.counts && m.counts.Basic) || 0}</td>
                    <td style={{textAlign:'right'}}>{(m.counts && m.counts.Unlimited) || 0}</td>
                    <td style={{textAlign:'right'}}>{Math.round(Number(m.revenue_cents || 0) / 100).toLocaleString()} <span className="table-currency">{currency}</span></td>
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
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      </div>
    </div>
  );
}
