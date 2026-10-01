/**
 * Shared rich-text allowlist (ADR-0012).
 *
 * One source of truth for both sanitizer engines:
 *  - server (write paths + prerender): `sanitize-html` via SERVER_SANITIZE_OPTIONS
 *  - browser (render safety net): DOMPurify via CLIENT_SANITIZE_CONFIG
 *
 * No events, no style, no srcdoc/formaction, no iframe/object/math/svg, no
 * images. Links may only point at http(s)/mailto. A future sink imports this
 * module instead of inventing another filter; bypass parity is asserted in
 * `sanitize.test.ts` (see BYPASS_PAYLOADS).
 */

export const ALLOWED_TAGS = [
	'p',
	'br',
	'strong',
	'b',
	'em',
	'i',
	'u',
	's',
	'strike',
	'h1',
	'h2',
	'h3',
	'blockquote',
	'ul',
	'ol',
	'li',
	'code',
	'pre',
	'hr',
	'a',
];

export const ALLOWED_LINK_ATTRIBUTES = ['href', 'title', 'target', 'rel'];

export const ALLOWED_LINK_SCHEMES = ['http', 'https', 'mailto'];

export const SERVER_SANITIZE_OPTIONS = {
	allowedTags: ALLOWED_TAGS,
	allowedAttributes: { a: ALLOWED_LINK_ATTRIBUTES },
	allowedSchemes: ALLOWED_LINK_SCHEMES,
	// `//evil.example` (protocol-relative) is not a scheme and must not pass.
	allowProtocolRelative: false,
	disallowedTagsMode: 'discard',
};

export const CLIENT_SANITIZE_CONFIG = {
	ALLOWED_TAGS,
	ALLOWED_ATTR: ALLOWED_LINK_ATTRIBUTES,
	ALLOW_DATA_ATTR: false,
	ALLOW_ARIA_ATTR: false,
	// Mirrors ALLOWED_LINK_SCHEMES; anything else (javascript:, data:, vbscript:)
	// is removed from href.
	ALLOWED_URI_REGEXP:
		/^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};
