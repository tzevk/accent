import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readArtifact, writeArtifact } from '../../lib/artifacts';
import { exec, rows } from '../../lib/db';
import { E2E_ENV } from '../../lib/env';
import { anonymousContext } from '../../lib/security-fixtures';

/**
 * Security headers + upload gates (plan workstreams B6 and C).
 *
 * 1. `GET /signin` and `GET /api/health` answer with the hardening header set
 *    (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy), and `/uploads/*`
 *    keeps `nosniff` + `Content-Disposition: attachment`.
 * 2. `POST /api/document-upload` and `POST /api/messages/attachments` reject
 *    HTML and SVG bytes declared as `image/png` (400, nothing persisted) while
 *    still accepting a real PNG (200, DB row + file on disk).
 * 3. `POST /api/uploads` answers 413 to a base64 body just over the 20 MB cap,
 *    before the payload is decoded — so the sharp rasterizer is never reached.
 *
 * Session: the default `request` fixture already carries the admin storage
 * state the setup project wrote (`e2e/.auth/admin.json`), so every write here
 * happens as the authenticated super-admin fixture. The spec deliberately does
 * not call `/api/login`: the `auth` rate-limit bucket allows 10 requests per
 * 15 minutes across the whole suite (ADR-0013), and `loginAs()` has no
 * in-process cache, so posting credentials here would spend a suite-wide budget.
 *
 * `/uploads/*` served-file assertion: `public/uploads/` is empty in this branch
 * (workstream G purged its tracked files) and `next start` snapshots the public
 * directory at boot — verified: a file written after boot 404s, the same file
 * is served after a restart. When no file is present at boot the spec therefore
 * takes the requirement's documented skip: it still produces a real PNG through
 * `POST /api/uploads`, asserts it landed on disk, and asserts the
 * `nosniff` + `attachment` contract on the response the server gives, and
 * records the skip in the artifact and as a test annotation. A file present at
 * boot takes the strict branch (200 + `image/png` + both headers).
 *
 * Rows and files this spec creates are purged before the run (a killed worker
 * skips `afterAll`) and removed again in `afterAll`, which also writes and
 * re-reads the artifact so a failing run still leaves evidence.
 */

const ARTIFACT = 'security-uploads-headers';

/** Namespaced fixture project the document-upload cases hang off. */
const PROJECT_TITLE = 'E2E Security Uploads Headers Fixture';

/** 1×1 PNG, 70 bytes — a real raster payload sharp accepts. */
const TINY_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const HTML_PAYLOAD = '<!doctype html><script>alert(1)</script>';
const SVG_PAYLOAD =
	'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';

/** Files this spec owns inside `public/uploads/`. */
const UPLOAD_FILE_MARKER = 'e2e-headers';

/**
 * 28,000,000 base64 characters ≈ 21.0 MB decoded: just over the 20 MB cap, and
 * above `MAX_REQUEST_BYTES` (~27.97 MB) once the JSON envelope is added, so the
 * declared-length gate answers before the body is parsed.
 */
const OVERSIZE_B64_CHARS = 28_000_000;

const DOCUMENTS_DIR = path.join(process.cwd(), 'private', 'documents');
const ATTACHMENTS_DIR = path.join(
	process.cwd(),
	'private',
	'message-attachments'
);
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

/** CSP directives the remediation contract requires (ADR-0012 § CSP). */
const REQUIRED_CSP: ReadonlyArray<readonly [string, string]> = [
	['default-src', "'self'"],
	['script-src', "'self'"],
	['object-src', "'none'"],
	['frame-ancestors', "'none'"],
	['connect-src', "'self'"],
	['form-action', "'self'"],
];

/** Split a CSP header into `directive -> sources`, lower-cased names. */
function cspDirectives(policy: string): Record<string, string> {
	const directives: Record<string, string> = {};
	for (const part of policy.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...sources] = trimmed.split(/\s+/);
		directives[name.toLowerCase()] = sources.join(' ');
	}
	return directives;
}

