/**
 * Fetch a file endpoint and save the response body under `filename`.
 * Throws with the API's `error` message when the response is not ok, so
 * callers can surface it in their own error state.
 */
export async function downloadFile(url, filename) {
	const res = await fetch(url);

	if (!res.ok) {
		let message = 'Export failed';
		try {
			const data = await res.json();
			message = data.error || message;
		} catch {
			// Non-JSON error body — keep the generic message.
		}
		throw new Error(message);
	}

	const blob = await res.blob();
	const objectUrl = window.URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = objectUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	window.URL.revokeObjectURL(objectUrl);
}
