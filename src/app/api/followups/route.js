import { dbConnect } from '@/utils/database';

// GET follow-ups (optionally filtered by lead_id)
export async function GET(request) {
  let db;
  try {
    const url = new URL(request.url);
  const leadId = url.searchParams.get('lead_id');
  const companyId = url.searchParams.get('company_id');

    db = await dbConnect();

    // Ensure table exists (safe no-op if already present)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS follow_ups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        lead_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50),
        description TEXT,
        status VARCHAR(50) DEFAULT 'Scheduled',
        next_action VARCHAR(255),
        next_follow_up_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
      )
    `);

      // Legacy compatibility: ensure optional columns exist (some deployments may have an older schema)
      try {
        const [[dbRow]] = await db.query('SELECT DATABASE() as dbName');
        const dbName = dbRow?.dbName;
        if (dbName) {
          const [cols] = await db.execute(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'follow_ups' AND COLUMN_NAME = 'next_follow_up_date'`,
            [dbName]
          );

          if (!cols || cols.length === 0) {
            // Add the missing column
            await db.execute(`ALTER TABLE follow_ups ADD COLUMN next_follow_up_date DATE NULL`);
          }
        }
      } catch (err) {
        // If anything goes wrong here, don't block main flow — log and continue
        console.warn('Could not ensure follow_ups schema compatibility:', err.message || err);
      }

    const params = [];
    let where = '';
    if (leadId) {
      where = 'WHERE f.lead_id = ?';
      params.push(leadId);
    } else if (companyId) {
      // leads table stores company_name (string), so resolve company_id -> company_name first
      const [[dbRow]] = await db.query('SELECT company_name FROM companies WHERE id = ? LIMIT 1', [companyId]);
      const companyName = dbRow ? dbRow.company_name : null;
      if (!companyName) {
        // No such company, return empty list
        return Response.json({ success: true, data: [] });
      }
      where = 'WHERE l.company_name = ?';
      params.push(companyName);
    }

    const [rows] = await db.execute(
      `SELECT f.*, l.company_name, l.contact_name
       FROM follow_ups f
       JOIN leads l ON f.lead_id = l.id
       ${where}
       ORDER BY f.follow_up_date DESC, f.created_at DESC`,
      params
    );

    return Response.json({ success: true, data: rows });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to fetch follow-ups' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// POST - Create new follow-up
export async function POST(request) {
  let db;
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

    if (!lead_id || !follow_up_date || !description) {
      return Response.json({ success: false, error: 'lead_id, follow_up_date and description are required' }, { status: 400 });
    }

    db = await dbConnect();

    // Validate lead exists
    const [leadRows] = await db.execute('SELECT id FROM leads WHERE id = ?', [lead_id]);
    if (!leadRows || leadRows.length === 0) {
      return Response.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    // Insert follow-up
    const [result] = await db.execute(
      `INSERT INTO follow_ups (
        lead_id, follow_up_date, follow_up_type, description,
        status, next_action, next_follow_up_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        follow_up_date,
        follow_up_type || 'Call',
        description,
        status || 'Scheduled',
        next_action || null,
        next_follow_up_date || null,
        notes || null
      ]
    );

    // Return the created follow-up joined with lead info in one query to avoid extra round-trips
    const [rows] = await db.execute(
      `SELECT f.*, l.company_name, l.contact_name
       FROM follow_ups f
       JOIN leads l ON f.lead_id = l.id
       WHERE f.id = ?`,
      [result.insertId]
    );

    const created = rows && rows[0] ? rows[0] : { id: result.insertId };

    return Response.json({ success: true, data: created, message: 'Follow-up created successfully' });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to create follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}
