'use client';

import { z } from 'zod';
import { useState, useCallback } from 'react';
import { PrinterIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import ResourcePage from '@/components/admin/ResourcePage';
import { formatCurrency } from '@/lib/format';

const schema = z.object({
	company_name: z.string().min(1, 'Company name is required'),
	city: z.string().optional(),
	receipt_no: z.string().optional(),
	receipt_date: z.string().nullable().optional(),
	amount: z.coerce.number().min(0).optional(),
	payment_date: z.string().nullable().optional(),
	transaction_id: z.string().optional(),
	invoice_no: z.string().optional(),
	invoice_date: z.string().nullable().optional(),
});

const defaultValues = {
	company_name: '',
	city: '',
	receipt_no: '',
	receipt_date: '',
	amount: '',
	payment_date: '',
	transaction_id: '',
	invoice_no: '',
	invoice_date: '',
};

const invoiceLabelFn = (item: Record<string, unknown>) => {
	const inv = item.invoice_number || '';
	const client = item.client_name || '';
	const net = formatCurrency(item.net_amount as number);
	const gst = formatCurrency(item.tax_amount as number);
	const total = formatCurrency(item.gross_amount as number);
	return `${inv} — ${client} | Net: ${net} | GST: ${gst} | Total: ${total}`;
};

const formFields = [
	{
		name: 'company_name',
		label: 'Company Name',
		required: true,
		type: 'searchableSelect' as const,
		companyAutofill: true,
	},
	{ name: 'city', label: 'City' },
	{
		name: 'receipt_no',
		label: 'Receipt No',
		hint: 'Auto-generated if blank',
	},
	{ name: 'receipt_date', label: 'Receipt Date', type: 'date' as const },
	{
		name: 'amount',
		label: 'Amount',
		type: 'number' as const,
		step: '0.01',
		required: true,
	},
	{ name: 'payment_date', label: 'Payment Date', type: 'date' as const },
	{ name: 'transaction_id', label: 'Transaction ID' },
	{
		name: 'invoice_no',
		label: 'Invoice No',
		type: 'searchableSelect' as const,
		searchableEndpoint: '/api/admin/invoices?limit=500',
		searchableValueKey: 'invoice_number',
		searchableLabelFn: invoiceLabelFn,
		searchableFillFields: { invoice_date: 'invoice_date' },
	},
	{ name: 'invoice_date', label: 'Invoice Date', type: 'date' as const },
];

const columns = [
	{ key: 'company_name', label: 'Company Name' },
	{ key: 'receipt_no', label: 'Receipt No', headClassName: 'w-32' },
	{
		key: 'amount',
		label: 'Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{ key: 'transaction_id', label: 'Transaction ID', headClassName: 'w-40' },
	{ key: 'receipt_date', label: 'Date', date: true, headClassName: 'w-28' },
];

export default function PaymentEntryPage() {
	const [printingId, setPrintingId] = useState<string | null>(null);

	const handlePrint = useCallback(async (row: Record<string, unknown>) => {
		setPrintingId(row.id as string);
		try {
			const res = await fetch('/api/admin/payment-entries/get-receipt-pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receipt_no: row.receipt_no || '-',
					receipt_date: row.receipt_date || '-',
					company_name: row.company_name || '-',
					amount: Number(row.amount) || 0,
					transaction_id: row.transaction_id || '-',
					payment_date: row.payment_date || '-',
					bank_name: '',
					remark: '',
					invoice_no: row.invoice_no || '-',
					invoice_date: row.invoice_date || '-',
				}),
			});

			if (!res.ok) throw new Error('Failed to generate PDF');

			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Receipt_${row.receipt_no || 'Draft'}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);
		} catch {
			toast.error('Failed to download receipt');
		} finally {
			setPrintingId(null);
		}
	}, []);

	const rowActions = useCallback(
		(row: Record<string, unknown>) => {
			const isPrinting = printingId === (row.id as string);
			return (
				<button
					onClick={() => handlePrint(row)}
					disabled={isPrinting}
					className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
					title="Print Receipt"
				>
					{isPrinting ? (
						<ArrowPathIcon className="h-4 w-4 animate-spin" />
					) : (
						<PrinterIcon className="h-4 w-4" />
					)}
				</button>
			);
		},
		[handlePrint, printingId]
	);

	return (
		<ResourcePage
			title="Payment Received from client"
			subtitle="Payments received from client"
			endpoint="/api/admin/payment-entries"
			queryKey={['payment-entries']}
			columns={columns}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			searchPlaceholder="Search company, receipt, transaction…"
			companyListEndpoint="/api/companies"
			rowActions={rowActions}
		/>
	);
}
