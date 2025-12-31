import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * POST /api/messages/upload
 * Upload file attachments for messages
 */
export async function POST(request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const type = formData.get('type') || 'message-attachment';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    // Allowed file extensions
    const allowedExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.csv',
      '.ppt', '.pptx', '.txt', '.dwg', '.dxf', '.dgn', '.rvt',
      '.ifc', '.plt', '.jpg', '.jpeg', '.png', '.webp', '.heic',
      '.tif', '.tiff', '.zip', '.rar', '.7z', '.dat', '.xml',
      '.json', '.mpp', '.xer', '.mp3', '.wav', '.mp4', '.mov', '.webm'
    ];

    // Get file extension
    const originalName = file.name;
    const ext = '.' + originalName.split('.').pop().toLowerCase();
    
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json({ 
        success: false, 
        error: `File type not allowed. Allowed extensions: ${allowedExtensions.join(', ')}` 
      }, { status: 400 });
    }

    // Max file size: 25MB
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ 
        success: false, 
        error: 'File size exceeds 25MB limit' 
      }, { status: 400 });
    }

    // Create uploads directory for message attachments
    const uploadsDir = path.join(process.cwd(), 'private', 'message-attachments');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${timestamp}_${randomStr}_${safeName}`;
    const filePath = path.join(uploadsDir, fileName);

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({
      success: true,
      data: {
        fileName,
        originalName,
        filePath: `/api/messages/attachments/${fileName}`,
        fileType: file.type,
        fileSize: file.size
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to upload file',
      details: error.message 
    }, { status: 500 });
  }
}