/** Directory listing, tolerant of a directory that does not exist yet. */
function listDir(dir: string): string[] {
	try {
		return readdirSync(dir).sort();
	} catch {
		return [];
	}
}

/**
 * POST a file to an upload endpoint and assert the content gate rejected it:
 * 400, `success: false`, and the markup reason (not the MIME/extension reason —
 * both endpoints declare `image/png` on a `.png` name here).
 */
async function expectMarkupRejected(
	request: APIRequestContext,
	url: string,
	file: { name: string; mimeType: string; buffer: Buffer },
	fields: Record<string, string>,
	label: string
): Promise<{ status: number; error: string }> {
	const response = await request.post(url, {
		multipart: { file, ...fields },
	});
	expect(response.status(), `${label} status`).toBe(400);
	const body = (await response.json()) as { success: boolean; error: string };
	expect(body.success, `${label} success flag`).toBe(false);
	expect(String(body.error), `${label} reason`).toMatch(/markup/i);
	return { status: response.status(), error: body.error };
}

/** Files this spec must remove again, by absolute path. */
const createdFiles = new Set<string>();
const createdDocumentIds: string[] = [];
const createdProjectIds: number[] = [];

const headersReport: Record<string, unknown> = {};
const documentReport: Record<string, unknown> = {};
const attachmentReport: Record<string, unknown> = {};
const sizeCapReport: Record<string, unknown> = {};

/** Flipped only after every assertion in every test has passed. */
let artifactOk = false;

