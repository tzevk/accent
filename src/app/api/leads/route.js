import { dbConnect } from '@/utils/database';

// GET all leads with pagination and filtering
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const city = searchParams.get('city') || '';
    const sortBy = searchParams.get('sortBy') || 'created_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    
    const offset = (page - 1) * limit;
    
    const db = await dbConnect();
    
    // Build WHERE clause for filtering
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (company_name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status) {
      whereClause += ' AND enquiry_status = ?';
      params.push(status);
    }
    
    if (city) {
      whereClause += ' AND city LIKE ?';
      params.push(`%${city}%`);
    }
    
    // Get total count for pagination
    const [countRows] = await db.execute(`
      SELECT COUNT(*) as total FROM leads ${whereClause}
    `, params);
    
    const total = countRows[0].total;
    
    // Validate and sanitize sort parameters
    const allowedSortFields = ['created_at', 'enquiry_date', 'company_name', 'contact_name', 'enquiry_status'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const validSortOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    // Get paginated results
    const [rows] = await db.execute(`
      SELECT * FROM leads 
      ${whereClause}
      ORDER BY ${validSortBy} ${validSortOrder}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    // Get stats
    const [statsRows] = await db.execute(`
      SELECT 
        COUNT(*) as total_leads,
        SUM(CASE WHEN enquiry_status IN ('Under Discussion', 'Proposal Sent', 'Follow Up') THEN 1 ELSE 0 END) as active_leads,
        SUM(CASE WHEN enquiry_status = 'Closed Won' THEN 1 ELSE 0 END) as won_leads,
        SUM(CASE WHEN enquiry_status = 'Under Discussion' THEN 1 ELSE 0 END) as under_discussion,
        SUM(CASE WHEN enquiry_status = 'Proposal Sent' THEN 1 ELSE 0 END) as proposal_sent,
        SUM(CASE WHEN enquiry_status = 'Follow Up' THEN 1 ELSE 0 END) as follow_up,
        SUM(CASE WHEN enquiry_status = 'Closed Won' THEN 1 ELSE 0 END) as closed_won,
        SUM(CASE WHEN enquiry_status = 'Closed Lost' THEN 1 ELSE 0 END) as closed_lost
      FROM leads
    `);
    
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: {
        leads: rows,
        stats: statsRows[0],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch leads' 
    }, { status: 500 });
  }
}

// POST new lead
export async function POST(request) {
  try {
    const data = await request.json();
    
    const {
      company_id,
      company_name,
      contact_name,
      contact_email,
      phone,
      city,
      project_description,
      enquiry_type,
      enquiry_status,
      enquiry_date,
      lead_source,
      priority,
      notes
    } = data;

    if (!company_name) {
      return Response.json({ 
        success: false, 
        error: 'Company name is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
    const [result] = await db.execute(`
      INSERT INTO leads (
        company_id, company_name, contact_name, contact_email, phone, city,
        project_description, enquiry_type, enquiry_status, enquiry_date,
        lead_source, priority, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      company_id, company_name, contact_name, contact_email, phone, city,
      project_description, enquiry_type, enquiry_status, enquiry_date,
      lead_source, priority, notes
    ]);
    
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: { 
        id: result.insertId
      },
      message: 'Lead created successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to create lead' 
    }, { status: 500 });
  }
}
