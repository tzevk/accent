/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer';
import chromium from '@sparticuz/chromium';
import { buildReceiptHTML, ReceiptData } from '@/utils/buildReceiptHTML';
import { blockNonLocalRequests } from '@/lib/pdf-request-guard';
import { localPdfBrowserArgs } from '@/lib/pdf-browser-args';
import { NextRequest, NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export const runtime = 'nodejs';
// Cold invocations must inflate ~50 MB of Chromium first — beyond Vercel's 10–15 s default.
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<Response> {
	const authResult: any = await ensurePermission(
		req,
		RESOURCES.ADMIN,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	const data: ReceiptData = await req.json();

	const viewport = {
		deviceScaleFactor: 1,
		hasTouch: false,
		height: 1080,
		isLandscape: true,
		isMobile: false,
		width: 1920,
	};

	const isVercel = process.env.VERCEL === '1';

	// Prefer a system Chrome on Windows; on any other host — or when that path
	// is absent — fall back to puppeteer's bundled Chromium so Linux CI works.
	const WINDOWS_CHROME =
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
	const localChromePath =
		process.platform === 'win32' && fs.existsSync(WINDOWS_CHROME)
			? WINDOWS_CHROME
			: undefined;

	let browser: Browser | undefined;
	if (isVercel) {
		// WebGL never helps a 2D print render; disabling graphics the
		// documented way keeps the swiftshader/angle acceleration flags
		// out of the arg list. Must happen before chromium.args is read.
		chromium.setGraphicsMode = false;
		// Launch as the README prescribes for serverless: pass
		// chromium.args through puppeteer.defaultArgs with headless:
		// 'shell'. The bundled headless_shell binary does not support
		// the "new" headless mode, which is what puppeteer 25 would
		// pass for headless: true. --no-sandbox ships with the package
		// list and --disable-dev-shm-usage with puppeteer's own
		// defaults; both are re-ensured here (mirroring
		// src/lib/pdf-browser-args.ts) so a small container /dev/shm
		// can never break the launch.
		const vercelArgs = [...chromium.args];
		for (const required of ['--disable-dev-shm-usage', '--no-sandbox']) {
			if (!vercelArgs.includes(required)) vercelArgs.push(required);
		}
		try {
			browser = await puppeteer.launch({
				args: await puppeteer.defaultArgs({
					args: vercelArgs,
					headless: 'shell',
				}),
				defaultViewport: viewport,
				executablePath: await chromium.executablePath(),
				headless: 'shell',
			});
		} catch (error) {
			// Separate an inflate/launch failure from the render pipeline:
			// "Chromium never started" (cold-start budget, missing br
			// files) vs "PDF generation failed". The stack trace is
			// logged, never sent back to the client.
			console.error('Error launching PDF browser on Vercel:', error);
			return NextResponse.json(
				{ success: false, error: 'Failed to launch the PDF browser' },
				{ status: 500 }
			);
		}
	} else {
		browser = await puppeteer.launch({
			args: localPdfBrowserArgs(),
			headless: true,
			defaultViewport: viewport,
			...(localChromePath ? { executablePath: localChromePath } : {}),
		});
	}

	const page = await browser.newPage();

	const html = buildReceiptHTML(data);

	await blockNonLocalRequests(page);
	await page.setContent(html, {
		waitUntil: 'domcontentloaded',
	});

	const pdf = await page.pdf({
		format: 'A4',
		printBackground: true,
		margin: {
			top: '10mm',
			bottom: '10mm',
			left: '10mm',
			right: '10mm',
		},
	});

	await browser.close();

	return new Response(Buffer.from(pdf), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': 'attachment; filename=receipt.pdf',
		},
	});
}
