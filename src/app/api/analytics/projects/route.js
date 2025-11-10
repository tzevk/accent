import { dbConnect } from '@/utils/database';

function getWindow(period) {
  const now = new Date();
  const start = new Date(now);
  const p = String(period || '').toLowerCase();
  if (p === 'monthly') start.setDate(now.getDate() - 30);
  else if (p === 'quarterly') start.setDate(now.getDate() - 90);
  else start.setDate(now.getDate() - 7); // weekly default
  start.setHours(0, 0, 0, 0);
  return { start, end: now };
}

function fmtDateSQL(d) {
  // yyyy-mm-dd hh:mm:ss
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const STATUS_COLORS = {
  NEW: '#9CA3AF', // gray-400
  'IN-PROGRESS': '#64126D',
  IN_PROGRESS: '#64126D',
  COMPLETED: '#10B981',
  'ON HOLD': '#F59E0B',
  ON_HOLD: '#F59E0B',
  CANCELLED: '#EF4444',
};

function labelsForPeriod(period) {
  const p = String(period || '').toLowerCase();
  if (p === 'monthly') {
    // Last 12 months including current, oldest first
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(months[d.getMonth()]);
    }
    return out;
  }
  if (p === 'quarterly') {
    // Last 4 quarters, oldest first
    const now = new Date();
    const out = [];
    for (let i = 3; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
      const q = Math.floor(dt.getMonth() / 3) + 1;
      out.push(`Q${q}`);
    }
    return out;
  }
  // Weekly: last 7 days labels (Mon..Sun based on locale weekday names)
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const now = new Date();
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(days[d.getDay()]);
  }
  return out;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'Weekly';
    const metric = (searchParams.get('metric') || 'count').toLowerCase(); // 'count' | 'value'
    const { start, end } = getWindow(period);

    const db = await dbConnect();

    // Ensure projects table exists (best effort, mirrors core schema)
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS projects (
          id INT PRIMARY KEY AUTO_INCREMENT,
          project_id VARCHAR(50) UNIQUE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          company_id INT,
          client_name VARCHAR(255),
          project_manager VARCHAR(255),
          start_date DATE,
          end_date DATE,
          budget DECIMAL(15,2),
          status VARCHAR(50) DEFAULT 'NEW',
          priority VARCHAR(50) DEFAULT 'MEDIUM',
          progress INT DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    } catch {}

    // Detect if `budget` column exists on projects table; fall back if not
    const dbName = process.env.DB_NAME || null;
    let hasBudget = false;
    try {
      if (dbName) {
        const [cols] = await db.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects'`,
          [dbName]
        );
        hasBudget = cols.some(c => c.COLUMN_NAME === 'budget');
      }
    } catch (e) {
      console.warn('Failed to inspect projects table columns for analytics:', e?.message || e);
    }

    // Overall totals in the window
    let totalProjects = 0;
    let totalValue = 0;
    if (hasBudget) {
      const [totalsRows] = await db.execute(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(COALESCE(budget,0)),0) as val
         FROM projects WHERE created_at BETWEEN ? AND ?`,
        [fmtDateSQL(start), fmtDateSQL(end)]
      );
      totalProjects = Number(totalsRows?.[0]?.cnt || 0);
      totalValue = Number(totalsRows?.[0]?.val || 0);
    } else {
      const [totalsRows] = await db.execute(
        `SELECT COUNT(*) as cnt FROM projects WHERE created_at BETWEEN ? AND ?`,
        [fmtDateSQL(start), fmtDateSQL(end)]
      );
      totalProjects = Number(totalsRows?.[0]?.cnt || 0);
      totalValue = 0;
    }

    // Breakdown by status in the window (for donut)
    let statusRows;
    if (hasBudget) {
      const [sr] = await db.execute(
        `SELECT UPPER(COALESCE(status,'NEW')) as status,
                COUNT(*) as cnt,
                COALESCE(SUM(COALESCE(budget,0)),0) as val
         FROM projects
         WHERE created_at BETWEEN ? AND ?
         GROUP BY UPPER(COALESCE(status,'NEW'))`,
        [fmtDateSQL(start), fmtDateSQL(end)]
      );
      statusRows = sr;
    } else {
      const [sr] = await db.execute(
        `SELECT UPPER(COALESCE(status,'NEW')) as status,
                COUNT(*) as cnt
         FROM projects
         WHERE created_at BETWEEN ? AND ?
         GROUP BY UPPER(COALESCE(status,'NEW'))`,
        [fmtDateSQL(start), fmtDateSQL(end)]
      );
      // normalize to same shape with val = cnt when metric is 'value' (but we'll set val=0)
      statusRows = sr.map(r => ({ ...r, val: 0 }));
    }
    const breakdownByStatus = statusRows.map(r => {
      const name = String(r.status).replace(/_/g, ' ');
      const value = metric === 'value' ? Number(r.val || 0) : Number(r.cnt || 0);
      const color = STATUS_COLORS[r.status] || '#64126D';
      return { name, value, color };
    });

    // Build time-bucketed series for the bar chart
    const labels = labelsForPeriod(period);
    const series = labels.map(l => ({ label: l, value: 0 }));

    const p = String(period || '').toLowerCase();
    if (p === 'monthly') {
      // Last 12 months (oldest first)
      const now = new Date();
      const startMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const [rows] = await db.execute(
        `SELECT YEAR(created_at) as y, MONTH(created_at) as m, COUNT(*) as cnt
         FROM projects
         WHERE created_at BETWEEN ? AND ?
         GROUP BY YEAR(created_at), MONTH(created_at)
         ORDER BY y, m`,
        [fmtDateSQL(startMonth), fmtDateSQL(end)]
      );
      // Map results into the last 12 month labels
      const monthIdx = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthIdx.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
      }
      rows.forEach(r => {
        const pos = monthIdx.findIndex(x => x.y === Number(r.y) && x.m === Number(r.m));
        if (pos >= 0) series[pos].value = Number(r.cnt || 0);
      });
    } else if (p === 'quarterly') {
      // Last 4 quarters (oldest first)
      const now = new Date();
      const startQuarter = new Date(now.getFullYear(), now.getMonth() - 3 * 3, 1);
      const [rows] = await db.execute(
        `SELECT YEAR(created_at) as y, QUARTER(created_at) as q, COUNT(*) as cnt
         FROM projects
         WHERE created_at BETWEEN ? AND ?
         GROUP BY YEAR(created_at), QUARTER(created_at)
         ORDER BY y, q`,
        [fmtDateSQL(startQuarter), fmtDateSQL(end)]
      );
      const qIdx = [];
      for (let i = 3; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
        qIdx.push({ y: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1 });
      }
      rows.forEach(r => {
        const pos = qIdx.findIndex(x => x.y === Number(r.y) && x.q === Number(r.q));
        if (pos >= 0) series[pos].value = Number(r.cnt || 0);
      });
    } else {
      // Weekly: last 7 days (oldest first)
      const now = new Date();
      const startDay = new Date(now);
      startDay.setDate(now.getDate() - 6);
      startDay.setHours(0, 0, 0, 0);
      const [rows] = await db.execute(
        `SELECT DATE(created_at) as d, COUNT(*) as cnt
         FROM projects
         WHERE created_at BETWEEN ? AND ?
         GROUP BY DATE(created_at)
         ORDER BY d`,
        [fmtDateSQL(startDay), fmtDateSQL(end)]
      );
      // Index by date string yyyy-mm-dd
      const toKey = (d) => d.toISOString().slice(0,10);
      const map = new Map(rows.map(r => [String(r.d), Number(r.cnt || 0)]));
      for (let i = 6, idx = 0; i >= 0; i--, idx++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const key = toKey(d);
        series[idx].value = map.get(key) || 0;
      }
    }

    await db.end();

    return Response.json({
      success: true,
      period,
      metric,
      series,
      totals: {
        projects: totalProjects,
        value: totalValue,
      },
      breakdownByStatus,
    });
  } catch (error) {
    console.error('Project analytics error:', error);
    return Response.json({ success: false, error: 'Failed to load project analytics' }, { status: 500 });
  }
}
