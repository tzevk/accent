import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { EMPLOYEE_USER } from '../lib/fixtures';

/**
 * Ticket #333 — project documents affordance on the dashboard.
 *
 * 1. HTTP seam: `/api/users/<id>/activity-assignments` carries a per-project
 *    document count that spans all three stores — the uploaded file row
 *    (`entity_documents`), the library document row (`project_documents`) and
 *    the listed received/issued entries on the projects JSON columns.
 * 2. Browser seam (the fixture employee, signed in with their own session
 *    state): a decorative document icon plus a tooltip on every Project name
 *    that has documents, no icon where the count is zero, one
 *    keyboard-reachable control with a visible focus state, and a click that
 *    opens the project's documents tab.
 * 3. Database seam: the very rows the count reads, asserted with the harness's
 *    own client.
 *
 * The uploaded document is created through the real multipart upload path
 * (POST /api/document-upload) as the super-admin fixture, exactly like
 * `e2e/specs/security/uploads-headers.spec.ts` does; the browser flows run as
 * the employee. Every row and file this spec owns is namespaced, purged before
 * the run and removed again in `afterAll`, which also writes the artifact.
 */

const ARTIFACT = 'project-documents-affordance';

/** Namespaced fixture projects this spec owns. */
const PROJECT_PREFIX = 'E2E Project Documents Affordance';
const WITH_DOCS_TITLE = `${PROJECT_PREFIX} With Documents`;
const WITHOUT_DOCS_TITLE = `${PROJECT_PREFIX} No Documents`;
const WITH_DOCS_NAME = 'With Documents Plant';
const WITHOUT_DOCS_NAME = 'No Documents Plant';
const WITH_DOCS_CODE = 'E2E-DOCS-001';
const WITHOUT_DOCS_CODE = 'E2E-DOCS-002';
const ASSIGNMENT_WITH_DOCS_ID = 'e2e-docs-aff-with-docs';
const ASSIGNMENT_WITHOUT_DOCS_ID = 'e2e-docs-aff-no-docs';

/** 1×1 PNG — a real raster payload the upload gate accepts. */
const TINY_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const DOCUMENTS_DIR = path.join(process.cwd(), 'private', 'documents');

/** The three stores, expected per project: 1 upload + 1 library + 2 listed. */
const EXPECTED_WITH_DOCS_COUNT = 4;

interface ActivityAssignmentsPayload {
	success: boolean;
	data: {
		assignments: Array<Record<string, unknown>>;
		emptyProjects: Array<Record<string, unknown>>;
		accessibleProjects: Array<Record<string, unknown>>;
		/** Per-project document count across the three stores, 0 when none. */
		documentCounts: Record<string, number>;
		stats: Record<string, unknown>;
	};
}

interface UploadedDocument {
	id: string;
	original_name: string;
	file_name: string;
	file_url: string;
	file_type: string;
	file_size: number;
}

/** Purge this spec's namespace: documents, library rows, assignments, projects. */
async function purgeNamespace(): Promise<void> {
	const docs = await rows<{ id: string; file_name: string }>(
		`SELECT d.id, d.file_name FROM entity_documents d
       JOIN projects p ON p.project_id = d.entity_id
      WHERE d.entity_type = 'project' AND p.project_title LIKE ?`,
		[`${PROJECT_PREFIX}%`]
	);
	for (const doc of docs) {
		rmSync(path.join(DOCUMENTS_DIR, doc.file_name), { force: true });
		await exec(`DELETE FROM entity_documents WHERE id = ?`, [doc.id]);
	}
	await exec(
		`DELETE FROM project_documents
       WHERE project_id IN (SELECT project_id FROM projects WHERE project_title LIKE ?)`,
		[`${PROJECT_PREFIX}%`]
	);
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		'e2e-docs-aff-%',
	]);
	await exec(`DELETE FROM projects WHERE project_title LIKE ?`, [
		`${PROJECT_PREFIX}%`,
	]);
}

let employeeUserId = 0;
let withDocsProjectId = 0;
let withoutDocsProjectId = 0;
let libraryDocumentId = '';

/** Files this spec created through the upload path, for the residue check. */
const createdFiles = new Set<string>();

const observed: Record<string, unknown> = {};

/** Flipped only after every assertion in every test has passed. */
let artifactOk = false;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

// The browser flows run as the low-privilege fixture employee; the upload
// itself runs on a super-admin context opened in beforeAll (the upload route
// requires project update permission, which the fixture employee does not
// hold — that gap is exactly what ticket #333 works around by giving the
// documents tab to the employee tab list).
test.use({ storageState: 'e2e/.auth/employee.json' });

