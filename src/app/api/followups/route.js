import { dbConnect } from '@/utils/database';

// GET all follow-ups
export async function GET() {
  try {
    const db = await dbConnect();
    
    // Create follow_ups table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS follow_ups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        lead_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        next_action VARCHAR(255),
        next_follow_up_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
      )
    `);

    // Get follow-ups with lead information
    const [rows] = await db.execute(`
      SELECT f.*, l.company_name, l.contact_name 
      FROM follow_ups f 
      JOIN leads l ON f.lead_id = l.id 
      ORDER BY f.follow_up_date DESC, f.created_at DESC
    `);
    
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: rows 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch follow-ups' 
    }, { status: 500 });
  }
}

// POST - Create new follow-up
export async function POST(request) {
  try {
    const data = await request.json();
    const {
      lead_id,
      follow_up_date,
      follow_up_type,
      description,
      status,
      next_action,
      next_follow_up_date,
      notes
    } = data;

    if (!lead_id || !follow_up_date || !follow_up_type || !description || !next_follow_up_date) {
      return Response.json({ 
        success: false, 
        error: 'Lead ID, follow-up date, type, description, and next follow-up date are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
    // Insert the new follow-up
    const [result] = await db.execute(
      `INSERT INTO follow_ups (
        lead_id, follow_up_date, follow_up_type, description, 
        status, next_action, next_follow_up_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id, follow_up_date, follow_up_type, description,
        status || 'Scheduled', next_action || '', next_follow_up_date || null, notes || ''
      ]
    );
    
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: { id: result.insertId },
      message: 'Follow-up created successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to create follow-up' 
    }, { status: 500 });
  }
}
