/**
 * Rich-text sanitizer with two engines over one allowlist (ADR-0012).
 *
 *  - `sanitizeHtml` — isomorphic render-time safety net for
 *    `dangerouslySetInnerHTML`. Uses DOMPurify in the browser (where a DOM
 *    exists) and `sanitize-html` during server prerender. Server bundle uses
 *    the Node engine only; no jsdom.
 *  - `sanitizeRichText` — server-side write-path sanitizer. Always
 *    `sanitize-html`; call this before INSERT/UPDATE of any HTML-bound column.
 *
 * The regex denylist this replaced let `<svg/onload=…>` through; the bypass
 * corpus lives in `sanitize.test.ts` and covers both engines.
 */
import sanitizeHtmlServer from 'sanitize-html';
import createDOMPurify from 'dompurify';
import {
	CLIENT_SANITIZE_CONFIG,
	SERVER_SANITIZE_OPTIONS,
} from './html-allowlist.js';

let purifier = null;

export function sanitizeHtml(dirty) {
	if (!dirty || typeof dirty !== 'string') return '';
	if (typeof window !== 'undefined' && window.document) {
		if (!purifier) purifier = createDOMPurify(window);
		return purifier.sanitize(dirty, CLIENT_SANITIZE_CONFIG);
	}
	return sanitizeHtmlServer(dirty, SERVER_SANITIZE_OPTIONS);
}

export function sanitizeRichText(value) {
	if (!value || typeof value !== 'string') return '';
	return sanitizeHtmlServer(value, SERVER_SANITIZE_OPTIONS);
}
