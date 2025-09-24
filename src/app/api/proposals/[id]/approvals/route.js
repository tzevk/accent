import { dbConnect } from '@/utils/database';

// GET approval history for a proposal
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const proposalId = parseInt(id);

    const db = await dbConnect();

    // Ensure approvals table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS approvals (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id INT NOT NULL,
        stage VARCHAR(50) NOT NULL,
        changed_by VARCHAR(100),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_id (proposal_id),
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      )
    `);

    // Ensure proposal has approval_stage column
    try {
      await db.execute(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS approval_stage VARCHAR(50) NULL`);
    } catch {
      // some MySQL versions don't support IF NOT EXISTS for ADD COLUMN; ignore
    }

    const [rows] = await db.execute('SELECT * FROM approvals WHERE proposal_id = ? ORDER BY created_at DESC', [proposalId]);
    await db.end();

    return Response.json({ success: true, data: rows });
  } catch (error) {
    console.error('Approvals GET error:', error);
    return Response.json({ success: false, error: 'Failed to fetch approvals' }, { status: 500 });
  }
}

// POST add approval entry and update proposal stage
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proposalId = parseInt(id);
    const data = await request.json();
    const { stage, changed_by, comment } = data;

    if (!stage) {
      return Response.json({ success: false, error: 'Stage is required' }, { status: 400 });
    }

    const db = await dbConnect();

    // Ensure approvals table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS approvals (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id INT NOT NULL,
        stage VARCHAR(50) NOT NULL,
        changed_by VARCHAR(100),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_id (proposal_id),
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      )
    `);

    // Insert approval record
    const [result] = await db.execute(
      'INSERT INTO approvals (proposal_id, stage, changed_by, comment) VALUES (?, ?, ?, ?)',
      [proposalId, stage, changed_by || null, comment || null]
    );

    // Update proposal approval_stage
    try {
      await db.execute('UPDATE proposals SET approval_stage = ? WHERE id = ?', [stage, proposalId]);
    } catch {
      // ignore
    }

    await db.end();

    return Response.json({ success: true, data: { id: result.insertId }, message: 'Approval recorded' });
  } catch (error) {
    console.error('Approvals POST error:', error);
    return Response.json({ success: false, error: 'Failed to record approval' }, { status: 500 });
  }
}
