import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
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
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * POST /api/projects/mom-upload
 * Upload a MOM (Minutes of Meeting) document attachment
 */
export async function POST(request) {
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
        error: 'File size exceeds 15MB limit'
      }, { status: 400 });
    }

    // Generate unique filename
    const extension = ALLOWED_TYPES[file.type] || `.${fileExt}`;
    const uniqueFilename = `mom_${uuidv4()}${extension}`;

    // Create upload directory if needed
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'mom');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // Save file
    const filePath = path.join(uploadDir, uniqueFilename);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    return NextResponse.json({
      success: true,
      data: {
        file_name: uniqueFilename,
        original_name: file.name,
        file_url: `/uploads/mom/${uniqueFilename}`,
        file_type: file.type,
        file_size: file.size
      }
    });
  } catch (error) {
    console.error('[MOM Upload] Error:', error);
    return NextResponse.json({ success: false, error: 'Upload failed' }, { status: 500 });
  }
}
