import fs from 'fs';
import path from 'path';

export async function POST(request) {
  try {
    const data = await request.json();
  const { filename, b64 } = data;
    if (!filename || !b64) {
      return Response.json({ success: false, error: 'filename and b64 data required' }, { status: 400 });
    }

    // sanitize filename
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9.-_]/g, '_');
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const timestamp = Date.now();
    const outName = `${timestamp}_${safeName}`;
    const outPath = path.join(uploadsDir, outName);

    // decode base64 (strip data: prefix if present)
    const cleaned = b64.replace(/^data:.*;base64,/, '');
    const buf = Buffer.from(cleaned, 'base64');
    fs.writeFileSync(outPath, buf);

    const fileUrl = `/uploads/${outName}`;
    return Response.json({ success: true, data: { fileUrl, outName } });
  } catch (error) {
    console.error('Upload error:', error);
    return Response.json({ success: false, error: 'Failed to upload' }, { status: 500 });
  }
}
