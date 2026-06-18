import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { buildReceiptHTML, ReceiptData } from '@/utils/buildReceiptHTML';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

	const browser = await puppeteer.launch(
		isVercel
			? {
					args: chromium.args,
					defaultViewport: viewport,
					executablePath: await chromium.executablePath(),
					headless: true,
				}
			: {
					headless: true,
					defaultViewport: viewport,
					// use system Chrome locally
					executablePath:
						'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
				}
	);

	const page = await browser.newPage();

	const html = buildReceiptHTML(data);

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
