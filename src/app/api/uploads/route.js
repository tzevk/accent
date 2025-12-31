import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function POST(request) {
  // RBAC check - require at least projects:update for uploading files
  const authResult = await ensurePermission(request, RESOURCES.PROJECTS, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  try {
    const data = await request.json();
  const { filename, b64 } = data;
    if (!filename || !b64) {
      return Response.json({ success: false, error: 'filename and b64 data required' }, { status: 400 });
    }

  // sanitize filename (allow only alphanum, dot, underscore, hyphen)
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const timestamp = Date.now();

    // decode base64 (strip data: prefix if present)
    const cleaned = b64.replace(/^data:.*;base64,/, '');
    const buf = Buffer.from(cleaned, 'base64');
    // Recognize SVG by content
    const headUtf8 = buf.slice(0, 256).toString('utf8').trim().toLowerCase();
    const isSvg = headUtf8.includes('<svg');

    let finalName;
    let outPath;

    if (isSvg) {
      // Keep SVG as-is
      const base = safeName.replace(/\.[^.]+$/, '');
      finalName = `${timestamp}_${base}.svg`;
      outPath = path.join(uploadsDir, finalName);
      fs.writeFileSync(outPath, buf);
      // Also attempt to generate a PNG thumbnail from the SVG for previews
      try {
        const thumbPng = await sharp(buf)
          .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toBuffer();
        const thumbName = `${timestamp}_${base}-thumb.png`;
        const thumbPath = path.join(uploadsDir, thumbName);
        fs.writeFileSync(thumbPath, thumbPng);
      } catch {}
    } else {
      // For raster formats, convert to PNG to ensure broad browser support (handles PNG/JPEG/GIF/BMP/HEIC/WebP)
      let pngBuffer;
      try {
        // auto-orient, fit within 1200x1200, preserve aspect
        pngBuffer = await sharp(buf)
          .rotate()
          .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer();
      } catch {
        return Response.json({ success: false, error: 'Uploaded data is not a recognized or supported image' }, { status: 400 });
      }
      const base = safeName.replace(/\.[^.]+$/, '');
      finalName = `${timestamp}_${base}.png`;
      outPath = path.join(uploadsDir, finalName);
      fs.writeFileSync(outPath, pngBuffer);

      // Create a thumbnail
      try {
        const thumbPng = await sharp(pngBuffer)
          .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toBuffer();
        const thumbName = `${timestamp}_${base}-thumb.png`;
        const thumbPath = path.join(uploadsDir, thumbName);
        fs.writeFileSync(thumbPath, thumbPng);
      } catch {}
    }

    const baseForUrl = finalName.replace(/\.[^.]+$/, '');
    const fileUrl = `/uploads/${finalName}`;
    const thumbUrl = `/uploads/${baseForUrl}-thumb.png`;
    return Response.json({ success: true, data: { fileUrl, filename: finalName, thumbUrl } });
  } catch (error) {
    console.error('Upload error:', error);
    return Response.json({ success: false, error: 'Failed to upload' }, { status: 500 });
  }
}
