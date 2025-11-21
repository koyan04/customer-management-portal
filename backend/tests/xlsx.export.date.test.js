const XLSX = require('xlsx');

// A small unit test that simulates our export formatting to ensure dates remain unchanged
function fmtYMDLocal(val) {
  if (!val) return '';
  const s = typeof val === 'string' ? val.trim() : null;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('XLSX export date stability', () => {
  test('expire_date stays as literal string in sheet', () => {
    const rows = [
      { account_name: 'alice', service_type: 'Basic', contact: 'x', expire_date: fmtYMDLocal('2025-11-30'), total_devices: 2, data_limit_gb: 100, remark: '' },
      { account_name: 'bob', service_type: 'Basic', contact: 'y', expire_date: fmtYMDLocal('2026-04-07'), total_devices: 2, data_limit_gb: 100, remark: '' },
      { account_name: 'tin', service_type: 'Mini', contact: 'z', expire_date: fmtYMDLocal('2025-11-23'), total_devices: 1, data_limit_gb: 100, remark: '' },
    ];

    const headers = ['account_name','service_type','contact','expire_date','total_devices','data_limit_gb','remark'];
    const aoa = [headers];
    for (const row of rows) {
      aoa.push([
        row.account_name,
        row.service_type,
        row.contact,
        typeof row.expire_date === 'string' ? row.expire_date : '',
        row.total_devices,
        row.data_limit_gb,
        row.remark
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 1; r < aoa.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ c: 3, r });
      if (ws[cellRef]) ws[cellRef].t = 's';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');

    // Read back the sheet values and assert exact strings
    const read = XLSX.utils.sheet_to_json(wb.Sheets.Users, { header: 1 });
    expect(read[1][3]).toBe('2025-11-30');
    expect(read[2][3]).toBe('2026-04-07');
    expect(read[3][3]).toBe('2025-11-23');
  });
});
