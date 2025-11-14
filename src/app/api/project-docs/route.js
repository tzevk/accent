import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

// project-docs API: manages concrete documents attached to individual projects
// Table schema (created lazily): project_documents
// Fields: id (uuid), project_id (int fk projects.id), name, doc_master_id (nullable, references documents_master.id), file_url, thumb_url, description, status, metadata (JSON), created_at, updated_at

async function ensureTable(db) {
  // Create table without foreign key constraints initially to avoid FK creation errors if referenced tables
  // are not yet present or have incompatible engines. We'll try to add constraints afterwards if possible.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_documents (
      id VARCHAR(36) PRIMARY KEY,
      project_id INT NOT NULL,
      doc_master_id VARCHAR(36) NULL,
      name VARCHAR(255) NOT NULL,
      file_url VARCHAR(500),
      thumb_url VARCHAR(500),
      description TEXT,
      status VARCHAR(50) DEFAULT 'active',
      metadata JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // Attempt to add foreign key constraints only if referenced tables/columns exist.
  try {
    const [[projectsTable]] = await db.execute(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
    );
    if (projectsTable && projectsTable.cnt > 0) {
      try {
        await db.execute(`ALTER TABLE project_documents ADD CONSTRAINT fk_project_documents_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`);
      } catch (e) {
        // Ignore duplicate-add or incompatible FK errors; log for diagnostics
        // MySQL error codes: 1022/1005 for duplicate keys/creation errors, 1215/150 for FK problems
        console.warn('Could not add fk_project_documents_project:', e?.message || e);
      }
    }

    const [[dmTable]] = await db.execute(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents_master'`
    );
    if (dmTable && dmTable.cnt > 0) {
      try {
        await db.execute(`ALTER TABLE project_documents ADD CONSTRAINT fk_project_documents_master FOREIGN KEY (doc_master_id) REFERENCES documents_master(id) ON DELETE SET NULL`);
      } catch (e) {
        console.warn('Could not add fk_project_documents_master:', e?.message || e);
      }
    }
  } catch (outerErr) {
    console.warn('Could not verify referenced tables for project_documents FKs:', outerErr?.message || outerErr);
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
