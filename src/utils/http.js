// Shared HTTP helpers for safe JSON parsing and consistent error handling

export async function parseJSONSafe(response) {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    const text = await response.text();
    throw new Error(text?.slice(0, 300) || `HTTP ${response.status}`);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Received a non-JSON response from server');
    }
    throw e;
  }
}

export async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const data = await parseJSONSafe(res);
  if (!res.ok || data?.success === false) {
    const errMsg = data?.error || data?.message || `Request failed (${res.status})`;
    const details = data?.details;
    throw new Error(details ? `${errMsg}: ${details}` : errMsg);
  }
  return data;
}
