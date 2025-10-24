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
    
    // Add lead_id column if it doesn't exist
    try {
      await db.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_id VARCHAR(50)');
    } catch (err) {
      console.warn('lead_id column might already exist:', err);
    }
    
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
  // Helper: basic email validation
  const isValidEmail = (email) => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  };

  // Helper: format date (accepts YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY, MM/DD/YYYY)
  const formatDateForMySQL = (dateString) => {
    if (!dateString) return null;
    const s = String(dateString).trim();
    if (!s) return null;
    // YYYY-MM-DD
    const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    const dmy = /^(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})$/; // DD/MM/YYYY or DD.MM.YYYY
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/; // MM/DD/YYYY
    if (ymd.test(s)) return s;
    let m;
    if ((m = s.match(dmy))) {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      const year = m[3];
      return `${year}-${month}-${day}`;
    }
    if ((m = s.match(mdy))) {
      const month = m[1].padStart(2, '0');
      const day = m[2].padStart(2, '0');
      const year = m[3];
      return `${year}-${month}-${day}`;
    }
    return null;
  };

  // Normalize helper: return null for undefined/empty, and coerce types when requested
  const normalize = (v, type) => {
    if (typeof v === 'undefined' || v === null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    if (type === 'int') {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    }
    if (type === 'email') {
      const s = String(v).trim();
      return isValidEmail(s) ? s : null;
    }
    if (type === 'date') {
      return formatDateForMySQL(v);
    }
    if (type === 'cc') {
      // Accept array or comma-separated string; return comma-separated valid emails or null
      if (Array.isArray(v)) {
        const filtered = v.map(e => String(e || '').trim()).filter(e => isValidEmail(e));
        return filtered.length ? filtered.join(',') : null;
      }
      const str = String(v || '').trim();
      if (!str) return null;
      const parts = str.split(',').map(p => p.trim()).filter(p => isValidEmail(p));
      return parts.length ? parts.join(',') : null;
    }
    if (type === 'priority') {
      const p = String(v).trim().toUpperCase();
      return ['H', 'M', 'L'].includes(p) ? p : 'M';
    }
    // default: text
    return typeof v === 'string' ? v.trim() : v;
  };

  try {
    const data = await request.json();
    
    const {
      lead_id,
      company_id,
      company_name,
      contact_name,
      contact_email,
      inquiry_email,
      cc_emails,
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
    
    // Add columns if they don't exist
    try {
      await db.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_id VARCHAR(50)');
      await db.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_id INT');
      await db.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS inquiry_email VARCHAR(255)');
      await db.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS cc_emails TEXT');
    } catch (err) {
      console.warn('Columns might already exist:', err.message);
    }
    
    // Convert empty company_id to null
    const companyIdValue = company_id && company_id !== '' ? company_id : null;
    
    // Auto-generate lead_id in format: serial-month-year (e.g., 001-10-2024)
    let generatedLeadId = lead_id;
    if (!generatedLeadId || !generatedLeadId.trim()) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const currentPattern = `-${month}-${year}`;
      
      // Find highest lead_id serial number for current month/year
      const [leads] = await db.execute(
        'SELECT lead_id FROM leads WHERE lead_id LIKE ? ORDER BY lead_id DESC',
        [`%${currentPattern}`]
      );
      
      let maxSerial = 0;
      leads.forEach(l => {
        if (l.lead_id && l.lead_id.endsWith(currentPattern)) {
          const serialPart = l.lead_id.split('-')[0];
          const serial = parseInt(serialPart, 10);
          if (!isNaN(serial) && serial > maxSerial) {
            maxSerial = serial;
          }
        }
      });
      
      const nextSerial = String(maxSerial + 1).padStart(3, '0');
      generatedLeadId = `${nextSerial}-${month}-${year}`;
    }
    
    // Prepare normalized values for insert using the typed normalize helper
    const normalizedLeadId = normalize(generatedLeadId);
    const normalizedCompanyId = normalize(companyIdValue, 'int');
    const normalizedCompanyName = normalize(company_name);
    const normalizedContactName = normalize(contact_name);
    const normalizedContactEmail = normalize(contact_email, 'email');
    const normalizedInquiryEmail = normalize(inquiry_email, 'email');
    const normalizedCc = normalize(cc_emails, 'cc');
    const normalizedPhone = normalize(phone);
    const normalizedCity = normalize(city);
    const normalizedProject = normalize(project_description);
    const normalizedEnquiryType = normalize(enquiry_type);
    const normalizedEnquiryStatus = normalize(enquiry_status);
    const normalizedEnquiryDate = normalize(enquiry_date, 'date');
    const normalizedLeadSource = normalize(lead_source);
    const normalizedPriority = normalize(priority, 'priority');
    const normalizedNotes = normalize(notes);

    const [result] = await db.execute(`
      INSERT INTO leads (
        lead_id, company_id, company_name, contact_name, contact_email, inquiry_email, cc_emails,
        phone, city, project_description, enquiry_type, enquiry_status, enquiry_date,
        lead_source, priority, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      normalizedLeadId,
      normalizedCompanyId,
      normalizedCompanyName,
      normalizedContactName,
      normalizedContactEmail,
      normalizedInquiryEmail,
      normalizedCc,
      normalizedPhone,
      normalizedCity,
      normalizedProject,
      normalizedEnquiryType,
      normalizedEnquiryStatus,
      normalizedEnquiryDate,
      normalizedLeadSource,
      normalizedPriority,
      normalizedNotes
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
      error: 'Failed to create lead',
      details: error.message 
    }, { status: 500 });
  }
}
