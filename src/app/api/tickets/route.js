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
      subject VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category ENUM('payroll', 'leave', 'policy', 'access_cards', 'seating', 'maintenance', 'general_request', 'confidential') DEFAULT 'general_request',
      priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
      status ENUM('new', 'under_review', 'in_progress', 'waiting_for_employee', 'resolved', 'closed') DEFAULT 'new',
      routed_to ENUM('hr', 'admin') NOT NULL,
      attachment_url VARCHAR(500),
      assigned_to INT,
      resolution_notes TEXT,
      resolved_at DATETIME,
      resolved_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_priority (priority),
      INDEX idx_routed_to (routed_to),
      INDEX idx_category (category),
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

// Route ticket based on category
function routeTicketByCategory(category) {
  const hrCategories = ['payroll', 'leave', 'policy', 'confidential'];
  const adminCategories = ['access_cards', 'seating', 'maintenance', 'general_request'];
  
  if (hrCategories.includes(category)) {
    return 'hr';
  } else if (adminCategories.includes(category)) {
    return 'admin';
  }
  return 'admin'; // Default to admin
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
    const routedTo = searchParams.get('routed_to');
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
    
    if (routedTo) {
      query += ` AND t.routed_to = ?`;
      params.push(routedTo);
    }
    
    query += ` ORDER BY 
      CASE t.priority 
        WHEN 'urgent' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        WHEN 'low' THEN 4 
      END,
      t.created_at DESC`;
    
    const [tickets] = await connection.execute(query, params);
    
    return NextResponse.json({ success: true, data: tickets });
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
      subject,
      description,
      category = 'general_request',
      priority = 'medium',
      attachment_url
    } = body;
    
    if (!subject || !description) {
      return NextResponse.json({ 
        success: false, 
        error: 'Subject and description are required' 
      }, { status: 400 });
    }
    
    const connection = await dbConnect();
    const ticketNumber = await generateTicketNumber(connection);
    
    // Auto-route ticket based on category
    const routedTo = routeTicketByCategory(category);
    
    const [result] = await connection.execute(
      `INSERT INTO support_tickets (
        ticket_number, user_id, subject, description, category, priority,
        routed_to, attachment_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketNumber,
        session.user.id,
        subject,
        description,
        category,
        priority,
        routedTo,
        attachment_url || null
      ]
    );
    
    // Fetch the created ticket
    const [tickets] = await connection.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [result.insertId]
    );
    
    return NextResponse.json({ 
      success: true, 
      data: tickets[0],
      message: `Ticket ${ticketNumber} created successfully. Routed to ${routedTo.toUpperCase()}.`
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
      data: updated[0]
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
