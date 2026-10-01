import { expect, test, type APIRequestContext } from '@playwright/test';
import { readArtifact, writeArtifact } from '../../lib/artifacts';
import { exec, rows } from '../../lib/db';
import { E2E_ENV } from '../../lib/env';
import { loginAs } from '../../lib/security-fixtures';

/**
 * Workstream D — document/print sinks.
 *
 * Hostile markup is written straight into the DB (`E2E-DOCESC-` namespace) in
 * the columns each route template interpolates, then fetched through the
 * super-admin session. Every `text/html` download must carry the entity-escaped
 * form of the stored value and must not contain the raw payload as live markup.
 *
 * The two PDF sinks (the Puppeteer receipt and the quotations PDF) are asserted
 * for status + `%PDF` magic only: PDF page text lives in compressed, font-coded
 * content streams, so a byte-level escaping assertion there proves nothing.
 * Escaping is asserted at the HTML sink — the same values, the same escaper.
 */

const ARTIFACT = 'security-document-escaping';

/** Every row this spec creates and deletes. */
const PREFIX = 'E2E-DOCESC-';
const RUN = `${PREFIX}${Date.now()}`;

/** Slash-delimited handler inside an SVG element. */
const SVG = '<svg/onload=alert(1)>';
/** Attribute handler on an injected `<img>`. */
const IMG = '<img src=x onerror=alert(1)>';
/** Attribute break-out followed by a script element. */
const BREAKOUT = '"><script>alert(1)</script>';

/** What `src/lib/escape-html.ts` must produce for each payload. */
const ESCAPED = {
	svg: '&lt;svg/onload=alert(1)&gt;',
	img: '&lt;img src=x onerror=alert(1)&gt;',
	breakout: '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
} as const;

const RAW = { svg: SVG, img: IMG, breakout: BREAKOUT } as const;

type PayloadKey = keyof typeof ESCAPED;

/** Escaped/raw probe results for one response body. */
interface HtmlCheck {
	escaped: Record<string, boolean>;
	raw: Record<string, boolean>;
	scriptTagCount: number;
	onerrorHandlerCount: number;
}

interface HtmlSinkResult extends HtmlCheck {
	name: string;
	template: string;
	route: string;
	rowId: number;
	/** DB column -> the hostile value read back from the row. */
	seededFields: Record<string, string>;
	status: number;
	contentType: string;
	/** Markup the template itself ships (not data) — the expected counts. */
	staticMarkup: { scriptTags: number; onerrorHandlers: number };
	escapedOk: boolean;
	rawOk: boolean;
}

interface PdfSinkResult {
	name: string;
	template: string;
	route: string;
	method: string;
	status: number;
	contentType: string;
	contentDisposition: string;
	pdfMagic: boolean;
	seededFields: Record<string, string>;
	note: string;
}

interface HtmlSink {
	name: string;
	/** The route file whose template interpolates the seeded columns. */
	template: string;
	route: string;
	rowId: number;
	seededFields: Record<string, string>;
	payloads: PayloadKey[];
	staticMarkup: { scriptTags: number; onerrorHandlers: number };
}

const htmlSinks: HtmlSink[] = [];
const htmlResults: HtmlSinkResult[] = [];
const pdfResults: PdfSinkResult[] = [];

let admin: APIRequestContext | undefined;
let quotationId = 0;
let invoiceId = 0;

const PDF_NOTE =
	'PDF page text is compressed and font-coded, so escaping is asserted at ' +
	'the HTML sink (same stored values, same escaper); here only status and the ' +
	'%PDF magic are asserted.';

const HTML_NOTE =
	'`text/html` sinks escape every interpolated DB value. scriptTags/' +
	'onerrorHandlers count real markup elements only (escaped text cannot form a ' +
	'tag), so the expected values are the elements the template itself ships — ' +
	'for the outgoing PO that is one print-on-load <script> and the logo <img> ' +
	'onerror fallback.';

/** The super-admin context, or a loud failure at the call site. */
function requireAdmin(): APIRequestContext {
	if (!admin) {
		throw new Error('[e2e] super-admin context missing (beforeAll failed)');
	}
	return admin;
}

