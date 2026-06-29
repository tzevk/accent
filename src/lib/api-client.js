async function parseError(res) {
	let message = `Request failed (${res.status})`;
	try {
		const data = await res.json();
		message = data?.error || data?.message || message;
	} catch {}
	return message;
}

export async function apiGet(url, params) {
	let qs = '';
	if (params) {
		const usp = new URLSearchParams();
		Object.entries(params).forEach(([k, v]) => {
			if (v !== undefined && v !== null && v !== '' && v !== 'all') {
				usp.append(k, String(v));
			}
		});
		const s = usp.toString();
		if (s) qs = `?${s}`;
	}
	const res = await fetch(`${url}${qs}`, {
		credentials: 'include',
		headers: { 'Cache-Control': 'no-cache' },
	});
	if (!res.ok) {
		throw new Error(await parseError(res));
	}
	return res.json();
}

export async function apiSend(url, method, body) {
	const res = await fetch(url, {
		method,
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(await parseError(res));
	}
	return res.json();
}

export const apiPost = (url, body) => apiSend(url, 'POST', body);
export const apiPut = (url, body) => apiSend(url, 'PUT', body);
export const apiDelete = (url, body) => apiSend(url, 'DELETE', body);
