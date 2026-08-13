import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

// Hoisted so the mock factory below can reference it (vitest requires
// `mock*`-prefixed names inside vi.mock factories).
const mocks = vi.hoisted(() => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.ensurePermission,
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: { UPDATE: 'update' },
}));

// sharp chain: sharp(buf, opts).rotate().resize().png().toBuffer()
const mockToBuffer = vi.fn();
const mockPng = vi.fn(() => ({ toBuffer: mockToBuffer }));
const mockResize = vi.fn(() => ({ png: mockPng }));
const mockRotate = vi.fn(() => ({ resize: mockResize }));
const mockSharp = vi.fn(() => ({ rotate: mockRotate, resize: mockResize }));
vi.mock('sharp', () => ({ default: mockSharp }));

// Capture writes without touching the real public/uploads directory
const mockWriteFileSync = vi.fn();
vi.spyOn(fs, 'writeFileSync').mockImplementation(mockWriteFileSync);
vi.spyOn(fs, 'existsSync').mockReturnValue(true);
vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

// Route handler must load after vi.mock registration (repo test convention —
// module-loading boundary, not a runtime-selected specifier).
const { POST } = await import('@/app/api/uploads/route');

const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="fetch('/api/users/reset-password',{method:'POST'})"><script>alert(1)</script></svg>`;
const RASTERIZED = Buffer.from('rasterized-png-bytes');

function createRequest(body: unknown) {
	return {
		url: 'http://localhost/api/uploads',
		method: 'POST',
		headers: new Headers({ 'Content-Type': 'application/json' }),
		json: () => Promise.resolve(body),
	};
}

describe('POST /api/uploads — SEC-02: uploads are rasterized, never persisted verbatim', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockToBuffer.mockResolvedValue(RASTERIZED);
	});

	it('rejects callers without projects:update', async () => {
		mocks.ensurePermission.mockResolvedValueOnce({
			authorized: false,
			response: new Response('denied', { status: 403 }),
		});
		const res = await POST(
			createRequest({
				filename: 'evil.svg',
				b64: Buffer.from(EVIL_SVG).toString('base64'),
			})
		);
		expect(res.status).toBe(403);
		expect(fs.writeFileSync).not.toHaveBeenCalled();
	});

	it('rasterizes a script-bearing SVG to PNG — never writes the raw SVG', async () => {
		const res = await POST(
			createRequest({
				filename: 'evil.svg',
				b64: Buffer.from(EVIL_SVG).toString('base64'),
			})
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);

		// Output is always .png; no .svg file is ever written
		expect(body.data.fileUrl).toMatch(/\.png$/);
		expect(body.data.filename).toMatch(/\.png$/);
		expect(body.data.thumbUrl).toMatch(/-thumb\.png$/);

		const writtenPaths = mockWriteFileSync.mock.calls.map((call) =>
			String(call[0])
		);
		expect(writtenPaths.length).toBeGreaterThan(0);
		expect(writtenPaths.every((p) => p.endsWith('.png'))).toBe(true);
		expect(writtenPaths.some((p) => p.endsWith('.svg'))).toBe(false);

		// The raw attacker payload never reaches disk — only the rasterized PNG
		for (const call of mockWriteFileSync.mock.calls) {
			expect(call[1]).toEqual(RASTERIZED);
			expect(String(call[1])).not.toContain('<script');
		}

		// sharp decodes the raw bytes with the pixel cap (rejects raster bombs)
		expect(mockSharp).toHaveBeenCalledWith(expect.any(Buffer), {
			limitInputPixels: 40_000_000,
		});
		const inputBuf = mockSharp.mock.calls[0][0] as Buffer;
		expect(inputBuf.toString('base64')).toBe(
			Buffer.from(EVIL_SVG).toString('base64')
		);
	});

	it('rejects non-raster payloads with 400 and writes nothing', async () => {
		mockToBuffer.mockRejectedValueOnce(new Error('unsupported image format'));
		const res = await POST(
			createRequest({
				filename: 'page.html',
				b64: Buffer.from('<html><body>hi</body></html>').toString('base64'),
			})
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(fs.writeFileSync).not.toHaveBeenCalled();
	});

	it('writes main PNG and thumbnail for a raster upload', async () => {
		const res = await POST(
			createRequest({
				filename: 'photo.jpg',
				b64: Buffer.from('jpegbytes').toString('base64'),
			})
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.fileUrl).toMatch(/^\/uploads\/\d+_photo\.png$/);
		expect(body.data.thumbUrl).toMatch(/^\/uploads\/\d+_photo-thumb\.png$/);
		expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
	});
});
