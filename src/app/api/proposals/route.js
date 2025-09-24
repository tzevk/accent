import { dbConnect } from '@/utils/database';

// GET all proposals
export async function GET() {
  try {
    const db = await dbConnect();
    
    const [rows] = await db.execute(`
      SELECT * FROM proposals 
      ORDER BY created_at DESC
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
      error: 'Failed to fetch proposals' 
    }, { status: 500 });
  }
}

// POST new proposal
export async function POST(request) {
  try {
    const data = await request.json();
    
    const {
      title,
      client,
      contact_name,
      contact_email,
      phone,
      project_description,
      city,
      priority,
      value,
      status,
      due_date,
      notes
    } = data;
    const lead_id = data.lead_id || null;

    if (!title || !client) {
      return Response.json({ 
        success: false, 
        error: 'Title and client are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
    // Generate proposal ID
    const [countResult] = await db.execute('SELECT COUNT(*) as count FROM proposals');
    const proposalNumber = (countResult[0].count + 1).toString().padStart(5, '0');
    const proposalId = `P${proposalNumber}`;

    const [result] = await db.execute(`
      INSERT INTO proposals (
        proposal_id, lead_id, title, client, contact_name, contact_email, phone, 
        project_description, city, priority, value, status, due_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      proposalId, lead_id, title, client, contact_name, contact_email, phone,
      project_description, city, priority, value, status, due_date, notes
    ]);
    
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: { 
        id: result.insertId,
        proposalId: proposalId
      },
      message: 'Proposal created successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to create proposal' 
    }, { status: 500 });
  }
}
