import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// SEC-02: cap sharp decode to ~40 megapixels. Covers large camera photos
// (e.g. 48MP HEIC) while rejecting SVG raster bombs / decompression bombs
// whose decode would exhaust memory.
const MAX_DECODED_PIXELS = 40_000_000;

export async function POST(request) {
	// RBAC check - require at least projects:update for uploading files
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const data = await request.json();
		const { filename, b64 } = data;
		if (!filename || !b64) {
			return Response.json(
				{ success: false, error: 'filename and b64 data required' },
				{ status: 400 }
			);
		}

		// sanitize filename (allow only alphanum, dot, underscore, hyphen)
		const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
		const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
		if (!fs.existsSync(uploadsDir))
			fs.mkdirSync(uploadsDir, { recursive: true });

		const timestamp = Date.now();

		// decode base64 (strip data: prefix if present)
		const cleaned = b64.replace(/^data:.*;base64,/, '');
		const buf = Buffer.from(cleaned, 'base64');

		// SEC-02: never persist raw upload bytes. Every upload is rasterized to
		// a fresh PNG via sharp — SVG input is rendered by librsvg, which does
		// not execute scripts or fetch external resources, so no scriptable
		// content (SVG, HTML, JS, polyglots) is ever written under public/uploads/.
		// Anything that is not a decodable raster image is rejected (400).
		// limitInputPixels caps decode memory and rejects SVG raster bombs.
		let pngBuffer;
		try {
			pngBuffer = await sharp(buf, { limitInputPixels: MAX_DECODED_PIXELS })
				.rotate() // auto-orient from EXIF
				.resize({
					width: 1200,
					height: 1200,
					fit: 'inside',
					withoutEnlargement: true,
				})
				.png({ compressionLevel: 9, adaptiveFiltering: true })
				.toBuffer();
		} catch {
			return Response.json(
				{
					success: false,
					error:
						'Uploaded data is not a supported image (unrecognized format, corrupt data, or image too large)',
				},
				{ status: 400 }
			);
		}

		const base = safeName.replace(/\.[^.]+$/, '');
		const finalName = `${timestamp}_${base}.png`;
		const outPath = path.join(uploadsDir, finalName);
		fs.writeFileSync(outPath, pngBuffer);

		// Create a thumbnail
		try {
			const thumbPng = await sharp(pngBuffer)
				.resize({
					width: 256,
					height: 256,
					fit: 'inside',
					withoutEnlargement: true,
				})
				.png({ compressionLevel: 9 })
				.toBuffer();
			const thumbName = `${timestamp}_${base}-thumb.png`;
			const thumbPath = path.join(uploadsDir, thumbName);
			fs.writeFileSync(thumbPath, thumbPng);
		} catch {}

		const baseForUrl = finalName.replace(/\.[^.]+$/, '');
		const fileUrl = `/uploads/${finalName}`;
		const thumbUrl = `/uploads/${baseForUrl}-thumb.png`;
		return Response.json({
			success: true,
			data: { fileUrl, filename: finalName, thumbUrl },
		});
	} catch (error) {
		console.error('Upload error:', error);
		return Response.json(
			{ success: false, error: 'Failed to upload' },
			{ status: 500 }
		);
	}
}