/**
 * mysql2 hands back `utf8mb4_bin` longtext columns (the JSON-shaped ones)
 * pre-parsed, so read-back assertions and the artifact compare text either way.
 */
function storedText(value: unknown): string {
	if (typeof value === 'string') return value;
	return value == null ? '' : JSON.stringify(value);
}

/**
 * Probe one response body. Escaped text can never match a tag pattern (the
 * `<` itself is an entity), so counting *markup* isolates real elements —
 * exactly what a broken sink would leak.
 */
function inspectHtml(body: string, payloads: PayloadKey[]): HtmlCheck {
	const escaped: Record<string, boolean> = {};
	const raw: Record<string, boolean> = {};
	for (const key of payloads) {
		escaped[key] = body.includes(ESCAPED[key]);
		raw[key] = body.includes(RAW[key]);
	}
	const tags = body.match(/<[a-zA-Z][^>]*>/g) ?? [];
	return {
		escaped,
		raw,
		scriptTagCount: tags.filter((tag) => /^<script\b/i.test(tag)).length,
		onerrorHandlerCount: tags.filter((tag) => /\bonerror\s*=/i.test(tag))
			.length,
	};
}

/**
 * Last entry per sink name: hooks re-run on a CI retry, so results accumulate
 * while the seeded rows are recreated underneath them.
 */
function dedupeByName<T extends { name: string }>(entries: T[]): T[] {
	const byName: Record<string, T> = {};
	for (const entry of entries) byName[entry.name] = entry;
	return Object.values(byName);
}

/** Table/column pairs that hold this spec's namespace. */
const SEEDED_TARGETS = [
	['purchase_orders', 'po_number'],
	['material_requisitions', 'requisition_number'],
	['outgoing_purchase_orders', 'po_number'],
	['quotations', 'quotation_number'],
	['invoices', 'invoice_number'],
] as const;

/** Delete every row this spec owns. Idempotent; returns rows removed. */
async function purgeSeededRows(): Promise<number> {
	let deleted = 0;
	for (const [table, column] of SEEDED_TARGETS) {
		const result = await exec(
			`DELETE FROM \`${table}\` WHERE \`${column}\` LIKE ?`,
			[`${PREFIX}%`]
		);
		deleted += result.affectedRows;
	}
	return deleted;
}

/** Rows still carrying the namespace after cleanup (must be 0). */
async function remainingSeededRows(): Promise<number> {
	let remaining = 0;
	for (const [table, column] of SEEDED_TARGETS) {
		const [count] = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` LIKE ?`,
			[`${PREFIX}%`]
		);
		remaining += Number(count.n);
	}
	return remaining;
}

