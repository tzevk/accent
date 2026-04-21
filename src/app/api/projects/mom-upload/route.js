import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';
import { v4 as uuidv4 } from 'uuid';

// Allowed file types for MOM (Minutes of Meeting) documents
const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/plain': '.txt',
};

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'txt'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function ensureMomTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_mom_documents (
      id VARCHAR(36) PRIMARY KEY,
      original_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(120) NOT NULL,
      file_size BIGINT NOT NULL,
      file_data LONGBLOB NOT NULL,
      uploaded_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_uploaded_by (uploaded_by),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

/**
 * POST /api/projects/mom-upload
 * Upload a MOM (Minutes of Meeting) document attachment
 */
export async function POST(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    // Check file type by extension
    const fileName = file.name || '';
    const fileExt = fileName.toLowerCase().split('.').pop();

    if (!ALLOWED_TYPES[file.type] && !ALLOWED_EXTENSIONS.includes(fileExt)) {
      return NextResponse.json({
        success: false,
        error: `File type not allowed. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, PNG, TXT`
      }, { status: 400 });
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        success: false,
        error: 'File size exceeds 10MB limit'
      }, { status: 400 });
    }

    db = await dbConnect();
    await ensureMomTable(db);

    const docId = uuidv4();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await db.execute(
      `INSERT INTO project_mom_documents (id, original_name, file_type, file_size, file_data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [docId, file.name, file.type || 'application/octet-stream', file.size, buffer, currentUser.id || null]
    );

    const extension = ALLOWED_TYPES[file.type] || `.${fileExt}`;
    const filenaame = `mom_${docId}${extension}`;

    return NextResponse.json({
      success: true,
      data: {
        id: docId,
        file_name: fileName,
        original_name: file.name,
        file_url: `/api/projects/mom-upload?id=${docId}`,
        file_type: file.type,
        file_size: file.size
      }
    });
  } catch (error) {
    console.error('[MOM Upload] Error:', error);
    return NextResponse.json({ success: false, error: 'Upload failed' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

/**
 * GET /api/projects/mom-upload?id=<docId>
 * Fetch MOM document content by id
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Document id is required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureMomTable(db);

    const [rows] = await db.execute(
      `SELECT id, original_name, file_type, file_data FROM project_mom_documents WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const doc = rows[0];
    const contentType = doc.file_type || 'application/octet-stream';
    const fileBuffer = doc.file_data;
    const safeName = String(doc.original_name || 'mom-document').replace(/[\r\n"]/g, '');

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=3600'
      }
    });
  } catch (error) {
    console.error('[MOM Download] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch document' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