test.describe.serial('security: headers and upload gates', () => {
	let projectId: number;

	test.beforeAll(async () => {
		// A crashed or cancelled previous run skips afterAll, so purge this
		// spec's namespace first: its fixture projects, their document rows and
		// files, and any uploads probe it left in public/uploads.
		const orphans = await rows<{ id: string; file_name: string }>(
			`SELECT d.id, d.file_name FROM entity_documents d
         JOIN projects p ON p.project_id = d.entity_id
        WHERE d.entity_type = 'project' AND p.project_title = ?`,
			[PROJECT_TITLE]
		);
		for (const orphan of orphans) {
			rmSync(path.join(DOCUMENTS_DIR, orphan.file_name), { force: true });
			await exec(`DELETE FROM entity_documents WHERE id = ?`, [orphan.id]);
		}
		await exec(`DELETE FROM projects WHERE project_title = ?`, [PROJECT_TITLE]);
		for (const file of listDir(UPLOADS_DIR)) {
			if (file.includes(UPLOAD_FILE_MARKER)) {
				rmSync(path.join(UPLOADS_DIR, file), { force: true });
			}
		}

		const project = await exec(
			`INSERT INTO projects (project_title, isDelete) VALUES (?, 0)`,
			[PROJECT_TITLE]
		);
		projectId = project.insertId;
		createdProjectIds.push(projectId);
	});

	test.afterAll(async () => {
		for (const id of createdDocumentIds) {
			await exec(`DELETE FROM entity_documents WHERE id = ?`, [id]);
		}
		for (const id of createdProjectIds) {
			await exec(`DELETE FROM projects WHERE project_id = ?`, [id]);
		}
		for (const file of createdFiles) {
			rmSync(file, { force: true });
		}

		const leftoverRows = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM projects WHERE project_title = ?`,
			[PROJECT_TITLE]
		);
		expect(Number(leftoverRows[0].n), 'fixture projects left behind').toBe(0);
		expect(
			[...createdFiles].filter((file) => existsSync(file)),
			'fixture files left behind'
		).toEqual([]);

		// Written here, not inside a test: `describe.serial` skips the remaining
		// tests after a failure, and a failed security run must still leave its
		// evidence file behind.
		writeArtifact(ARTIFACT, {
			headers: headersReport,
			documentUpload: documentReport,
			messageAttachments: attachmentReport,
			uploadsSizeCap: sizeCapReport,
			ok: artifactOk,
		});
		const saved = readArtifact(ARTIFACT);
		expect(saved.flow).toBe(ARTIFACT);
		expect(saved.ok).toBe(artifactOk);
	});

	test('serves the hardening headers on a public page, the health API and /uploads/*', async ({
		request,
		playwright,
	}) => {
		const anonymous = await anonymousContext(playwright, E2E_ENV.baseURL);
		try {
			// `/` redirects anonymous callers, so it is probed with the
			// authenticated context; next.config's headers apply either way.
			for (const [target, client] of [
				['/signin', anonymous],
				['/api/health', anonymous],
				['/', request],
			] as const) {
				const response = await client.get(target);
				expect(
					response.status(),
					`${target} should resolve (redirects allowed for anonymous pages)`
				).toBeLessThan(400);

				const headers = response.headers();
				const csp = headers['content-security-policy'] ?? '';
				const directives = cspDirectives(csp);
				for (const [directive, source] of REQUIRED_CSP) {
					expect(
						directives[directive] ?? '',
						`Content-Security-Policy ${directive} on ${target}`
					).toContain(source);
				}
				// 'unsafe-eval' is a development-only addition (next.config.ts);
				// a production build must never ship it.
				expect(
					directives['script-src'] ?? '',
					`script-src must be eval-free in production on ${target}`
				).not.toContain("'unsafe-eval'");
				expect(
					headers['strict-transport-security'] ?? '',
					`HSTS on ${target}`
				).toMatch(/max-age=\d+/);
				expect(headers['x-frame-options'], `X-Frame-Options on ${target}`).toBe(
					'DENY'
				);
				expect(headers['x-content-type-options'], `nosniff on ${target}`).toBe(
					'nosniff'
				);
				expect(headers['referrer-policy'], `Referrer-Policy on ${target}`).toBe(
					'no-referrer'
				);

				headersReport[target] = {
					status: response.status(),
					headers,
					directives,
				};
			}

			// `/uploads/:path*` keeps its nosniff + attachment handling. A file that
			// exists at server boot takes the strict branch; otherwise the probe is
			// produced through the real pipeline and the 200 assertion is skipped
			// with a recorded reason (see the file header).
			const bootFiles = listDir(UPLOADS_DIR).filter((file) =>
				file.endsWith('.png')
			);
			const producedByThisRun = bootFiles.length === 0;
			let probeUrl: string;

			if (!producedByThisRun) {
				probeUrl = `/uploads/${bootFiles[0]}`;
			} else {
				const upload = await request.post('/api/uploads', {
					data: { filename: `${UPLOAD_FILE_MARKER}.png`, b64: TINY_PNG_B64 },
				});
				expect(upload.status(), 'POST /api/uploads (probe)').toBe(200);
				const payload = (await upload.json()).data as {
					fileUrl: string;
					thumbUrl: string;
				};
				probeUrl = payload.fileUrl;

				for (const url of [payload.fileUrl, payload.thumbUrl]) {
					const file = path.join(UPLOADS_DIR, path.basename(url));
					createdFiles.add(file);
					// Whatever the static handler does with it, the pipeline must have
					// written a rasterized PNG here.
					expect(existsSync(file), `${url} should exist on disk`).toBe(true);
				}
			}

			const probe = await anonymous.get(probeUrl);
			const probeHeaders = probe.headers();
			expect(
				probeHeaders['x-content-type-options'],
				`nosniff on ${probeUrl}`
			).toBe('nosniff');
			expect(
				probeHeaders['content-disposition'],
				`attachment on ${probeUrl}`
			).toBe('attachment');

			if (!producedByThisRun) {
				expect(probe.status(), `${probeUrl} should be served`).toBe(200);
				expect(probeHeaders['content-type'] ?? '').toContain('image/png');
			} else {
				test.info().annotations.push({
					type: 'skip',
					description:
						'served-file 200 assertion skipped: public/uploads is empty at server boot ' +
						'and next start only serves public files present at boot; the /uploads/:path* ' +
						'nosniff + attachment contract is still asserted on this response',
				});
				expect(
					[200, 404],
					`status for ${probeUrl} (runtime-written file; next start serves boot-time files only)`
				).toContain(probe.status());
			}

			headersReport['/uploads/:path*'] = {
				status: probe.status(),
				url: probeUrl,
				servedFile: probe.status() === 200,
				servedFileSkipped: producedByThisRun,
				headers: probeHeaders,
				note: producedByThisRun
					? 'public/uploads was empty at boot, so the probe PNG was produced by POST /api/uploads during the run; next start serves only files present at boot, so the 200/content-type assertion is skipped (requirement escape hatch)'
					: 'probe reused a file already present in public/uploads at boot',
			};
		} finally {
			await anonymous.dispose();
		}
	});

	test('rejects HTML/SVG bytes declared as PNG and keeps a real PNG', async ({
		request,
	}) => {
		// Extension and declared MIME type are both allowed in every case below;
		// only the bytes give the payload away, which is what the gate must catch.
		const rejected = [
			{ label: 'html-declared-png', bytes: HTML_PAYLOAD },
			{ label: 'svg-declared-png', bytes: SVG_PAYLOAD },
		];
		const asPng = (bytes: string) => ({
			name: 'payload.png',
			mimeType: 'image/png',
			buffer: Buffer.from(bytes),
		});

		const documentsBefore = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM entity_documents WHERE entity_type = 'project' AND entity_id = ?`,
			[projectId]
		);
		const documentFilesBefore = listDir(DOCUMENTS_DIR);
		const documentUpload: Record<string, unknown> = {};

		for (const payload of rejected) {
			documentUpload[payload.label] = await expectMarkupRejected(
				request,
				'/api/document-upload',
				asPng(payload.bytes),
				{ entity_type: 'project', entity_id: String(projectId) },
				`document-upload ${payload.label}`
			);
		}

		const documentsAfterReject = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM entity_documents WHERE entity_type = 'project' AND entity_id = ?`,
			[projectId]
		);
		expect(
			Number(documentsAfterReject[0].n),
			'no row for a rejected document'
		).toBe(Number(documentsBefore[0].n));
		expect(listDir(DOCUMENTS_DIR), 'no file for a rejected document').toEqual(
			documentFilesBefore
		);
		const rejectedRows = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM entity_documents
        WHERE entity_type = 'project' AND entity_id = ? AND original_name = ?`,
			[projectId, 'payload.png']
		);
		expect(Number(rejectedRows[0].n), 'rejected payload rows').toBe(0);

		const acceptedDocument = await request.post('/api/document-upload', {
			multipart: {
				file: {
					name: 'benign.png',
					mimeType: 'image/png',
					buffer: Buffer.from(TINY_PNG_B64, 'base64'),
				},
				entity_type: 'project',
				entity_id: String(projectId),
			},
		});
		expect(acceptedDocument.status(), 'document-upload benign PNG').toBe(200);
		const document = (await acceptedDocument.json()).data as {
			id: string;
			file_name: string;
			file_type: string;
		};
		expect(document.file_type).toBe('image/png');
		expect(document.file_name).toMatch(/\.png$/);

		const storedDocument = await rows<{
			id: string;
			entity_type: string;
			entity_id: number;
			file_name: string;
			file_type: string;
			uploaded_by: number | null;
		}>(
			`SELECT id, entity_type, entity_id, file_name, file_type, uploaded_by
         FROM entity_documents WHERE id = ?`,
			[document.id]
		);
		expect(
			storedDocument,
			'entity_documents row for the accepted upload'
		).toHaveLength(1);
		expect(storedDocument[0].entity_type).toBe('project');
		expect(Number(storedDocument[0].entity_id)).toBe(projectId);
		expect(storedDocument[0].file_name).toBe(document.file_name);
		const documentFile = path.join(DOCUMENTS_DIR, document.file_name);
		expect(existsSync(documentFile), 'accepted document on disk').toBe(true);
		createdDocumentIds.push(document.id);
		createdFiles.add(documentFile);

		documentReport.rejected = documentUpload;
		documentReport.rowsBefore = Number(documentsBefore[0].n);
		documentReport.rowsAfterReject = Number(documentsAfterReject[0].n);
		documentReport.rejectedRowMatches = Number(rejectedRows[0].n);
		documentReport.accepted = {
			status: acceptedDocument.status(),
			id: document.id,
			file_name: document.file_name,
			file_type: document.file_type,
			uploaded_by: storedDocument[0].uploaded_by,
			onDisk: true,
		};

		// Same gate on the message-attachment endpoint. That endpoint only stores
		// the file; `message_attachments` rows are written when the message itself
		// is created, so the row count must not move here.
		const attachmentsBefore = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM message_attachments`
		);
		const attachmentFilesBefore = listDir(ATTACHMENTS_DIR);
		const messageUpload: Record<string, unknown> = {};

		for (const payload of rejected) {
			messageUpload[payload.label] = await expectMarkupRejected(
				request,
				'/api/messages/attachments',
				asPng(payload.bytes),
				{},
				`messages/attachments ${payload.label}`
			);
		}

		expect(
			listDir(ATTACHMENTS_DIR),
			'no file for a rejected message attachment'
		).toEqual(attachmentFilesBefore);

		const acceptedAttachment = await request.post('/api/messages/attachments', {
			multipart: {
				file: {
					name: 'benign.png',
					mimeType: 'image/png',
					buffer: Buffer.from(TINY_PNG_B64, 'base64'),
				},
			},
		});
		expect(acceptedAttachment.status(), 'messages/attachments benign PNG').toBe(
			200
		);
		const attachment = (await acceptedAttachment.json()).data as {
			file_name: string;
			file_path: string;
			file_type: string;
		};
		expect(attachment.file_type).toBe('image/png');
		expect(attachment.file_name).toMatch(/\.png$/);
		expect(attachment.file_path).toBe(
			`/private/message-attachments/${attachment.file_name}`
		);
		const attachmentFile = path.join(ATTACHMENTS_DIR, attachment.file_name);
		expect(existsSync(attachmentFile), 'accepted attachment on disk').toBe(
			true
		);
		createdFiles.add(attachmentFile);

		const attachmentsAfter = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM message_attachments`
		);
		expect(
			Number(attachmentsAfter[0].n),
			'message_attachments rows are only written with the message'
		).toBe(Number(attachmentsBefore[0].n));

		attachmentReport.rejected = messageUpload;
		attachmentReport.rowsBefore = Number(attachmentsBefore[0].n);
		attachmentReport.rowsAfter = Number(attachmentsAfter[0].n);
		attachmentReport.accepted = {
			status: acceptedAttachment.status(),
			file_name: attachment.file_name,
			file_path: attachment.file_path,
			file_type: attachment.file_type,
			onDisk: true,
		};
	});

	test('caps /api/uploads before the payload reaches the image pipeline', async ({
		request,
	}) => {
		const filesBefore = listDir(UPLOADS_DIR);

		// Built once: ~28 MB of base64 plus its JSON envelope, decoded size
		// ≈ 21.0 MB — just over the 20 MB cap.
		const b64 = 'A'.repeat(OVERSIZE_B64_CHARS);
		const response = await request.post('/api/uploads', {
			headers: { 'content-type': 'application/json' },
			data: JSON.stringify({ filename: 'e2e-oversize.png', b64 }),
		});

		expect(response.status(), 'oversized /api/uploads').toBe(413);
		const body = (await response.json()) as { success: boolean; error: string };
		expect(body.success).toBe(false);
		expect(String(body.error), 'oversize reason').toMatch(/20\s?MB/i);
		const filesAfter = listDir(UPLOADS_DIR);
		expect(filesAfter, 'no file for a rejected oversized payload').toEqual(
			filesBefore
		);

		sizeCapReport.base64Chars = b64.length;
		sizeCapReport.decodedBytes = Math.floor((b64.length * 3) / 4);
		sizeCapReport.status = response.status();
		sizeCapReport.error = body.error;
		sizeCapReport.filesBefore = filesBefore.length;
		sizeCapReport.filesAfter = filesAfter.length;

		artifactOk = true;
	});
});
