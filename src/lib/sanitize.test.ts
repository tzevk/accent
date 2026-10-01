import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeRichText } from '@/lib/sanitize';

/**
 * Bypass corpus (ADR-0012). Enumerated BEFORE the sanitizer implementation:
 * every payload below is a way the regex denylist or a naive allowlist fails.
 * Both engines (DOMPurify in jsdom via sanitizeHtml, sanitize-html via
 * sanitizeRichText) must agree on the shared allowlist.
 */
const BYPASS_PAYLOADS: Array<[name: string, html: string]> = [
	['slash-delimited event handler (audit H1)', '<svg/onload=alert(1)>'],
	['img onerror', '<img src=x onerror=alert(1)>'],
	['script tag', '<p>hi</p><script>alert(1)</script>'],
	['javascript: href', '<a href="javascript:alert(1)">click</a>'],
	['mixed-case javascript: href', '<a href="JaVaScRiPt:alert(1)">click</a>'],
	[
		'entity-encoded javascript: href',
		'<a href="java&#115;cript:alert(1)">click</a>',
	],
	[
		'data:text/html href',
		'<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
	],
	['iframe', '<iframe src="https://evil.example"></iframe>'],
	['object', '<object data="https://evil.example"></object>'],
	['embed', '<embed src="https://evil.example">'],
	['svg script', '<svg><script>alert(1)</script></svg>'],
	[
		'math mtext mXSS',
		'<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
	],
	['srcdoc attribute', '<p srcdoc="<script>alert(1)</script>">text</p>'],
	[
		'formaction button',
		'<form><button formaction="javascript:alert(1)">go</button></form>',
	],
	[
		'onclick on allowed anchor',
		'<a href="https://example.com" onclick="alert(1)">ok</a>',
	],
	['style block', '<style>@import url("https://evil.example/x.css");</style>'],
	['onmouseover quoted', '<p onmouseover="alert(1)">hover</p>'],
];

const DANGEROUS_FRAGMENTS = [
	'<script',
	'<iframe',
	'<object',
	'<embed',
	'<svg',
	'<math',
	'javascript:',
	'data:text/html',
	'onerror',
	'onload',
	'onclick',
	'onmouseover',
	'srcdoc',
	'formaction',
	'@import',
];

/** Assert one engine strips every dangerous fragment from a payload. */
function assertPayloadStripped(
	engine: (html: string) => string,
	name: string,
	payload: string
) {
	const out = engine(payload).toLowerCase().replace(/\s+/g, ' ');
	for (const fragment of DANGEROUS_FRAGMENTS) {
		expect(out, `${name} leaked ${fragment}`).not.toContain(fragment);
	}
}

describe('sanitizer bypass corpus — both engines, shared allowlist', () => {
	for (const [name, payload] of BYPASS_PAYLOADS) {
		it(`sanitizeHtml strips: ${name}`, () => {
			assertPayloadStripped(sanitizeHtml, name, payload);
		});

		it(`sanitizeRichText strips: ${name}`, () => {
			assertPayloadStripped(sanitizeRichText, name, payload);
		});
	}

	it('both engines keep legitimate TipTap output', () => {
		const html = [
			'<h1>Title</h1>',
			'<h2>Sub</h2>',
			'<h3>Sub sub</h3>',
			'<p>Para <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s></p>',
			'<ul><li>one</li><li>two</li></ul>',
			'<ol><li>first</li></ol>',
			'<blockquote>quote</blockquote>',
			'<pre><code>const x = 1 < 2;</code></pre>',
			'<hr>',
			'<p><a href="https://example.com/doc" title="doc" target="_blank" rel="noopener">link</a></p>',
		].join('');
		for (const engine of [sanitizeHtml, sanitizeRichText]) {
			const out = engine(html);
			expect(out).toContain('<h1>Title</h1>');
			expect(out).toContain('<h2>Sub</h2>');
			expect(out).toContain('<h3>Sub sub</h3>');
			expect(out).toContain('<strong>bold</strong>');
			expect(out).toContain('<em>italic</em>');
			expect(out).toContain('<li>one</li>');
			expect(out).toContain('<blockquote>quote</blockquote>');
			expect(out).toContain('<code>');
			expect(out).toContain('<hr');
			expect(out).toContain('href="https://example.com/doc"');
		}
	});

	it('keeps text content of disallowed wrapper tags', () => {
		for (const engine of [sanitizeHtml, sanitizeRichText]) {
			const out = engine('<div><p>kept</p></div><span>also kept</span>');
			expect(out).toContain('kept');
			expect(out).toContain('also kept');
			expect(out).not.toContain('<div');
			expect(out).not.toContain('<span');
		}
	});

	it('drops remote image sources (no img in the allowlist)', () => {
		for (const engine of [sanitizeHtml, sanitizeRichText]) {
			const out = engine('<img src="https://evil.example/x.png">');
			expect(out).not.toContain('<img');
		}
	});

	it('sanitizeRichText returns empty string for falsy input', () => {
		expect(sanitizeRichText('')).toBe('');
		expect(sanitizeRichText(null as unknown as string)).toBe('');
	});
});

describe('sanitizeHtml — P0.1 XSS', () => {
	it('strips <script>', () => {
		expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).not.toContain(
			'<script>'
		);
		expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toContain(
			'<p>hi</p>'
		);
	});

	it('strips event handlers', () => {
		const out = sanitizeHtml('<img src=x onerror=alert(1)><p>ok</p>');
		expect(out).not.toContain('onerror');
		expect(out).toContain('<p>ok</p>');
	});

	it('strips javascript: urls', () => {
		const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
		expect(out).not.toContain('javascript:');
	});

	it('preserves TipTap formatting', () => {
		const html =
			'<h1>Title</h1><p>Para</p><ul><li>one</li></ul><blockquote>quote</blockquote><strong>b</strong>';
		const out = sanitizeHtml(html);
		expect(out).toContain('<h1>Title</h1>');
		expect(out).toContain('<li>one</li>');
	});

	it('returns empty for falsy', () => {
		expect(sanitizeHtml('')).toBe('');
		expect(sanitizeHtml(null as unknown as string)).toBe('');
	});
});
