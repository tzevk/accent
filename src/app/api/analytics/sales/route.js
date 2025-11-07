import { dbConnect } from '@/utils/database';

// Map statuses to canonical buckets we chart
const STATUS_MAP = {
  pending: 'Pending',
  approved: 'Approved',
  draft: 'Draft',
};

function getWindow(period) {
  const now = new Date();
  const start = new Date(now);
  const p = String(period || '').toLowerCase();
  if (p === 'monthly') start.setDate(now.getDate() - 30);
  else if (p === 'quarterly') start.setDate(now.getDate() - 90);
  else start.setDate(now.getDate() - 7); // weekly default
  // Normalize to 00:00
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString().slice(0, 19).replace('T', ' '), end: now.toISOString().slice(0, 19).replace('T', ' ') };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'Weekly';
    const metric = (searchParams.get('metric') || 'count').toLowerCase(); // 'count' | 'value'
    const { start, end } = getWindow(period);

    const db = await dbConnect();
    // Group proposals by status in the selected time window
    // Use `proposal_value` (column in proposals) instead of non-existent `value` column
    const [rows] = await db.execute(
      `SELECT LOWER(COALESCE(status, '')) as status,
              COUNT(*) as count,
              COALESCE(SUM(COALESCE(proposal_value, 0)), 0) as amount
       FROM proposals
       WHERE created_at BETWEEN ? AND ?
       GROUP BY LOWER(COALESCE(status, ''))`,
      [start, end]
    );
    await db.end();

    // Fold into our buckets
    const outCount = { Pending: 0, Approved: 0, Draft: 0 };
    const outAmount = { Pending: 0, Approved: 0, Draft: 0 };
    for (const r of rows) {
      const key = STATUS_MAP[r.status] || null;
      if (key) {
        outCount[key] += Number(r.count) || 0;
        outAmount[key] += Number(r.amount) || 0;
      }
    }
    const isValue = metric === 'value';
    const payload = isValue ? outAmount : outCount;
    const data = [
      { name: 'Pending', value: payload.Pending, color: '#FBBF24' },
      { name: 'Approved', value: payload.Approved, color: '#10B981' },
      { name: 'Draft', value: payload.Draft, color: '#60A5FA' },
    ];
    const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0);
    const conversion = total > 0 ? Math.round((((isValue ? outAmount.Approved : outCount.Approved) || 0) / total) * 100) : 0;

    return Response.json({ success: true, data, total, conversion, period, metric: isValue ? 'value' : 'count' });
  } catch (error) {
    console.error('Sales analytics error:', error);
    return Response.json({ success: false, error: 'Failed to load sales analytics' }, { status: 500 });
  }
}
