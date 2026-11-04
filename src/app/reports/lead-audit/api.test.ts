import { afterEach, describe, expect, it, vi } from 'vitest';
import { leadAuditGet } from './api';

/** The report must keep values that the shared client treats as a sentinel. */
function captureRequests(): string[] {
	const urls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			urls.push(input);
			return new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		})
	);
	return urls;
}

describe('leadAuditGet', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps a literal all source label and search term', async () => {
		const urls = captureRequests();
		await leadAuditGet('/api/reports/lead-audit', {
			source: 'all',
			search: 'all',
		});
		expect(urls[0]).toBe('/api/reports/lead-audit?source=all&search=all');
	});

	it('keeps the all conversion population instead of dropping it', async () => {
		const urls = captureRequests();
		await leadAuditGet('/api/reports/lead-audit/conversion/evidence', {
			evidence: 'all',
			page: 1,
			limit: 25,
		});
		expect(urls[0]).toBe(
			'/api/reports/lead-audit/conversion/evidence?evidence=all&page=1&limit=25'
		);
	});

	it('omits empty values but keeps zero and false', async () => {
		const urls = captureRequests();
		await leadAuditGet('/api/reports/lead-audit', {
			actor: '',
			owner: undefined,
			undated: false,
			page: 0,
			limit: null,
		});
		expect(urls[0]).toBe('/api/reports/lead-audit?undated=false&page=0');
	});

	it('does not append a query for an empty parameter set', async () => {
		const urls = captureRequests();
		await leadAuditGet('/api/reports/lead-audit');
		expect(urls[0]).toBe('/api/reports/lead-audit');
	});
});