test.describe('security: document escaping (workstream D)', () => {
	test.beforeAll(async ({ playwright }) => {
		// Hooks re-run on a CI retry: the previous ids are gone after the purge
		// below, so the sink list is rebuilt from scratch (results are deduped).
		htmlSinks.length = 0;
		// A crashed earlier run must never collide with this one.
		await purgeSeededRows();

		const purchaseOrder = await exec(
			`INSERT INTO purchase_orders
	       (po_number, vendor_name, kind_attn, vendor_gstin, quotation_no, items, subtotal, status, isDelete)
	     VALUES (?, ?, ?, '27AAAAA0000A1Z5', ?, ?, 100, 'draft', 0)`,
			[
				`${RUN}-PO`,
				SVG,
				IMG,
				BREAKOUT,
				JSON.stringify([
					{ description: IMG, quantity: 1, rate: 100, amount: 100 },
				]),
			]
		);
		const requisition = await exec(
			`INSERT INTO material_requisitions
	       (requisition_number, requisition_date, requested_by, department, line_items,
	        prepared_by, receipt_date, status, isDelete)
	     VALUES (?, '2026-09-01', ?, ?, ?, ?, '2026-09-05', 'pending', 0)`,
			[
				`${RUN}-MR`,
				SVG,
				BREAKOUT,
				JSON.stringify([
					{
						sr_no: 1,
						description: IMG,
						unit_qty: '1',
						purpose: SVG,
					},
				]),
				IMG,
			]
		);
		const outgoingPo = await exec(
			`INSERT INTO outgoing_purchase_orders
	       (po_number, company_name, city, project_number, remarks, po_amount, po_date, status, isDelete)
	     VALUES (?, ?, ?, ?, ?, 100, '2026-09-01', 'pending', 0)`,
			[`${RUN}-OPO`, SVG, BREAKOUT, IMG, BREAKOUT]
		);
		const quotation = await exec(
			`INSERT INTO quotations
	       (client_name, quotation_number, quotation_date, scope_items, status, isDelete)
	     VALUES (?, ?, '2026-09-01', ?, 'draft', 0)`,
			[
				SVG,
				`${RUN}-Q`,
				JSON.stringify([
					{ sr_no: 1, description: IMG, qty: 1, rate: 100, amount: 100 },
				]),
			]
		);
		quotationId = quotation.insertId;

		const invoice = await exec(
			`INSERT INTO invoices
	       (invoice_number, client_name, client_address, invoice_date, total, status, isDelete)
	     VALUES (?, ?, ?, '2026-09-01', 100, 'draft', 0)`,
			[`${RUN}-INV`, SVG, BREAKOUT]
		);
		invoiceId = invoice.insertId;

		// The premise: the payload is stored verbatim, not sanitized on the way in
		// (the write-path sanitizer owns rich-text columns; these are plain text).
		const storedPo = await rows<{
			vendor_name: string;
			kind_attn: string;
			quotation_no: string;
			items: unknown;
		}>(
			`SELECT vendor_name, kind_attn, quotation_no, items FROM purchase_orders WHERE id = ?`,
			[purchaseOrder.insertId]
		);
		const storedMr = await rows<{
			requested_by: string;
			department: string;
			line_items: unknown;
			prepared_by: string;
		}>(
			`SELECT requested_by, department, line_items, prepared_by FROM material_requisitions WHERE id = ?`,
			[requisition.insertId]
		);
		const storedOpo = await rows<{
			company_name: string;
			city: string;
			project_number: string;
			remarks: string;
		}>(
			`SELECT company_name, city, project_number, remarks FROM outgoing_purchase_orders WHERE id = ?`,
			[outgoingPo.insertId]
		);
		const storedQuotation = await rows<{
			client_name: string;
			scope_items: unknown;
		}>(`SELECT client_name, scope_items FROM quotations WHERE id = ?`, [
			quotation.insertId,
		]);
		expect(storedPo[0]?.vendor_name).toBe(SVG);
		expect(storedPo[0]?.kind_attn).toBe(IMG);
		expect(storedPo[0]?.quotation_no).toBe(BREAKOUT);
		expect(storedText(storedPo[0]?.items)).toContain(IMG);
		expect(storedMr[0]?.requested_by).toBe(SVG);
		expect(storedMr[0]?.department).toBe(BREAKOUT);
		expect(storedText(storedMr[0]?.line_items)).toContain(IMG);
		expect(storedMr[0]?.prepared_by).toBe(IMG);
		expect(storedOpo[0]?.company_name).toBe(SVG);
		expect(storedOpo[0]?.city).toBe(BREAKOUT);
		expect(storedOpo[0]?.project_number).toBe(IMG);
		expect(storedOpo[0]?.remarks).toBe(BREAKOUT);
		expect(storedQuotation[0]?.client_name).toBe(SVG);
		expect(storedText(storedQuotation[0]?.scope_items)).toContain(IMG);

		htmlSinks.push(
			{
				name: 'purchase order',
				template: 'src/app/api/admin/purchase-orders/download/route.js',
				route: `/api/admin/purchase-orders/download?id=${purchaseOrder.insertId}`,
				rowId: purchaseOrder.insertId,
				seededFields: {
					vendor_name: storedPo[0].vendor_name,
					kind_attn: storedPo[0].kind_attn,
					quotation_no: storedPo[0].quotation_no,
					'items[0].description': IMG,
				},
				payloads: ['svg', 'img', 'breakout'],
				staticMarkup: { scriptTags: 0, onerrorHandlers: 0 },
			},
			{
				name: 'material requisition',
				template: 'src/app/api/admin/material-requisitions/download/route.js',
				route: `/api/admin/material-requisitions/download?id=${requisition.insertId}`,
				rowId: requisition.insertId,
				seededFields: {
					requested_by: storedMr[0].requested_by,
					department: storedMr[0].department,
					prepared_by: storedMr[0].prepared_by,
					'line_items[0].description': IMG,
					'line_items[0].purpose': SVG,
				},
				payloads: ['svg', 'img', 'breakout'],
				staticMarkup: { scriptTags: 0, onerrorHandlers: 0 },
			},
			{
				name: 'outgoing purchase order',
				template:
					'src/app/api/admin/outgoing-purchase-orders/download/route.ts',
				route: `/api/admin/outgoing-purchase-orders/download?id=${outgoingPo.insertId}`,
				rowId: outgoingPo.insertId,
				seededFields: {
					company_name: storedOpo[0].company_name,
					city: storedOpo[0].city,
					project_number: storedOpo[0].project_number,
					remarks: storedOpo[0].remarks,
				},
				payloads: ['svg', 'img', 'breakout'],
				// This template ships one print-on-load <script> and an
				// `onerror` fallback on its logo <img>.
				staticMarkup: { scriptTags: 1, onerrorHandlers: 1 },
			}
		);

		admin = await loginAs(playwright, E2E_ENV.baseURL, 'superAdmin');

		// The tested surface, pinned: dropping a sink must fail here, not just
		// shrink the artifact.
		expect(htmlSinks.map((sink) => sink.name)).toEqual([
			'purchase order',
			'material requisition',
			'outgoing purchase order',
		]);
	});

	test.afterAll(async () => {
		const deleted = await purgeSeededRows();
		const remaining = await remainingSeededRows();
		expect(remaining, 'seeded rows removed').toBe(0);

		const htmlSinkResults = dedupeByName(htmlResults);
		const pdfSinkResults = dedupeByName(pdfResults);
		const htmlSinksOk = [
			'purchase order',
			'material requisition',
			'outgoing purchase order',
		].every((name) =>
			htmlSinkResults.some(
				(sink) => sink.name === name && sink.escapedOk && sink.rawOk
			)
		);
		const pdfSinksOk = ['payment receipt', 'quotation'].every((name) =>
			pdfSinkResults.some(
				(sink) => sink.name === name && sink.status === 200 && sink.pdfMagic
			)
		);

		writeArtifact(ARTIFACT, {
			namespace: PREFIX,
			payloads: {
				svg: SVG,
				img: IMG,
				breakout: BREAKOUT,
				escaped: {
					svg: ESCAPED.svg,
					img: ESCAPED.img,
					breakout: ESCAPED.breakout,
				},
			},
			htmlSinks: htmlSinkResults,
			pdfSinks: pdfSinkResults,
			cleanup: { deletedRows: deleted, remainingRows: remaining },
			notes: { html: HTML_NOTE, pdf: PDF_NOTE },
			ok: htmlSinksOk && pdfSinksOk,
		});
		const artifact = readArtifact(ARTIFACT);
		expect(artifact.flow).toBe(ARTIFACT);
		expect(artifact.ok, 'artifact summary').toBe(true);

		await admin?.dispose();
	});

	test('seeded documents render escaped HTML, never raw payload markup', async () => {
		const context = requireAdmin();
		for (const sink of htmlSinks) {
			const response = await context.get(sink.route);
			expect(response.status(), `${sink.name} status`).toBe(200);
			const contentType = response.headers()['content-type'] ?? '';
			expect(contentType, `${sink.name} content type`).toContain('text/html');

			const body = await response.text();
			const check = inspectHtml(body, sink.payloads);

			for (const key of sink.payloads) {
				expect(check.escaped[key], `${sink.name}: escaped ${key} present`).toBe(
					true
				);
				expect(check.raw[key], `${sink.name}: raw ${key} present`).toBe(false);
			}
			expect(check.scriptTagCount, `${sink.name}: <script> count`).toBe(
				sink.staticMarkup.scriptTags
			);
			expect(check.onerrorHandlerCount, `${sink.name}: onerror= count`).toBe(
				sink.staticMarkup.onerrorHandlers
			);

			htmlResults.push({
				...check,
				name: sink.name,
				template: sink.template,
				route: sink.route,
				rowId: sink.rowId,
				seededFields: sink.seededFields,
				status: response.status(),
				contentType,
				staticMarkup: sink.staticMarkup,
				escapedOk: sink.payloads.every((key) => check.escaped[key]),
				rawOk: sink.payloads.every((key) => !check.raw[key]),
			});
		}
		expect(dedupeByName(htmlResults).map((result) => result.name)).toEqual(
			htmlSinks.map((sink) => sink.name)
		);
	});

	test('receipt PDF still renders for hostile payloads', async () => {
		test.setTimeout(120_000);
		// Only the fields `buildReceiptHTML` actually renders carry payloads;
		// `bank_name`/`remark` are in the request shape but never emitted.
		const seededFields = {
			receipt_no: BREAKOUT,
			company_name: SVG,
			invoice_no: SVG,
			transaction_id: IMG,
		};
		const context = requireAdmin();
		const response = await context.post(
			'/api/admin/payment-entries/get-receipt-pdf',
			{
				data: {
					...seededFields,
					receipt_date: '2026-09-01',
					amount: 100,
					payment_date: '2026-09-02',
					invoice_date: '2026-08-15',
					payment_type: 'full',
					bank_name: 'E2E Bank',
					remark: 'E2E remark',
				},
			}
		);
		expect(response.status()).toBe(200);
		const contentType = response.headers()['content-type'] ?? '';
		expect(contentType).toContain('application/pdf');
		const body = await response.body();
		expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

		pdfResults.push({
			name: 'payment receipt',
			template: 'src/utils/buildReceiptHTML.ts',
			route: '/api/admin/payment-entries/get-receipt-pdf',
			method: 'POST',
			status: response.status(),
			contentType,
			contentDisposition: response.headers()['content-disposition'] ?? '',
			pdfMagic: true,
			seededFields,
			note: PDF_NOTE,
		});
	});

	test('quotations PDF still renders for hostile payloads', async () => {
		test.setTimeout(120_000);
		expect(quotationId).toBeGreaterThan(0);
		const context = requireAdmin();
		const route = `/api/admin/quotations/download?id=${quotationId}&source=quotations`;
		const response = await context.get(route);
		expect(response.status()).toBe(200);
		const contentType = response.headers()['content-type'] ?? '';
		expect(contentType).toContain('application/pdf');
		const body = await response.body();
		expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

		pdfResults.push({
			name: 'quotation',
			template: 'src/app/api/admin/quotations/download/route.js',
			route,
			method: 'GET',
			status: response.status(),
			contentType,
			contentDisposition: response.headers()['content-disposition'] ?? '',
			pdfMagic: true,
			seededFields: {
				client_name: SVG,
				'scope_items[0].description': IMG,
			},
			note: PDF_NOTE,
		});
	});

	test('invoices PDF still renders for hostile payloads', async () => {
		test.setTimeout(120_000);
		expect(invoiceId).toBeGreaterThan(0);
		const context = requireAdmin();
		const route = `/api/admin/invoices/download?id=${invoiceId}`;
		const response = await context.get(route);
		expect(response.status()).toBe(200);
		const contentType = response.headers()['content-type'] ?? '';
		expect(contentType).toContain('application/pdf');
		const body = await response.body();
		expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

		pdfResults.push({
			name: 'invoice',
			template: 'src/app/api/admin/invoices/download/route.js',
			route,
			method: 'GET',
			status: response.status(),
			contentType,
			contentDisposition: response.headers()['content-disposition'] ?? '',
			pdfMagic: true,
			seededFields: {
				client_name: SVG,
				client_address: BREAKOUT,
			},
			note: PDF_NOTE,
		});
	});
});
