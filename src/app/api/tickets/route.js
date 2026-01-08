import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';

// Ensure tickets table exists with all necessary columns
async function ensureTicketsTable() {
  const connection = await dbConnect();
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_number VARCHAR(20) UNIQUE NOT NULL,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category ENUM('login_issues', 'performance', 'bug_report', 'feature_request', 'data_issue', 'access_permission', 'other') DEFAULT 'other',
      priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
      status ENUM('open', 'in_progress', 'pending_info', 'resolved', 'closed') DEFAULT 'open',
      screenshots JSON,
      browser_info VARCHAR(255),
      page_url VARCHAR(500),
      steps_to_reproduce TEXT,
      expected_behavior TEXT,
      actual_behavior TEXT,
      assigned_to INT,
      resolution_notes TEXT,
      resolved_at DATETIME,
      resolved_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_priority (priority),
      INDEX idx_created_at (created_at)
    )
  `);
  
  // Create ticket comments table for conversation
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      user_id INT NOT NULL,
      comment TEXT NOT NULL,
      is_internal BOOLEAN DEFAULT FALSE,
      attachments JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_id (ticket_id)
    )
  `);
}

// Generate unique ticket number
async function generateTicketNumber(connection) {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const prefix = `TKT-${year}${month}-`;
  
  const [rows] = await connection.execute(
    `SELECT ticket_number FROM support_tickets 
     WHERE ticket_number LIKE ? 
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  
  let nextNum = 1;
  if (rows.length > 0) {
    const lastNum = parseInt(rows[0].ticket_number.split('-').pop(), 10);
    nextNum = lastNum + 1;
  }
  
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// GET - Fetch tickets (all for admin, own for users)
export async function GET(request) {
  try {
    await ensureTicketsTable();
    
    const session = await getServerAuth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const category = searchParams.get('category');
    const showAll = searchParams.get('all') === 'true';
    
    const connection = await dbConnect();
    
    let query = `
      SELECT 
        t.*,
        u.full_name as user_name,
        u.email as user_email,
        a.full_name as assigned_to_name,
        r.full_name as resolved_by_name
      FROM support_tickets t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN users a ON t.assigned_to = a.id
      LEFT JOIN users r ON t.resolved_by = r.id
      WHERE 1=1
    `;
    const params = [];
    
    // Only show own tickets unless admin or showAll
    if (!session.user.is_super_admin && !showAll) {
      query += ` AND t.user_id = ?`;
      params.push(session.user.id);
    }
    
    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }
    
    if (priority) {
      query += ` AND t.priority = ?`;
      params.push(priority);
    }
    
    if (category) {
      query += ` AND t.category = ?`;
      params.push(category);
    }
    
    query += ` ORDER BY 
      CASE t.priority 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        WHEN 'low' THEN 4 
      END,
      t.created_at DESC`;
    
    const [tickets] = await connection.execute(query, params);
    
    // Parse screenshots JSON
    const parsedTickets = tickets.map(ticket => ({
      ...ticket,
      screenshots: ticket.screenshots ? JSON.parse(ticket.screenshots) : []
    }));
    
    return NextResponse.json({ success: true, data: parsedTickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST - Create new ticket
export async function POST(request) {
  try {
    await ensureTicketsTable();
    
    const session = await getServerAuth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const {
      title,
      description,
      category = 'other',
      priority = 'medium',
      screenshots = [],
      browser_info,
      page_url,
      steps_to_reproduce,
      expected_behavior,
      actual_behavior
    } = body;
    
    if (!title || !description) {
      return NextResponse.json({ 
        success: false, 
        error: 'Title and description are required' 
      }, { status: 400 });
    }
    
    const connection = await dbConnect();
    const ticketNumber = await generateTicketNumber(connection);
    
    const [result] = await connection.execute(
      `INSERT INTO support_tickets (
        ticket_number, user_id, title, description, category, priority,
        screenshots, browser_info, page_url, steps_to_reproduce,
        expected_behavior, actual_behavior
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketNumber,
        session.user.id,
        title,
        description,
        category,
        priority,
        JSON.stringify(screenshots),
        browser_info || null,
        page_url || null,
        steps_to_reproduce || null,
        expected_behavior || null,
        actual_behavior || null
      ]
    );
    
    // Fetch the created ticket
    const [tickets] = await connection.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [result.insertId]
    );
    
    return NextResponse.json({ 
      success: true, 
      data: {
        ...tickets[0],
        screenshots: screenshots
      },
      message: `Ticket ${ticketNumber} created successfully`
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT - Update ticket (for admins to update status, assign, etc.)
export async function PUT(request) {
  try {
    const session = await getServerAuth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { id, status, priority, assigned_to, resolution_notes } = body;
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Ticket ID required' }, { status: 400 });
    }
    
    const connection = await dbConnect();
    
    // Check if user owns the ticket or is admin
    const [existing] = await connection.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [id]
    );
    
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
    }
    
    const ticket = existing[0];
    const isOwner = ticket.user_id === session.user.id;
    const isAdmin = session.user.is_super_admin;
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }
    
    const updates = [];
    const params = [];
    
    if (status) {
      updates.push('status = ?');
      params.push(status);
      
      // Set resolved info if being resolved
      if (status === 'resolved' || status === 'closed') {
        updates.push('resolved_at = NOW()');
        updates.push('resolved_by = ?');
        params.push(session.user.id);
      }
    }
    
    if (priority && isAdmin) {
      updates.push('priority = ?');
      params.push(priority);
    }
    
    if (assigned_to !== undefined && isAdmin) {
      updates.push('assigned_to = ?');
      params.push(assigned_to || null);
    }
    
    if (resolution_notes) {
      updates.push('resolution_notes = ?');
      params.push(resolution_notes);
    }
    
    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No updates provided' }, { status: 400 });
    }
    
    params.push(id);
    
    await connection.execute(
      `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    // Fetch updated ticket
    const [updated] = await connection.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [id]
    );
    
    return NextResponse.json({ 
      success: true, 
      data: {
        ...updated[0],
        screenshots: updated[0].screenshots ? JSON.parse(updated[0].screenshots) : []
      }
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
