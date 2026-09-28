/**
 * Upload validation helpers (plan workstream C: content, not headers).
 *
 * Upload gates in this repo used to trust the browser-declared MIME type
 * (`file.type`) and/or the filename extension. Both are attacker-controlled:
 * `payload.html` can declare `text/plain`, and `payload.txt` can declare
 * `text/html`. These helpers let a route reject markup by looking at the bytes
 * themselves, and cap oversized base64 bodies before they are decoded.
 *
 * Sniffing is intentionally shallow — a leading-prologue check, not a format
 * parser. It answers one question: "is this payload actually HTML/SVG/script
 * markup dressed up as a document or image?"
 */

/** Bytes inspected at the start of a payload. */
const SNIFF_BYTES = 2048;

/**
 * Leading prologues of a markup document. Matched case-insensitively against
 * the normalised head of the payload; a legitimate PDF (`%PDF`), Office/OLE
 * (`D0 CF 11 E0`), zip-container (`PK`) or raster image (`\x89PNG`, `GIF8`,
 * `\xFF\xD8`) prologue never matches any of them.
 */
const MARKUP_PROLOGUES = [
	'<!doctype html',
	'<!doctype svg',
	'<html',
	'<head',
	'<body',
	'<script',
	'<svg',
	'<iframe',
	'<object',
	'<embed',
	'<style',
	'<!--', // HTML comment — hides markup from a naive leading-tag check
];

/**
 * Markers that may follow an XML declaration (`<?xml …?>`). The declaration
 * itself is legitimate for some XML documents, but an SVG or XHTML root after
 * it means the payload is markup.
 */
const XML_MARKUP_MARKERS = [
	'<svg',
	'<html',
	'<script',
	'<!doctype html',
	'<!doctype svg',
];

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — parity with src/utils/document-helpers.js

/**
 * Largest JSON upload body that can still decode to `MAX_FILE_SIZE`: base64
 * expands 3 bytes to 4 characters, plus the `{"filename":…,"b64":…}` envelope.
 * Used to reject on the declared `Content-Length` before the body is parsed.
 */
export const MAX_REQUEST_BYTES = Math.ceil(MAX_FILE_SIZE / 3) * 4 + 4096;

/** Shared rejection reason for uploads whose bytes are markup. */
export const MARKUP_REJECTION_ERROR =
	'File content is HTML, SVG or script markup, which is not allowed';

/**
 * Normalise the start of a payload into a lower-cased ASCII head for
 * comparison: skips a UTF-8/UTF-16 BOM, drops NUL bytes (so UTF-16 encoded
 * markup such as `<\0h\0t\0m\0l` still reads as `<html`), then skips leading
 * whitespace and control bytes.
 *
 * @param {Buffer} buffer raw upload bytes
 * @returns {string} normalised head, or '' when there is nothing to inspect
 */
function sniffHead(buffer) {
	if (buffer.length === 0) return '';

	let offset = 0;
	if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		offset = 3; // UTF-8 BOM
	} else if (
		(buffer[0] === 0xff && buffer[1] === 0xfe) ||
		(buffer[0] === 0xfe && buffer[1] === 0xff)
	) {
		offset = 2; // UTF-16 BOM (LE/BE)
	}

	return buffer
		.subarray(offset, offset + SNIFF_BYTES)
		.toString('latin1')
		.replace(/\0/g, '')
		.replace(/^[\s\u0000-\u001f\u007f]+/, '')
		.toLowerCase();
}

/**
 * Whether an upload payload is HTML, SVG or script markup, regardless of the
 * MIME type or extension it declares.
 *
 * @param {Buffer} buffer raw upload bytes
 * @returns {boolean} true when the payload must not be stored
 */
export function hasMarkupSignature(buffer) {
	if (!Buffer.isBuffer(buffer)) return false;

	const head = sniffHead(buffer);
	if (!head) return false;

	if (head.startsWith('<?xml')) {
		// An XML declaration may be padded before the root element, so scan the
		// whole payload instead of just the sniff window. None of the upload
		// formats is XML, so the wider scan can only over-reject.
		const full = buffer.toString('latin1').replace(/\0/g, '').toLowerCase();
		return XML_MARKUP_MARKERS.some((marker) => full.includes(marker));
	}

	return MARKUP_PROLOGUES.some((prologue) => head.startsWith(prologue));
}

/**
 * Decoded byte count of a base64 payload, computed from its length without
 * allocating the decoded buffer. Over-estimates when the string carries
 * whitespace or invalid characters, which is the safe direction for a cap.
 *
 * @param {string} value base64 (or data-URL) content
 * @returns {number} estimated decoded size in bytes
 */
export function estimateBase64DecodedBytes(value) {
	if (typeof value !== 'string' || value.length === 0) return 0;
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}
