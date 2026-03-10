import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '@/utils/database';

// Allowed file types for document uploads
const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'pptx', 'ppt', 'jpg', 'jpeg', 'png'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Ensure the entity_documents table exists
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS entity_documents (
      id VARCHAR(36) PRIMARY KEY,
      entity_type ENUM('project','purchase_order','invoice') NOT NULL,
      entity_id INT NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      file_type VARCHAR(100),
      file_size INT DEFAULT 0,
      uploaded_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * POST /api/document-upload
 * Upload a document for a project, purchase order, or invoice.
 * Expects multipart/form-data with fields: file, entity_type, entity_id
 */
export async function POST(request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const entityType = formData.get('entity_type'); // project | purchase_order | invoice
    const entityId = formData.get('entity_id');

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }
    if (!entityType || !entityId) {
      return NextResponse.json({ success: false, error: 'entity_type and entity_id are required' }, { status: 400 });
    }
    if (!['project', 'purchase_order', 'invoice'].includes(entityType)) {
      return NextResponse.json({ success: false, error: 'Invalid entity_type' }, { status: 400 });
    }

    // Check file type
    const fileName = file.name || '';
    const fileExt = fileName.toLowerCase().split('.').pop();
    if (!ALLOWED_TYPES[file.type] && !ALLOWED_EXTENSIONS.includes(fileExt)) {
      return NextResponse.json({
        success: false,
        error: `File type not allowed. Allowed: PDF, DOC, DOCX, PPTX, JPG, PNG`
      }, { status: 400 });
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        success: false,
        error: 'File size exceeds 20MB limit'
      }, { status: 400 });
    }

    // Generate unique filename
    const extension = ALLOWED_TYPES[file.type] || `.${fileExt}`;
    const uniqueFilename = `${entityType}_${entityId}_${uuidv4()}${extension}`;

    // Create upload directory
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'documents');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // Save file to disk
    const filePath = path.join(uploadDir, uniqueFilename);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Ensure DB table exists and insert record
    await ensureTable();
    const docId = uuidv4();
    await query(
      `INSERT INTO entity_documents (id, entity_type, entity_id, original_name, file_name, file_url, file_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [docId, entityType, entityId, file.name, uniqueFilename, `/uploads/documents/${uniqueFilename}`, file.type, file.size, currentUser.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: docId,
        original_name: file.name,
        file_name: uniqueFilename,
        file_url: `/uploads/documents/${uniqueFilename}`,
        file_type: file.type,
        file_size: file.size
      }
    });
  } catch (error) {
    console.error('[Document Upload] Error:', error);
    return NextResponse.json({ success: false, error: 'Upload failed' }, { status: 500 });
  }
}

/**
 * GET /api/document-upload?entity_type=project&entity_id=123
 * List all documents for a given entity
 */
export async function GET(request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entity_type');
    const entityId = searchParams.get('entity_id');

    if (!entityType || !entityId) {
      return NextResponse.json({ success: false, error: 'entity_type and entity_id are required' }, { status: 400 });
    }

    await ensureTable();
    const [rows] = await query(
      `SELECT * FROM entity_documents WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`,
      [entityType, entityId]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('[Document Upload] GET Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch documents' }, { status: 500 });
  }
}

/**
 * DELETE /api/document-upload?id=<doc_uuid>
 * Delete a document
 */
export async function DELETE(request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('id');

    if (!docId) {
      return NextResponse.json({ success: false, error: 'Document id is required' }, { status: 400 });
    }

    await ensureTable();

    // Get file info before deleting
    const [docs] = await query(`SELECT * FROM entity_documents WHERE id = ?`, [docId]);
    if (!docs.length) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    // Delete from DB
    await query(`DELETE FROM entity_documents WHERE id = ?`, [docId]);

    // Try to delete the file from disk
    try {
      const { unlink } = await import('fs/promises');
      const filePath = path.join(process.cwd(), 'public', docs[0].file_url);
      await unlink(filePath);
    } catch {
      // File may already be deleted — ignore
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Document Upload] DELETE Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete document' }, { status: 500 });
  }
}
