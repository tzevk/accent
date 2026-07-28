'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	DocumentTextIcon,
	CheckCircleIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import ResourcePage from '@/components/admin/ResourcePage';
import type { FormField } from '@/types/admin';
import { Select } from '@/components/ui/form-fields';
import { formatCurrency } from '@/lib/format';
import { sub } from '@/lib/money';

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'full', label: 'Full' },
	{ value: 'part', label: 'Part' },
];

const STATUS_BADGE: Record<string, string> = {
	full: 'bg-emerald-100 text-emerald-700',
	part: 'bg-amber-100 text-amber-700',
};

const schema = z.object({
	payee_name: z.string().min(1, 'Client/Vendor name is required'),
	payee_type: z.enum(['company', 'vendor']).optional(),
	invoice_number: z.string().nullable().optional(),
	invoice_date: z.string().nullable().optional(),
	invoice_amount: z.coerce.number().min(0).optional(),
	amount: z.coerce.number().min(0).optional(),
	deduction: z.coerce.number().min(0).optional(),
	net_amount: z.coerce.number().min(0).optional(),
	issue_date: z.string().nullable().optional(),
	transaction_reference: z.string().nullable().optional(),
	bank_name: z.string().nullable().optional(),
	status: z.enum(['full', 'part']).optional(),
	notes: z.string().nullable().optional(),
});

const defaultValues = {
	payee_name: '',
	payee_type: 'company',
	invoice_number: '',
	invoice_date: '',
	invoice_amount: '',
	amount: '',
	deduction: '',
	net_amount: '',
	issue_date: '',
	transaction_reference: '',
	bank_name: '',
	status: 'full',
	notes: '',
};

const invoiceLabelFn = (item: Record<string, unknown>) => {
	const inv = item.invoice_number || '';
	const client = item.client_name || '';
	const net = formatCurrency(item.net_amount as number);
	const gst = formatCurrency(item.tax_amount as number);
	const total = formatCurrency(item.gross_amount as number);
	return `${inv} — ${client} | Net: ${net} | GST: ${gst} | Total: ${total}`;
};

const payeeLabelFn = (item: Record<string, unknown>) => {
	const name = item.name || '';
	const type = item.type === 'vendor' ? '[Vendor]' : '[Company]';
	const city = item.city || '';
	return `${name} ${type}${city ? ` — ${city}` : ''}`;
};

const bankLabelFn = (item: Record<string, unknown>) => {
	const bankName = item.BankName || item.bank_name || '';
	const accountNo = item.AccountNumber || item.account_no || '';
	return accountNo ? `${bankName} (${accountNo})` : String(bankName);
};

const formFields: FormField[] = [
	{
		name: 'payee_name',
		label: 'Client / Vendor Name',
		type: 'searchableSelect' as const,
		searchableEndpoint: '/api/admin/payee-list',
		searchableValueKey: 'name',
		searchableLabelFn: payeeLabelFn,
		searchableFillFields: { name: 'payee_name', type: 'payee_type' },
	},
	{
		name: 'invoice_number',
		label: 'Invoice Number',
		type: 'searchableSelect' as const,
		searchableEndpoint: '/api/admin/invoice-list',
		searchableValueKey: 'invoice_number',
		searchableLabelFn: invoiceLabelFn,
		searchableFillFields: {
			invoice_date: 'invoice_date',
			gross_amount: 'invoice_amount',
		},
		searchableDependency: { field: 'payee_name', itemKey: 'client_name' },
	},
	{
		name: 'invoice_date',
		label: 'Invoice Date',
		type: 'date' as const,
		disabled: true,
	},
	{
		name: 'invoice_amount',
		label: 'Invoice Amount',
		type: 'number' as const,
		step: '0.01',
		disabled: true,
	},
	{
		name: 'amount',
		label: 'Amount (Invoice Amount)',
		type: 'number' as const,
		step: '0.01',
		required: true,
	},
	{
		name: 'deduction',
		label: 'Deduction',
		type: 'number' as const,
		step: '0.01',
	},
	{
		name: 'net_amount',
		label: 'Net Amount (Invoice Amount - Deduction)',
		type: 'number' as const,
		step: '0.01',
		computed: {
			dependsOn: ['amount', 'deduction'],
			calculate: (values: Record<string, unknown>) =>
				sub(values.amount || 0, values.deduction || 0).toNumber(),
		},
	},
	{ name: 'issue_date', label: 'Issue Date', type: 'date' as const },
	{ name: 'transaction_reference', label: 'Transaction Ref' },
	{
		name: 'bank_name',
		label: 'Bank Name',
		type: 'searchableSelect' as const,
		searchableEndpoint: '/api/masters/banks',
		searchableValueKey: 'BankName',
		searchableLabelFn: bankLabelFn,
	},
	{
		name: 'status',
		label: 'Status',
		type: 'select' as const,
		options: [
			{ value: 'full', label: 'Full' },
			{ value: 'part', label: 'Part' },
		],
	},
	{
		name: 'notes',
		label: 'Notes',
		type: 'textarea' as const,
		fullWidth: true,
	},
];

const columns = [
	{ key: 'payee_name', label: 'Client / Vendor' },
	{ key: 'invoice_number', label: 'Invoice #', headClassName: 'w-32' },
	{
		key: 'invoice_amount',
		label: 'Invoice Amt',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right',
	},
	{
		key: 'amount',
		label: 'Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'deduction',
		label: 'Deduction',
		money: true,
		headClassName: 'w-28 text-right',
		cellClassName: 'text-right',
	},
	{
		key: 'net_amount',
		label: 'Net Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'issue_date',
		label: 'Issue Date',
		date: true,
		headClassName: 'w-28',
	},
	{
		key: 'transaction_reference',
		label: 'Transaction Ref',
		headClassName: 'w-36',
	},
	{ key: 'bank_name', label: 'Bank', headClassName: 'w-32' },
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-24',
		render: (row: Record<string, unknown>) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[row.status as string] || 'bg-slate-100 text-slate-500'}`}
			>
				{row.status === 'full' ? 'Full' : 'Part'}
			</span>
		),
	},
];

const statsConfig = [
	{
		key: 'total',
		label: 'Total',
		tone: 'purple' as const,
		icon: DocumentTextIcon,
	},
	{
		key: 'full',
		label: 'Full',
		tone: 'green' as const,
		icon: CheckCircleIcon,
	},
	{
		key: 'part',
		label: 'Part',
		tone: 'amber' as const,
		icon: ExclamationCircleIcon,
	},
	{
		key: 'totalAmount',
		label: 'Total Amount',
		tone: 'purple' as const,
		money: true,
	},
];

export default function PaymentIssuePage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Payment Issued to client"
			subtitle="Payments issued to clients"
			endpoint="/api/admin/payment-issues"
			queryKey={['payment-issues']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			searchPlaceholder="Search by payee, invoice, transaction ref, bank…"
			extraFilters={{
				values: { status: statusFilter },
				node: (
					<Select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="w-32"
					>
						{STATUS_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</Select>
				),
			}}
		/>
	);
}