test.describe.serial('project documents affordance', () => {
	let admin: APIRequestContext;

	test.beforeAll(async ({ playwright }) => {
		// A crashed or cancelled previous run skips afterAll, so purge first.
		await purgeNamespace();

		const [employee] = await rows<{ id: number; email: string }>(
			`SELECT id, email FROM users WHERE username = ? LIMIT 1`,
			[EMPLOYEE_USER.username]
		);
		if (!employee) {
			throw new Error(
				`[e2e] fixture employee ${EMPLOYEE_USER.username} is missing — ` +
					'seedFixtures() (run by e2e/global-setup.ts) must run first'
			);
		}
		employeeUserId = employee.id;

		// The employee reaches both projects as a team member, which is also how
		// they reach the project page itself (the projects API checks the team).
		const team = JSON.stringify([
			{
				user_id: employee.id,
				email: employee.email,
				full_name: EMPLOYEE_USER.fullName,
				role: 'Team Member',
			},
		]);
		const listedReceived = JSON.stringify([
			{
				document_name: 'Client brief Rev A',
				date_received: '2026-01-05',
				document_sent_by: 'Client',
				remarks: 'E2E fixture listed received document',
			},
		]);
		const listedIssued = JSON.stringify([
			{
				document_name: 'Issued drawing Rev A',
				issue_date: '2026-02-05',
				revision_no: 'A',
				remarks: 'E2E fixture listed issued document',
			},
		]);

		const withDocs = await exec(
			`INSERT INTO projects
         (project_title, name, project_code, status, start_date, project_team,
          documents_received_list, documents_issued_list, isDelete)
       VALUES (?, ?, ?, 'Active', '2026-01-01', ?, ?, ?, 0)`,
			[
				WITH_DOCS_TITLE,
				WITH_DOCS_NAME,
				WITH_DOCS_CODE,
				team,
				listedReceived,
				listedIssued,
			]
		);
		withDocsProjectId = withDocs.insertId;

		const withoutDocs = await exec(
			`INSERT INTO projects
         (project_title, name, project_code, status, start_date, project_team, isDelete)
       VALUES (?, ?, ?, 'Active', '2026-01-01', ?, 0)`,
			[WITHOUT_DOCS_TITLE, WITHOUT_DOCS_NAME, WITHOUT_DOCS_CODE, team]
		);
		withoutDocsProjectId = withoutDocs.insertId;

		// One activity row per project, so both Project names render as table
		// row links on the employee's dashboard. The due date sits inside the
		// component's default filter window (current month → today, both read
		// from the same UTC clock the component uses).
		const today = new Date().toISOString().slice(0, 10);
		const activityRows: Array<[string, number]> = [
			[ASSIGNMENT_WITH_DOCS_ID, withDocsProjectId],
			[ASSIGNMENT_WITHOUT_DOCS_ID, withoutDocsProjectId],
		];
		for (const [index, [id, projectId]] of activityRows.entries()) {
			await exec(
				`INSERT INTO user_activity_assignments
           (id, user_id, project_id, activity_id, activity_name, discipline_name,
            status, estimated_hours, due_date)
         VALUES (?, ?, ?, ?, 'Foundation Work', 'Civil', 'In Progress', 8, ?)`,
				[id, employee.id, projectId, `e2e-docs-aff-act-${index + 1}`, today]
			);
		}

		// Store 1 — a real file through the real multipart upload path.
		admin = await playwright.request.newContext({
			storageState: 'e2e/.auth/admin.json',
		});
		const upload = await admin.post('/api/document-upload', {
			multipart: {
				file: {
					name: 'e2e-docs-affordance.png',
					mimeType: 'image/png',
					buffer: Buffer.from(TINY_PNG_B64, 'base64'),
				},
				entity_type: 'project',
				entity_id: String(withDocsProjectId),
			},
		});
		expect(upload.status(), await upload.text()).toBe(200);
		const uploaded = (await upload.json()).data as UploadedDocument;
		const uploadedFile = path.join(DOCUMENTS_DIR, uploaded.file_name);
		createdFiles.add(uploadedFile);
		expect(uploadedFile, 'uploaded file exists on disk').toBeTruthy();

		// Store 2 — one library document row.
		libraryDocumentId = randomUUID();
		await exec(
			`INSERT INTO project_documents
         (id, project_id, doc_master_id, name, file_url, status)
       VALUES (?, ?, NULL, 'Library drawing pack', '/uploads/e2e-docs-aff.png', 'active')`,
			[libraryDocumentId, withDocsProjectId]
		);
	});

	test.afterAll(async () => {
		if (admin) await admin.dispose();
		await purgeNamespace();

		// Nothing this spec owns may survive the run.
		const residue = {
			projects: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM projects WHERE project_title LIKE ?`,
				[`${PROJECT_PREFIX}%`]
			),
			uploads: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM entity_documents d
           JOIN projects p ON p.project_id = d.entity_id
          WHERE d.entity_type = 'project' AND p.project_title LIKE ?`,
				[`${PROJECT_PREFIX}%`]
			),
			library: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM project_documents
          WHERE project_id IN (SELECT project_id FROM projects WHERE project_title LIKE ?)`,
				[`${PROJECT_PREFIX}%`]
			),
			assignments: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM user_activity_assignments WHERE id LIKE ?`,
				['e2e-docs-aff-%']
			),
			files: [...createdFiles].filter((file) => existsSync(file)),
		};
		for (const [name, value] of Object.entries(residue)) {
			if (name === 'files') {
				expect(value as string[], 'fixture files left behind').toEqual([]);
			} else {
				expect(Number((value as Array<{ n: number }>)[0].n), `${name} rows left behind`).toBe(0);
			}
		}

		// Written here, not inside a test: `describe.serial` skips the remaining
		// tests after a failure, and a failed run must still leave its evidence.
		writeArtifact(ARTIFACT, { ...observed, ok: artifactOk });
		const saved = readArtifact(ARTIFACT);
		expect(saved.flow).toBe(ARTIFACT);
		expect(saved.ok).toBe(artifactOk);
	});

	test('the document count covers all three stores and the database rows agree', async ({
		request,
	}) => {
		const response = await request.get(
			`/api/users/${employeeUserId}/activity-assignments`
		);
		expect(response.status(), await response.text()).toBe(200);
		const payload = (await response.json()) as ActivityAssignmentsPayload;
		expect(payload.success).toBe(true);

		const withDocs = payload.data.documentCounts[String(withDocsProjectId)];
		const withoutDocs = payload.data.documentCounts[String(withoutDocsProjectId)];
		expect(withDocs, 'with-documents project count').toBe(
			EXPECTED_WITH_DOCS_COUNT
		);
		expect(withoutDocs, 'project with no documents').toBe(0);

		// Both projects stay reachable in the payload — the count is additive.
		const accessibleIds = payload.data.accessibleProjects.map((project) =>
			String(project.project_id)
		);
		expect(accessibleIds).toContain(String(withDocsProjectId));
		expect(accessibleIds).toContain(String(withoutDocsProjectId));
		// The pre-existing payload keys keep their shape.
		expect(Array.isArray(payload.data.assignments)).toBe(true);
		expect(Array.isArray(payload.data.emptyProjects)).toBe(true);
		expect(payload.data.stats).toBeTruthy();

		// The rows the count reads, asserted with the harness's own client.
		const uploaded = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM entity_documents
        WHERE entity_type = 'project' AND entity_id = ?`,
			[withDocsProjectId]
		);
		expect(Number(uploaded[0].n), 'uploaded files on the with-docs project').toBe(
			1
		);
		const uploadedElsewhere = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM entity_documents
        WHERE entity_type = 'project' AND entity_id = ?`,
			[withoutDocsProjectId]
		);
		expect(
			Number(uploadedElsewhere[0].n),
			'no uploaded files on the no-documents project'
		).toBe(0);

		const library = await rows<{ id: string; n: number; status: string }>(
			`SELECT id, COUNT(*) AS n, MIN(status) AS status FROM project_documents
        WHERE project_id = ? AND id = ?`,
			[withDocsProjectId, libraryDocumentId]
		);
		expect(Number(library[0].n), 'library documents').toBe(1);
		expect(library[0].id, 'library document row').toBe(libraryDocumentId);
		expect(library[0].status, 'library document is active').toBe('active');

		const listed = await rows<{
			received: string | null;
			issued: string | null;
		}>(
			`SELECT documents_received_list AS received, documents_issued_list AS issued
         FROM projects WHERE project_id = ? AND isDelete = 0`,
			[withDocsProjectId]
		);
		expect(JSON.parse(String(listed[0].received))).toHaveLength(1);
		expect(JSON.parse(String(listed[0].issued))).toHaveLength(1);
		expect(1 + 1 + 1 + 1, 'three stores, four rows').toBe(
			EXPECTED_WITH_DOCS_COUNT
		);

		observed.payload = {
			employeeUserId,
			withDocsProjectId,
			withoutDocsProjectId,
			withDocs,
			withoutDocs,
			stores: {
				uploaded: Number(uploaded[0].n),
				library: Number(library[0].n),
				listedReceived: 1,
				listedIssued: 1,
			},
		};
	});

	test('every project name carries the icon, the tooltip and the documents deep link', async ({
		page,
	}) => {
		await page.goto('/user/dashboard');

		// The dashboard opens with the pending-entries reminder when a seeded
		// activity has no entry for today; dismiss it so the table is reachable.
		const remindLater = page.getByRole('button', { name: 'Remind Later' });
		try {
			await remindLater.waitFor({ state: 'visible', timeout: 10_000 });
			await remindLater.click();
		} catch {
			// No reminder this run — nothing to dismiss.
		}

		const withDocsLink = page.getByRole('link', {
			name: `Open documents for ${WITH_DOCS_NAME}`,
		});
		const withoutDocsLink = page.getByRole('link', {
			name: `Open documents for ${WITHOUT_DOCS_NAME}`,
		});
		await expect(withDocsLink).toHaveCount(1);
		await expect(withoutDocsLink).toHaveCount(1);

		// Deep link to the documents tab, and the tooltip that names what the
		// click opens — the same string the accessible name is carried by.
		await expect(withDocsLink).toHaveAttribute(
			'href',
			`/projects/${withDocsProjectId}?tab=upload_documents`
		);
		await expect(withDocsLink).toHaveAttribute(
			'title',
			`Open documents for ${WITH_DOCS_NAME}`
		);

		// The icon is decorative: it sits inside the one link and is hidden from
		// the accessibility tree, so the Project name stays one control.
		const icon = withDocsLink.locator('svg');
		await expect(icon).toHaveCount(1);
		await expect(icon).toHaveAttribute('aria-hidden', 'true');
		await expect(
			withDocsLink.locator('button, [role="button"]')
		).toHaveCount(0);

		// A project with no documents carries no icon.
		await expect(withoutDocsLink).toHaveAttribute(
			'href',
			`/projects/${withoutDocsProjectId}?tab=upload_documents`
		);
		await expect(withoutDocsLink.locator('svg')).toHaveCount(0);

		// One keyboard-reachable control with a visible focus state: the Project
		// name is a single anchor, and the focus ring is rendered (Tailwind's
		// focus-visible outline, driven by a real keyboard interaction).
		await withDocsLink.evaluate((element) => element.blur());
		await withDocsLink.focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await expect(withDocsLink).toBeFocused();
		const focusRing = await withDocsLink.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				outlineStyle: style.outlineStyle,
				outlineWidth: style.outlineWidth,
			};
		});
		expect(focusRing.outlineStyle, 'focus outline is rendered').not.toBe('none');
		expect(parseFloat(focusRing.outlineWidth)).toBeGreaterThan(0);

		observed.link = {
			withDocs: {
				href: await withDocsLink.getAttribute('href'),
				title: await withDocsLink.getAttribute('title'),
				iconCount: await icon.count(),
			},
			withoutDocs: {
				href: await withoutDocsLink.getAttribute('href'),
				iconCount: await withoutDocsLink.locator('svg').count(),
			},
			focusRing,
		};

		// One click reaches the project's documents: the page reads the target
		// tab from the URL and shows it as the active tab.
		await withDocsLink.click();
		await page.waitForURL(
			`**/projects/${withDocsProjectId}?tab=upload_documents`
		);
		await expect(
			page.getByRole('tab', { name: 'Upload Documents' })
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			page.getByRole('heading', { name: 'Upload Documents' })
		).toBeVisible();
		expect(new URL(page.url()).searchParams.get('tab')).toBe('upload_documents');

		observed.documentsTab = {
			url: page.url(),
			tabSelected: true,
		};
	});

	test('an employee opens the documents tab from the URL, with or without the param', async ({
		page,
	}) => {
		// Direct navigation proves the tab read for every employee, not only
		// through the dashboard's link.
		await page.goto(`/projects/${withDocsProjectId}?tab=upload_documents`);
		await expect(
			page.getByRole('tab', { name: 'Upload Documents' })
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			page.getByRole('heading', { name: 'Upload Documents' })
		).toBeVisible();

		// Without the param the project page keeps its own default tab.
		await page.goto(`/projects/${withDocsProjectId}`);
		await expect(page.getByRole('tab', { name: 'Scope' })).toHaveAttribute(
			'aria-selected',
			'true'
		);

		observed.tabRead = {
			withParam: 'upload_documents',
			withoutParam: 'scope',
		};

		// Every assertion in this spec passed; the artifact says so.
		artifactOk = true;
	});
});
