import { describe, it, expect } from 'vitest';
import {
	lineItemTotalRs,
	renderCashVoucherPrintDocument,
	type CashVoucherPrintInput,
} from '@/lib/cash-voucher-print';

function makeInput(
	overrides: Partial<CashVoucherPrintInput> = {}
): CashVoucherPrintInput {
	return {
		voucher: {
			voucher_number: 'CV-0042',
			voucher_date: '2026-10-15',
			paid_to: 'Ravi Sharma',
			project_number: 'PRJ-7',
			payment_mode: 'cash',
			total_amount: '1500.50',
			amount_in_words: 'One Thousand Five Hundred Rupees and Fifty Paise Only',
			prepared_by: 'Meera',
			checked_by: 'Arjun',
			approved_by_name: 'Kavita',
			receiver_signature: 'Ravi',
		},
		lineItems: [
			{
				sr_no: 1,
				bill_date: '2026-10-14',
				bill_no: 'B-1',
				account_head: 'Travel',
				amount_rs: '1000',
				amount_ps: '25',
				description: 'Taxi fares',
			},
		],
		logoSrc: 'data:image/png;base64,iVBORw0KGgo=',
		...overrides,
	};
}

/** Text visible in the document: strip tags but keep escaped entities decoded. */
function visibleText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#039;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ');
}

describe('lineItemTotalRs', () => {
	it('adds paise to rupees', () => {
		expect(lineItemTotalRs('1000', '25')).toBe(1000.25);
	});

	it('handles zero rupees with paise only', () => {
		expect(lineItemTotalRs(0, 5)).toBe(0.05);
	});

	it('treats missing parts as zero', () => {
		expect(lineItemTotalRs('', '')).toBe(0);
		expect(lineItemTotalRs('250', '')).toBe(250);
		expect(lineItemTotalRs(null, undefined)).toBe(0);
	});

	it('ignores non-numeric input instead of producing NaN', () => {
		expect(lineItemTotalRs('abc', 'xyz')).toBe(0);
	});
});

describe('renderCashVoucherPrintDocument', () => {
	it('shows the per-line rupees + paise total', () => {
		const html = renderCashVoucherPrintDocument(makeInput());
		expect(visibleText(html)).toContain('1,000.25');
	});

	it('shows the stored total verbatim, not the sum of lines', () => {
		const html = renderCashVoucherPrintDocument(
			makeInput({
				voucher: {
					voucher_number: 'CV-0099',
					total_amount: '999999.99',
					amount_in_words: 'Stored words win',
				},
				lineItems: [
					{ sr_no: 1, amount_rs: '1', amount_ps: '0', description: 'Tiny' },
				],
			})
		);
		const text = visibleText(html);
		expect(text).toContain('9,99,999.99');
		expect(text).toContain('Stored words win');
		expect(text).toContain('1.00');
	});

	it('escapes a malicious payee and description so they create no tags', () => {
		const html = renderCashVoucherPrintDocument(
			makeInput({
				voucher: {
					voucher_number: 'CV-0001',
					total_amount: '10',
					paid_to: '<img src=x onerror=alert(1)>',
				},
				lineItems: [
					{
						sr_no: 1,
						amount_rs: '10',
						amount_ps: '0',
						description: '<script>alert("pwn")</script>',
					},
				],
			})
		);
		expect(html).not.toContain('<img src=x');
		expect(html).not.toContain('<script>alert');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).toContain('&lt;script&gt;');
		const text = visibleText(html);
		expect(text).toContain('<img src=x onerror=alert(1)>');
		expect(text).toContain('<script>alert("pwn")</script>');
	});

	it('escapes the voucher number in both title and body', () => {
		const html = renderCashVoucherPrintDocument(
			makeInput({
				voucher: {
					voucher_number: 'CV-1"><script>alert(1)</script>',
					total_amount: '5',
				},
				lineItems: [],
			})
		);
		expect(html).not.toContain('"><script>alert(1)</script>');
		expect(visibleText(html)).toContain('CV-1"><script>alert(1)</script>');
	});

	it('retains all entries of a long voucher', () => {
		const lineItems = Array.from({ length: 45 }, (_, i) => ({
			sr_no: i + 1,
			bill_no: `LONG-BILL-${String(i + 1).padStart(3, '0')}`,
			amount_rs: String(10 + i),
			amount_ps: '0',
			description: `Long voucher entry ${i + 1} of 45`,
		}));
		const html = renderCashVoucherPrintDocument(makeInput({ lineItems }));
		const text = visibleText(html);
		for (let i = 1; i <= 45; i++) {
			expect(text).toContain(`Long voucher entry ${i} of 45`);
			expect(text).toContain(`LONG-BILL-${String(i).padStart(3, '0')}`);
		}
	});

	it('renders an empty-lines state with the total and signatures intact', () => {
		const html = renderCashVoucherPrintDocument(
			makeInput({
				voucher: {
					voucher_number: 'CV-0000',
					total_amount: '250.75',
					amount_in_words:
						'Two Hundred Fifty Rupees and Seventy Five Paise Only',
					prepared_by: 'Prep',
					checked_by: 'Check',
					approved_by_name: 'Approve',
					receiver_signature: 'Receive',
				},
				lineItems: [],
			})
		);
		const text = visibleText(html);
		expect(text).toContain('No line items on this voucher.');
		expect(text).toContain('250.75');
		for (const slot of ['Prep', 'Check', 'Approve', 'Receive']) {
			expect(text).toContain(slot);
		}
		for (const caption of [
			'Prepared by',
			'Checked by',
			'Approved by',
			"Receiver's signature",
		]) {
			expect(text).toContain(caption);
		}
	});

	it('renders a text mark when the logo file is missing', () => {
		const html = renderCashVoucherPrintDocument(makeInput({ logoSrc: null }));
		expect(html).not.toContain('<img');
		expect(visibleText(html)).toContain('Accent');
	});
});
