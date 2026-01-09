import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch quotations (from both quotations and project_quotations tables)
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const source = searchParams.get('source'); // 'all', 'quotations', 'projects'
    const offset = (page - 1) * limit;

    connection = await dbConnect();

    // Check if quotations table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS quotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quotation_number VARCHAR(50) UNIQUE NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        client_phone VARCHAR(50),
        client_address TEXT,
        subject VARCHAR(500),
        items JSON,
        subtotal DECIMAL(15, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 2) DEFAULT 18,
        tax_amount DECIMAL(15, 2) DEFAULT 0,
        discount DECIMAL(15, 2) DEFAULT 0,
        total DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        valid_until DATE,
        status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      )
    `);

    // Check if project_quotations table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS project_quotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        quotation_number VARCHAR(100),
        quotation_date DATE,
        enquiry_number VARCHAR(100),
        enquiry_quantity VARCHAR(255),
        scope_of_work TEXT,
        gross_amount DECIMAL(15, 2) DEFAULT 0,
        gst_percentage DECIMAL(5, 2) DEFAULT 18,
        gst_amount DECIMAL(15, 2) DEFAULT 0,
        net_amount DECIMAL(15, 2) DEFAULT 0,
        status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id)
      )
    `);

    // Add status column to project_quotations if it doesn't exist
    try {
      await connection.execute(`
        ALTER TABLE project_quotations 
        ADD COLUMN status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft'
      `);
    } catch (alterError) {
      // Column might already exist, ignore
    }

    // Add subject column to quotations if it doesn't exist
    try {
      await connection.execute(`ALTER TABLE quotations ADD COLUMN subject VARCHAR(500)`);
    } catch (alterError) {
      // Column might already exist, ignore
    }

    // Add total column to quotations if it doesn't exist
    try {
      await connection.execute(`ALTER TABLE quotations ADD COLUMN total DECIMAL(15, 2) DEFAULT 0`);
    } catch (alterError) {
      // Column might already exist, ignore
    }

    // Add valid_until column to quotations if it doesn't exist
    try {
      await connection.execute(`ALTER TABLE quotations ADD COLUMN valid_until DATE`);
    } catch (alterError) {
      // Column might already exist, ignore
    }

    // Add status column to quotations if it doesn't exist
    try {
      await connection.execute(`ALTER TABLE quotations ADD COLUMN status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft'`);
    } catch (alterError) {
      // Column might already exist, ignore
    }

    // Build combined query using UNION to get from both tables
    let allQuotations = [];
    
    // Query from quotations table
    if (!source || source === 'all' || source === 'quotations') {
      let query1 = `
        SELECT 
          id,
          quotation_number,
          client_name,
          NULL as client_email,
          subject,
          total,
          created_at,
          valid_until,
          status,
          'quotations' as source
        FROM quotations WHERE 1=1
      `;
      const params1 = [];
      
      if (status && status !== 'all') {
        query1 += ' AND status = ?';
        params1.push(status);
      }
      
      const [quotations] = await connection.execute(query1, params1);
      allQuotations = [...allQuotations, ...quotations];
    }

    // Query from project_quotations table (joined with projects for client name)
    if (!source || source === 'all' || source === 'projects') {
      // Query from project_quotations table without projects join to avoid table structure issues
      let query2 = `
        SELECT 
          pq.id,
          pq.quotation_number,
          COALESCE(pq.client_name, pq.enquiry_number) as client_name,
          NULL as client_email,
          pq.scope_of_work as subject,
          pq.net_amount as total,
          pq.created_at,
          DATE_ADD(pq.quotation_date, INTERVAL 30 DAY) as valid_until,
          COALESCE(pq.status, 'draft') as status,
          'project' as source,
          pq.project_id,
          NULL as project_name
        FROM project_quotations pq
        WHERE pq.quotation_number IS NOT NULL AND pq.quotation_number != ''
      `;
      const params2 = [];
      
      if (status && status !== 'all') {
        query2 += ' AND pq.status = ?';
        params2.push(status);
      }
      
      const [projectQuotations] = await connection.execute(query2, params2);
      
      // Try to fetch project names separately if projects table exists
      try {
        for (let q of projectQuotations) {
          if (q.project_id) {
            const [projects] = await connection.execute(
              'SELECT name, client_name FROM projects WHERE id = ? LIMIT 1',
              [q.project_id]
            );
            if (projects.length > 0) {
              q.project_name = projects[0].name;
              if (!q.client_name || q.client_name === q.enquiry_number) {
                q.client_name = projects[0].client_name || q.client_name;
              }
              if (!q.subject) {
                q.subject = projects[0].name;
              }
            }
          }
        }
      } catch (e) {
        // Projects table might not exist or have different structure, ignore
      }
      
      allQuotations = [...allQuotations, ...projectQuotations];
    }

    // Sort by created_at descending
    allQuotations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Get total count
    const total = allQuotations.length;

    // Paginate
    const paginatedQuotations = allQuotations.slice(offset, offset + limit);

    // Calculate stats from combined data
    const stats = {
      total: allQuotations.length,
      draft: allQuotations.filter(q => q.status === 'draft' || !q.status).length,
      sent: allQuotations.filter(q => q.status === 'sent').length,
      approved: allQuotations.filter(q => q.status === 'approved').length,
      rejected: allQuotations.filter(q => q.status === 'rejected').length
    };

    return NextResponse.json({
      success: true,
      data: paginatedQuotations,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching quotations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch quotations' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// POST - Create new quotation
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.CREATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      quotation_number,
      client_name,
      client_email,
      client_phone,
      client_address,
      subject,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      notes,
      terms,
      valid_until,
      status
    } = body;

    if (!quotation_number || !client_name) {
      return NextResponse.json(
        { success: false, error: 'Quotation number and client name are required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      `INSERT INTO quotations 
       (quotation_number, client_name, client_email, client_phone, client_address, subject, items, subtotal, tax_rate, tax_amount, discount, total, notes, terms, valid_until, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation_number,
        client_name,
        client_email || null,
        client_phone || null,
        client_address || null,
        subject || null,
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 18,
        tax_amount || 0,
        discount || 0,
        total || 0,
        notes || null,
        terms || null,
        valid_until || null,
        status || 'draft',
        authResult.user?.id || null
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Quotation created successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error creating quotation:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { success: false, error: 'A quotation with this number already exists' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// PUT - Update quotation
export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      id,
      quotation_number,
      client_name,
      client_email,
      client_phone,
      client_address,
      subject,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      notes,
      terms,
      valid_until,
      status
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Quotation ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      `UPDATE quotations SET
       quotation_number = ?,
       client_name = ?,
       client_email = ?,
       client_phone = ?,
       client_address = ?,
       subject = ?,
       items = ?,
       subtotal = ?,
       tax_rate = ?,
       tax_amount = ?,
       discount = ?,
       total = ?,
       notes = ?,
       terms = ?,
       valid_until = ?,
       status = ?
       WHERE id = ?`,
      [
        quotation_number,
        client_name,
        client_email || null,
        client_phone || null,
        client_address || null,
        subject || null,
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 18,
        tax_amount || 0,
        discount || 0,
        total || 0,
        notes || null,
        terms || null,
        valid_until || null,
        status || 'draft',
        id
      ]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Quotation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Quotation updated successfully'
    });
  } catch (error) {
    console.error('Error updating quotation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// DELETE - Delete quotation
export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.DELETE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Quotation ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      'DELETE FROM quotations WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Quotation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Quotation deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting quotation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
