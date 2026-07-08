export function apiGet<T = unknown>(
	url: string,
	params?: Record<string, unknown>
): Promise<T>;
export function apiPost<T = unknown>(url: string, body?: unknown): Promise<T>;
export function apiPut<T = unknown>(url: string, body?: unknown): Promise<T>;
export function apiDelete<T = unknown>(url: string, body?: unknown): Promise<T>;
