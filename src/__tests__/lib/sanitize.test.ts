import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitize';

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
