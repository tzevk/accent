import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

/**
 * GET /api/payroll/salary-profile/batch
 * Returns the most-recent salary profile for every active employee in one query.
 * Only returns lightweight fields needed for PL tracking on the attendance page:
 *   employee_id, pl_total, gross_salary, salary_type, effective_from
 *
 * Query params:
 *   ids   - optional comma-separated employee IDs to filter (omit for all)
 *   full  - if "1" returns all columns instead of the lightweight subset
 */
export async function GET(request) {
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get('ids');      // e.g. "1,2,3,4"
    const fullMode = searchParams.get('full') === '1';

    connection = await dbConnect();

    let whereClause = '';
    let queryParams = [];

    if (idsParam) {
      const ids = idsParam.split(',').map(Number).filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json({ success: true, data: {} });
      }
      whereClause = `WHERE sp.employee_id IN (${ids.map(() => '?').join(',')})`;
      queryParams = ids;
    }

    const selectCols = fullMode
      ? 'sp.*'
      : 'sp.employee_id, sp.pl_total, sp.gross_salary, sp.salary_type, sp.effective_from, sp.effective_to';

    // For each employee, pick the most-recent active profile (effective_from DESC)
    const [rows] = await connection.execute(
      `SELECT ${selectCols}
       FROM employee_salary_profile sp
       INNER JOIN (
         SELECT employee_id, MAX(effective_from) AS max_eff
         FROM employee_salary_profile
         GROUP BY employee_id
       ) latest ON sp.employee_id = latest.employee_id
         AND sp.effective_from = latest.max_eff
       ${whereClause}`,
      queryParams
    );

    // Return as a map keyed by employee_id for O(1) lookup
    const dataMap = {};
    rows.forEach(row => {
      dataMap[row.employee_id] = {
        ...row,
        pl_total: parseInt(row.pl_total) || 0,
        gross_salary: parseFloat(row.gross_salary) || 0
      };
    });

    return NextResponse.json({ success: true, data: dataMap });
  } catch (err) {
    console.error('Error fetching batch salary profiles:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
