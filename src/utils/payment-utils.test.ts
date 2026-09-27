import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateInvoicePaymentStatus } from '@/utils/payment-utils';

/** Helper: create a mock db.execute that returns different results per call. */
function mockDb(returns: Array<[unknown[], unknown[]]>) {
	let call = 0;
	const execute = vi.fn().mockImplementation(() => {
		const r = returns[call]!;
		call++;
		return Promise.resolve(r);
	});
	return { execute, callCount: () => call } as unknown as {
		execute: ReturnType<typeof vi.fn>;
	};
}

describe('updateInvoicePaymentStatus', () => {
	let db: ReturnType<typeof mockDb>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does nothing when invoiceNo is empty', async () => {
		db = mockDb([]);
		await updateInvoicePaymentStatus(db as never, '');
		expect(db.execute).not.toHaveBeenCalled();
	});

	it('does nothing when invoiceNo is null-ish', async () => {
		db = mockDb([]);
		await updateInvoicePaymentStatus(db as never, null as unknown as string);
		expect(db.execute).not.toHaveBeenCalled();
	});

	it('sets fully_paid when totalPaid >= netAmount > 0', async () => {
		db = mockDb([
			[[{ total_paid: 5000 }], []], // first query: payment_entries
			[[{ net_amount: 5000 }], []], // second query: invoices
			[[], []], // third query: UPDATE
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		expect(db.execute).toHaveBeenCalledTimes(3);
		// Third call should be the UPDATE
		const updateCall = db.execute.mock.calls[2]!;
		expect(updateCall[0]).toContain('UPDATE invoices SET status = ?');
		expect(updateCall[1]).toEqual(['fully_paid', 'INV-001']);
	});

	it('sets fully_paid when totalPaid exceeds netAmount (overpayment)', async () => {
		db = mockDb([
			[[{ total_paid: 6000 }], []],
			[[{ net_amount: 5000 }], []],
			[[], []],
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		const updateCall = db.execute.mock.calls[2]!;
		expect(updateCall[1]).toEqual(['fully_paid', 'INV-001']);
	});

	it('sets partially_paid when 0 < totalPaid < netAmount', async () => {
		db = mockDb([
			[[{ total_paid: 3000 }], []],
			[[{ net_amount: 5000 }], []],
			[[], []],
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		const updateCall = db.execute.mock.calls[2]!;
		expect(updateCall[1]).toEqual(['partially_paid', 'INV-001']);
	});

	it('does not update when totalPaid = 0', async () => {
		db = mockDb([
			[[{ total_paid: 0 }], []],
			[[{ net_amount: 5000 }], []],
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		// Only 2 calls: SELECT payment_entries, SELECT invoices
		expect(db.execute).toHaveBeenCalledTimes(2);
	});

	it('sets partially_paid when netAmount = 0 but totalPaid > 0', async () => {
		// gt(0, 0) → false, but totalPaid > 0 → partially_paid
		db = mockDb([
			[[{ total_paid: 100 }], []],
			[[{ net_amount: 0 }], []],
			[[], []],
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		expect(db.execute).toHaveBeenCalledTimes(3);
		const updateCall = db.execute.mock.calls[2]!;
		expect(updateCall[1]).toEqual(['partially_paid', 'INV-001']);
	});

	it('returns without updating when invoice not found', async () => {
		db = mockDb([
			[[{ total_paid: 100 }], []],
			[[], []], // invoices query returns empty
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		expect(db.execute).toHaveBeenCalledTimes(2);
	});

	it('handles string amounts from DB (mysql2 DECIMAL columns)', async () => {
		db = mockDb([
			[[{ total_paid: '12000.50' }], []],
			[[{ net_amount: '12000.50' }], []],
			[[], []],
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		const updateCall = db.execute.mock.calls[2]!;
		expect(updateCall[1]).toEqual(['fully_paid', 'INV-001']);
	});

	it('avoids float comparison edge case (e.g. 120.18)', async () => {
		// total_paid might be 120.18000000000002 from float sum,
		// net_amount is 120.18 — gte should still work
		db = mockDb([
			[[{ total_paid: 120.18 }], []],
			[[{ net_amount: 120.18 }], []],
			[[], []],
		]);

		await updateInvoicePaymentStatus(db as never, 'INV-001');

		const updateCall = db.execute.mock.calls[2]!;
		expect(updateCall[1]).toEqual(['fully_paid', 'INV-001']);
	});
});
