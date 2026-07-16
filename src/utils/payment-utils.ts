import type { PoolConnection } from 'mysql2/promise';

export async function updateInvoicePaymentStatus(
	db: PoolConnection,
	invoiceNo: string
): Promise<void> {
	if (!invoiceNo) return;

	const [rows] = await db.execute(
		`SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment_entries
     WHERE invoice_no = ? AND isDelete = 0`,
		[invoiceNo]
	);
	const totalPaid =
		parseFloat((rows as Array<{ total_paid: number }>)[0].total_paid) || 0;

	const [invoices] = await db.execute(
		`SELECT net_amount FROM invoices WHERE invoice_number = ? AND isDelete = 0`,
		[invoiceNo]
	);
	const invoiceRows = invoices as Array<{ net_amount: number }>;
	if (invoiceRows.length === 0) return;

	const netAmount = parseFloat(String(invoiceRows[0].net_amount)) || 0;

	let newStatus: string | null = null;
	if (netAmount > 0 && totalPaid >= netAmount) {
		newStatus = 'fully_paid';
	} else if (totalPaid > 0) {
		newStatus = 'partially_paid';
	}

	if (newStatus) {
		await db.execute(
			`UPDATE invoices SET status = ? WHERE invoice_number = ? AND isDelete = 0`,
			[newStatus, invoiceNo]
		);
	}
}
