import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Paced wrappers over the Playwright `request` fixture.
 *
 * The proxy's in-memory `api` guard (ADR-0013: 120 requests per minute per
 * trusted-IP + validated-session identity) counts every request a spec issues
 * under one identity — its browser page loads included. A spec that crosses
 * the budget gets a `429` carrying `Retry-After`, which would otherwise
 * hard-fail an otherwise correct assertion. Wait out exactly the window the
 * guard names and retry; any other status returns at once, so business
 * refusals (403/409/422) still assert strictly. The limits stay as they are —
 * the spec paces itself instead.
 *
 * A 429 is produced by the proxy before routing, so no handler ran and no
 * write was applied: retrying cannot double-apply a command.
 *
 * `headers` lets a spec give its direct API traffic a second trusted identity
 * (ADR-0013's trusted header) so the browser pages and the API context do not
 * spend one shared budget — see `supplier-invoice-recognition.spec.ts`.
 */

/** Upper bound on one retry wait, so a bogus header cannot stall a spec. */
const MAX_RETRY_WAIT_MS = 65_000;

/**
 * `Retry-After` seconds, bounded. A missing or absurd header falls back to a
 * short wait rather than freezing the spec on its own timeout.
 */
function retryAfterMs(response: APIResponse): number {
	const seconds = Number(response.headers()['retry-after']);
	if (!Number.isFinite(seconds) || seconds <= 0) return 1_000;
	return Math.min(seconds * 1_000, MAX_RETRY_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/** Resend until the guard stops naming a 429, then return the last response. */
async function paced(
	send: () => Promise<APIResponse>,
	retries = 2
): Promise<APIResponse> {
	let response = await send();
	for (
		let attempt = 0;
		response.status() === 429 && attempt < retries;
		attempt += 1
	) {
		await sleep(retryAfterMs(response));
		response = await send();
	}
	return response;
}

export function apiGet(
	request: APIRequestContext,
	url: string,
	headers?: Record<string, string>
): Promise<APIResponse> {
	return paced(() => request.get(url, { headers }));
}

export function apiPost(
	request: APIRequestContext,
	url: string,
	data: Record<string, unknown>,
	headers?: Record<string, string>
): Promise<APIResponse> {
	return paced(() => request.post(url, { data, headers }));
}

export function apiPut(
	request: APIRequestContext,
	url: string,
	data: Record<string, unknown>,
	headers?: Record<string, string>
): Promise<APIResponse> {
	return paced(() => request.put(url, { data, headers }));
}

export function apiDelete(
	request: APIRequestContext,
	url: string,
	headers?: Record<string, string>
): Promise<APIResponse> {
	return paced(() => request.delete(url, { headers }));
}
