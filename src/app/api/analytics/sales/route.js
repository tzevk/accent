import { dbConnect } from '@/utils/database';

// Simple in-memory cache (per server instance) to reduce repeated aggregation cost
// Keyed by period; stores both count and value payloads so metric switches are instant.
const CACHE_TTL_MS = 60_000; // 1 minute
const salesCache = new Map(); // key => { ts, data: {count:[], value:[], totals:{count:number,value:number}, conversion:{count:number,value:number}} }

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
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'Weekly';
  const metric = (searchParams.get('metric') || 'count').toLowerCase(); // 'count' | 'value'
  const nocache = searchParams.get('nocache') === '1';
  const cacheKey = period; // aggregation independent of metric (we store both)
  const nowMs = Date.now();
  const cached = !nocache && salesCache.get(cacheKey);
  if (cached && (nowMs - cached.ts) < CACHE_TTL_MS) {
    const pick = metric === 'value' ? cached.data.value : cached.data.count;
    const total = metric === 'value' ? cached.data.totals.value : cached.data.totals.count;
    const conversion = metric === 'value' ? cached.data.conversion.value : cached.data.conversion.count;
    return Response.json({ success: true, data: pick, total, conversion, period, metric });
  }
  try {
    const { start, end } = getWindow(period);
    const db = await dbConnect();

    // Ensure helpful composite index exists (created_at, status) for time-window + group by
    try {
      const [idxRows] = await db.execute(`SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name='proposals' AND index_name='idx_proposals_created_status' LIMIT 1`);
      if (!idxRows.length) {
        await db.execute(`CREATE INDEX idx_proposals_created_status ON proposals (created_at, status)`);
      }
    } catch {
      // Silent fail; index creation is opportunistic
    }

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

    const outCount = { Pending: 0, Approved: 0, Draft: 0 };
    const outAmount = { Pending: 0, Approved: 0, Draft: 0 };
    for (const r of rows) {
      const key = STATUS_MAP[r.status] || null;
      if (key) {
        outCount[key] += Number(r.count) || 0;
        outAmount[key] += Number(r.amount) || 0;
      }
    }
    const dataCount = [
      { name: 'Pending', value: outCount.Pending, color: '#FBBF24' },
      { name: 'Approved', value: outCount.Approved, color: '#10B981' },
      { name: 'Draft', value: outCount.Draft, color: '#60A5FA' },
    ];
    const dataValue = [
      { name: 'Pending', value: outAmount.Pending, color: '#FBBF24' },
      { name: 'Approved', value: outAmount.Approved, color: '#10B981' },
      { name: 'Draft', value: outAmount.Draft, color: '#60A5FA' },
    ];
    const totalCount = dataCount.reduce((a, d) => a + (Number(d.value) || 0), 0);
    const totalValue = dataValue.reduce((a, d) => a + (Number(d.value) || 0), 0);
    const conversionCount = totalCount > 0 ? Math.round(((outCount.Approved || 0) / totalCount) * 100) : 0;
    const conversionValue = totalValue > 0 ? Math.round(((outAmount.Approved || 0) / totalValue) * 100) : 0;

    // Cache both representations
    salesCache.set(cacheKey, {
      ts: nowMs,
      data: {
        count: dataCount,
        value: dataValue,
        totals: { count: totalCount, value: totalValue },
        conversion: { count: conversionCount, value: conversionValue }
      }
    });

    const pick = metric === 'value' ? dataValue : dataCount;
    const total = metric === 'value' ? totalValue : totalCount;
    const conversion = metric === 'value' ? conversionValue : conversionCount;
    return Response.json({ success: true, data: pick, total, conversion, period, metric });
  } catch (error) {
    console.error('Sales analytics error:', error);
    return Response.json({ success: false, error: 'Failed to load sales analytics' }, { status: 500 });
  }
}
