/**
 * Headless-Chrome request guard for server-rendered PDFs (SEC-21).
 *
 * PDF documents bake DB-derived HTML into a real browser. Without a guard, a
 * stored `<img src="https://attacker/…">` phone-homes from the server and can
 * stall rendering. Install this on the page BEFORE `setContent()`/`goto()`:
 * only local documents (`about:`, `data:`, `blob:`, `file:`) and loopback
 * origins (`localhost`, `127.0.0.1`, `[::1]`) may load; everything else is
 * aborted.
 */
import type { Page } from 'puppeteer';

const LOCAL_PROTOCOLS: Record<string, true> = {
	'about:': true,
	'data:': true,
	'blob:': true,
	'file:': true,
};
const LOOPBACK_HOSTNAMES: Record<string, true> = {
	localhost: true,
	'127.0.0.1': true,
	'[::1]': true,
};

/** True when `rawUrl` is allowed to load inside a PDF-rendering page. */
export function isLocalUrl(rawUrl: string | null | undefined): boolean {
	if (!rawUrl) return true;
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return false;
	}
	if (LOCAL_PROTOCOLS[url.protocol]) return true;
	if (url.protocol === 'http:' || url.protocol === 'https:') {
		return LOOPBACK_HOSTNAMES[url.hostname.toLowerCase()] === true;
	}
	return false;
}

/** Enable interception on `page` and abort every non-local request. */
export async function blockNonLocalRequests(page: Page): Promise<void> {
	await page.setRequestInterception(true);
	page.on('request', (request) => {
		if (isLocalUrl(request.url())) {
			request.continue().catch(() => {});
		} else {
			request.abort().catch(() => {});
		}
	});
}
