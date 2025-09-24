import { dbConnect } from '@/utils/database';

// GET versions for a proposal
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const proposalId = parseInt(id);

    const db = await dbConnect();
    await db.execute(`
      CREATE TABLE IF NOT EXISTS proposal_versions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id INT NOT NULL,
        version_label VARCHAR(50),
        file_url VARCHAR(1024),
        original_name VARCHAR(255),
        uploaded_by VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_id (proposal_id),
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      )
    `);

    const [rows] = await db.execute('SELECT * FROM proposal_versions WHERE proposal_id = ? ORDER BY created_at DESC', [proposalId]);
    await db.end();

    return Response.json({ success: true, data: rows });
  } catch (error) {
    console.error('Versions GET error:', error);
    return Response.json({ success: false, error: 'Failed to fetch versions' }, { status: 500 });
  }
}

// POST add a version record (expects JSON with file_url and optional version_label)
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proposalId = parseInt(id);
    const data = await request.json();
    const { version_label, file_url, original_name, uploaded_by, notes } = data;

    if (!file_url) {
      return Response.json({ success: false, error: 'file_url is required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute(`
      CREATE TABLE IF NOT EXISTS proposal_versions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id INT NOT NULL,
        version_label VARCHAR(50),
        file_url VARCHAR(1024),
        original_name VARCHAR(255),
        uploaded_by VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_id (proposal_id),
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      )
    `);

    const [result] = await db.execute(
      'INSERT INTO proposal_versions (proposal_id, version_label, file_url, original_name, uploaded_by, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [proposalId, version_label || null, file_url, original_name || null, uploaded_by || null, notes || null]
    );

    await db.end();
    return Response.json({ success: true, data: { id: result.insertId }, message: 'Version added' });
  } catch (error) {
    console.error('Versions POST error:', error);
    return Response.json({ success: false, error: 'Failed to add version' }, { status: 500 });
  }
}
