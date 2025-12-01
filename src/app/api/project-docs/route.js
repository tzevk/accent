import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

// project-docs API: manages concrete documents attached to individual projects
// Table schema (created lazily): project_documents
// Fields: id (uuid), project_id (int fk projects.id), name, doc_master_id (nullable, references documents_master.id), file_url, thumb_url, description, status, metadata (JSON), created_at, updated_at

async function ensureTable(db) {
  // project_documents table should already exist with proper foreign keys
  // created by the fix-project-documents-fk.js script. This function just
  // ensures it exists with a basic structure if it somehow doesn't.
  
  const [tableCheck] = await db.execute(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_documents'`
  );
  
  if (tableCheck[0].cnt === 0) {
    console.warn('project_documents table does not exist. Creating basic structure...');
    // Note: doc_master_id is int(11) to match documents_master.id, not VARCHAR(36)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS project_documents (
        id VARCHAR(36) PRIMARY KEY,
        project_id INT(11) NOT NULL,
        doc_master_id INT(11) NULL,
        name VARCHAR(255) NOT NULL,
        file_url VARCHAR(500),
        thumb_url VARCHAR(500),
        description TEXT,
        status VARCHAR(50) DEFAULT 'active',
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        INDEX idx_doc_master_id (doc_master_id)
      ) ENGINE=InnoDB
    `);
    console.log('Created project_documents table without foreign keys (add them manually if needed)');
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const db = await dbConnect();
    await ensureTable(db);

    let rows;
    if (projectId) {
      const [r] = await db.execute(
        `SELECT pd.*, dm.name as master_name, dm.doc_key FROM project_documents pd
         LEFT JOIN documents_master dm ON pd.doc_master_id = dm.id
         WHERE pd.project_id = ? ORDER BY pd.created_at DESC`,
        [projectId]
      );
      rows = r;
    } else {
      const [r] = await db.execute(
        `SELECT pd.*, dm.name as master_name, dm.doc_key FROM project_documents pd
         LEFT JOIN documents_master dm ON pd.doc_master_id = dm.id
         ORDER BY pd.created_at DESC`
      );
      rows = r;
    }
    await db.end();
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('project-docs GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load project documents', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { project_id, name, file_url = null, thumb_url = null, description = '', status = 'active', doc_master_id = null, metadata = null } = body;
    if (!project_id || !name) {
      return NextResponse.json({ success: false, error: 'project_id and name are required' }, { status: 400 });
    }
    const db = await dbConnect();
    await ensureTable(db);

    // Ensure project exists
    const [proj] = await db.execute('SELECT id FROM projects WHERE id = ?', [project_id]);
    if (proj.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO project_documents (id, project_id, doc_master_id, name, file_url, thumb_url, description, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, project_id, doc_master_id || null, name, file_url, thumb_url, description, status, metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null]
    );
    await db.end();
    return NextResponse.json({ success: true, data: { id }, message: 'Document linked to project' }, { status: 201 });
  } catch (error) {
    console.error('project-docs POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to add project document', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, name, description, status, metadata } = body;
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }
    const db = await dbConnect();
    await ensureTable(db);
    await db.execute(
      `UPDATE project_documents SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         status = COALESCE(?, status),
         metadata = COALESCE(?, metadata)
       WHERE id = ?`,
      [name ?? null, description ?? null, status ?? null, metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null, id]
    );
    await db.end();
    return NextResponse.json({ success: true, message: 'Project document updated' });
  } catch (error) {
    console.error('project-docs PUT error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update project document', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }
    const db = await dbConnect();
    await ensureTable(db);
    await db.execute('DELETE FROM project_documents WHERE id = ?', [id]);
    await db.end();
    return NextResponse.json({ success: true, message: 'Project document removed' });
  } catch (error) {
    console.error('project-docs DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete project document', details: error.message }, { status: 500 });
  }
}
