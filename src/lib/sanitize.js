/**
 * Lightweight HTML sanitizer for safe `dangerouslySetInnerHTML`.
 * Server-safe (no jsdom / filesystem) — avoids isomorphic-dompurify
 * `browser/default-stylesheet.css` ENOENT during Next.js prerender.
 *
 * On client we could use DOMPurify, but regex is sufficient for the
 * threat model (stored XSS from proposal scope / message bodies) and
 * keeps the server bundle lean. If you need richer sanitization later,
 * switch to `dompurify` behind a `typeof window !== 'undefined'` guard.
 */

export function sanitizeHtml(dirty) {
	if (!dirty || typeof dirty !== 'string') return '';
	let out = dirty;

	// Strip <script>…</script> and <style>…</style> entirely
	out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
	out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

	// Strip event handlers: onload=, onerror=, onclick=, etc. (quoted or unquoted)
	out = out.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, '');

	// Neutralize javascript: URLs in href/src/xlink:href/action/formaction
	out = out.replace(
		/\s(href|src|xlink:href|action|formaction)\s*=\s*("|')\s*javascript:[^"']*\2/gi,
		' $1="#"'
	);
	out = out.replace(
		/\s(href|src|xlink:href|action|formaction)\s*=\s*javascript:[^\s"'<>`]+/gi,
		' $1="#"'
	);

	// Strip data:text/html and vbscript: as well
	out = out.replace(
		/\s(href|src)\s*=\s*("|')\s*data:text\/html[^"']*\2/gi,
		' $1="#"'
	);

	return out;
}
