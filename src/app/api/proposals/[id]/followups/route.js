import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET follow-ups for a specific proposal
export async function GET(request, { params }) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { id } = await params;
    
    if (!id) {
      return Response.json({ success: false, error: 'Proposal ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Ensure table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS proposal_followups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50) DEFAULT 'Call',
        description TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        outcome TEXT,
        next_action VARCHAR(255),
        next_follow_up_date DATE,
        contacted_person VARCHAR(255),
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Get follow-ups for this proposal
    const [rows] = await db.execute(
      `SELECT * FROM proposal_followups 
       WHERE proposal_id = ? 
       ORDER BY follow_up_date DESC, created_at DESC`,
      [id]
    );

    return Response.json({ success: true, data: rows });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to fetch follow-ups' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// POST - Create new follow-up for a proposal
export async function POST(request, { params }) {
  // RBAC check
  const authResultPost = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.UPDATE);
  if (authResultPost.authorized === false) return authResultPost.response;

  let db;
  try {
    const { id } = await params;
    const data = await request.json();
    
    if (!id) {
      return Response.json({ success: false, error: 'Proposal ID is required' }, { status: 400 });
    }

    const {
      follow_up_date,
      follow_up_type,
      description,
      status,
      outcome,
      next_action,
      next_follow_up_date,
      contacted_person,
      notes,
      created_by
    } = data;

    if (!follow_up_date || !description) {
      return Response.json({ success: false, error: 'Follow-up date and description are required' }, { status: 400 });
    }

    db = await dbConnect();

    // Ensure table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS proposal_followups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50) DEFAULT 'Call',
        description TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        outcome TEXT,
        next_action VARCHAR(255),
        next_follow_up_date DATE,
        contacted_person VARCHAR(255),
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert new follow-up
    const [result] = await db.execute(
      `INSERT INTO proposal_followups 
       (proposal_id, follow_up_date, follow_up_type, description, status, outcome, next_action, next_follow_up_date, contacted_person, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        follow_up_date,
        follow_up_type || 'Call',
        description,
        status || 'Scheduled',
        outcome || null,
        next_action || null,
        next_follow_up_date || null,
        contacted_person || null,
        notes || null,
        created_by || null
      ]
    );

    // Fetch and return the created follow-up
    const [rows] = await db.execute(
      'SELECT * FROM proposal_followups WHERE id = ?',
      [result.insertId]
    );

    return Response.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to create follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// PUT - Update a follow-up
export async function PUT(request, { params }) {
  // RBAC check
  const authResultPut = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.UPDATE);
  if (authResultPut.authorized === false) return authResultPut.response;

  let db;
  try {
    const { id } = await params;
    const data = await request.json();
    
    const { followup_id } = data;
    
    if (!followup_id) {
      return Response.json({ success: false, error: 'Follow-up ID is required' }, { status: 400 });
    }

    const {
      follow_up_date,
      follow_up_type,
      description,
      status,
      outcome,
      next_action,
      next_follow_up_date,
      contacted_person,
      notes
    } = data;

    if (!follow_up_date || !description) {
      return Response.json({ success: false, error: 'Follow-up date and description are required' }, { status: 400 });
    }

    db = await dbConnect();

    // Update the follow-up
    await db.execute(
      `UPDATE proposal_followups SET 
        follow_up_date = ?,
        follow_up_type = ?,
        description = ?,
        status = ?,
        outcome = ?,
        next_action = ?,
        next_follow_up_date = ?,
        contacted_person = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND proposal_id = ?`,
      [
        follow_up_date,
        follow_up_type || 'Call',
        description,
        status || 'Scheduled',
        outcome || null,
        next_action || null,
        next_follow_up_date || null,
        contacted_person || null,
        notes || null,
        followup_id,
        id
      ]
    );

    // Fetch and return the updated follow-up
    const [rows] = await db.execute(
      'SELECT * FROM proposal_followups WHERE id = ?',
      [followup_id]
    );

    return Response.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to update follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// DELETE - Delete a follow-up
export async function DELETE(request, { params }) {
  // RBAC check
  const authResultDel = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.DELETE);
  if (authResultDel.authorized === false) return authResultDel.response;

  let db;
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const followupId = url.searchParams.get('followup_id');
    
    if (!followupId) {
      return Response.json({ success: false, error: 'Follow-up ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Delete the follow-up
    const [result] = await db.execute(
      'DELETE FROM proposal_followups WHERE id = ? AND proposal_id = ?',
      [followupId, id]
    );

    if (result.affectedRows === 0) {
      return Response.json({ success: false, error: 'Follow-up not found' }, { status: 404 });
    }

    return Response.json({ success: true, message: 'Follow-up deleted successfully' });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to delete follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}
