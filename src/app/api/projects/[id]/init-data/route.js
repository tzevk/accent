import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/projects/[id]/init-data
 * 
 * Combined endpoint that fetches ALL reference/master data needed by the
 * project edit page in a single request. Uses one DB connection and runs
 * queries sequentially (MySQL connections are single-threaded anyway).
 * 
 * Replaces 7+ separate API calls with one round-trip.
 */

export async function GET(request) {
  const startTime = Date.now();
  let db;
  
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    db = await dbConnect();

    // Run queries sequentially on one connection (MySQL serializes on a connection anyway)
    // Use try/catch per query so one failing table doesn't break all data

    let companies = [];
    try {
      const [rows] = await db.execute('SELECT id, company_id, company_name, city, contact_person, industry, email, phone FROM companies ORDER BY company_name ASC');
      companies = rows;
    } catch { /* table may not exist yet */ }

    let vendors = [];
    try {
      const [rows] = await db.execute("SELECT id, vendor_name, contact_person, email, phone, city, gst_vat_tax_id, status FROM vendors WHERE status != 'deleted' ORDER BY vendor_name ASC");
      vendors = rows;
    } catch {
      try {
        const [rows] = await db.execute("SELECT id, vendor_name, contact_person, email, phone, city, status FROM vendors WHERE status != 'deleted' ORDER BY vendor_name ASC");
        vendors = rows;
      } catch { /* table may not exist */ }
    }

    let functions = [];
    try {
      const [rows] = await db.execute('SELECT id, function_name, status, description, created_at, updated_at FROM functions_master ORDER BY function_name');
      functions = rows;
    } catch { /* table may not exist */ }

    let activities = [];
    try {
      const [rows] = await db.execute('SELECT id, function_id, activity_name, COALESCE(default_manhours, 0) as default_manhours, created_at, updated_at FROM activities_master ORDER BY activity_name');
      activities = rows;
    } catch {
      try {
        const [rows] = await db.execute('SELECT id, function_id, activity_name, created_at, updated_at FROM activities_master ORDER BY activity_name');
        activities = rows;
      } catch { /* table may not exist */ }
    }

    let subActivities = [];
    try {
      const [rows] = await db.execute('SELECT id, activity_id, name, description, status FROM sub_activities ORDER BY name ASC');
      subActivities = rows;
    } catch { /* table may not exist */ }

    let users = [];
    try {
      const [rows] = await db.execute(
        `SELECT u.id, u.username, u.full_name, u.email, u.role, u.department, u.status, u.is_super_admin, u.employee_id, u.vendor_id, u.account_type,
                CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
                e.employee_id as employee_code,
                e.department as employee_department,
                e.position as employee_position,
                r.display_name as role_name,
                r.role_key
         FROM users u
         LEFT JOIN employees e ON u.employee_id = e.id
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.is_active = TRUE
         ORDER BY u.created_at DESC`
      );
      users = rows;
    } catch (usersError) {
      console.warn('init-data: Users JOIN query failed, trying simple query:', usersError.message);
      // Fallback: simpler query if JOINs fail (tables may not exist)
      try {
        const [rows] = await db.execute("SELECT id, username, full_name, email, role, department, status, is_super_admin, employee_id FROM users WHERE is_active = TRUE ORDER BY created_at DESC");
        users = rows;
      } catch (simpleFail) {
        console.error('init-data: Simple users query also failed:', simpleFail.message);
      }
    }

    let softwareCategories = [];
    let softwares = [];
    let softwareVersions = [];
    try {
      const [cats] = await db.execute('SELECT id, name, description, status FROM software_categories ORDER BY name');
      softwareCategories = cats;
      const [sws] = await db.execute('SELECT id, category_id, name, provider, created_at, updated_at FROM softwares ORDER BY name');
      softwares = sws;
      const [vers] = await db.execute('SELECT id, software_id, name, release_date, notes FROM software_versions ORDER BY name');
      softwareVersions = vers;
    } catch { /* tables may not exist */ }

    let docMaster = [];
    try {
      const [rows] = await db.execute('SELECT id, doc_key, name, status, description FROM documents_master ORDER BY name ASC');
      docMaster = rows;
    } catch { /* table may not exist */ }

    // Build nested software master structure
    const softwareMaster = softwareCategories.map(cat => ({
      ...cat,
      softwares: softwares
        .filter(sw => String(sw.category_id) === String(cat.id))
        .map(sw => ({
          ...sw,
          versions: softwareVersions.filter(v => String(v.software_id) === String(sw.id))
        }))
    }));

    // Build nested functions with activities (matching activity-master API shape)
    const functionsWithActivities = functions.map(fn => ({
      id: fn.id,
      function_name: fn.function_name,
      status: fn.status,
      description: fn.description,
      created_at: fn.created_at,
      updated_at: fn.updated_at,
      activities: activities
        .filter(act => String(act.function_id) === String(fn.id))
        .map(act => ({
          id: act.id,
          activity_name: act.activity_name,
          default_manhours: parseFloat(act.default_manhours) || 0,
          created_at: act.created_at,
          updated_at: act.updated_at
        }))
    }));

    const queryTime = Date.now() - startTime;

    const response = NextResponse.json({
      success: true,
      data: {
        companies,
        vendors,
        functions: functionsWithActivities,
        activities,
        subActivities,
        users,
        softwareCategories: softwareMaster,
        docMaster,
      },
      _meta: { queryTimeMs: queryTime }
    });

    // Cache reference data for 60 seconds
    response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    
    return response;

  } catch (error) {
    console.error('Project init-data error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch init data', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { console.error('Error releasing connection:', e); }
    }
  }
}
