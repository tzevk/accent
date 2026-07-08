'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	ArrowDownCircleIcon,
	DocumentTextIcon,
	ClockIcon,
	CheckCircleIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import ResourcePage from '@/components/admin/ResourcePage';
import { Select } from '@/components/ui/form-fields';

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'partial', label: 'Partial' },
	{ value: 'received', label: 'Received' },
	{ value: 'overdue', label: 'Overdue' },
	{ value: 'written_off', label: 'Written Off' },
];

const STATUS_BADGE = {
	pending: 'bg-amber-100 text-amber-700',
	partial: 'bg-sky-100 text-sky-700',
	received: 'bg-emerald-100 text-emerald-700',
	overdue: 'bg-rose-100 text-rose-700',
	written_off: 'bg-slate-100 text-slate-500',
};

const PAYMENT_MODES = [
	{ value: '', label: 'Select mode…' },
	{ value: 'cash', label: 'Cash' },
	{ value: 'bank', label: 'Bank Transfer' },
	{ value: 'cheque', label: 'Cheque' },
	{ value: 'card', label: 'Card' },
	{ value: 'upi', label: 'UPI' },
	{ value: 'other', label: 'Other' },
];

const schema = z.object({
	reference_number: z.string().nullable().optional(),
	invoice_number: z.string().nullable().optional(),
	client_name: z.string().min(1, 'Client name is required'),
	client_email: z
		.string()
		.email('Invalid email')
		.nullable()
		.optional()
		.or(z.literal('')),
	client_phone: z.string().nullable().optional(),
	invoice_date: z.string().nullable().optional(),
	due_date: z.string().nullable().optional(),
	invoice_amount: z.coerce.number().min(0).optional(),
	paid_amount: z.coerce.number().min(0).optional(),
	balance_due: z.coerce.number().optional(),
	currency: z.string().nullable().optional(),
	po_number: z.string().nullable().optional(),
	payment_terms: z.string().nullable().optional(),
	last_follow_up_date: z.string().nullable().optional(),
	next_follow_up_date: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	status: z
		.enum(['pending', 'partial', 'received', 'overdue', 'written_off'])
		.optional(),
	received_date: z.string().nullable().optional(),
	payment_mode: z
		.enum(['cash', 'bank', 'cheque', 'card', 'upi', 'other', ''])
		.optional(),
	transaction_reference: z.string().nullable().optional(),
});

const defaultValues = {
	reference_number: '',
	invoice_number: '',
	client_name: '',
	client_email: '',
	client_phone: '',
	invoice_date: '',
	due_date: '',
	invoice_amount: '',
	paid_amount: '',
	balance_due: '',
	currency: 'INR',
	po_number: '',
	payment_terms: '',
	last_follow_up_date: '',
	next_follow_up_date: '',
	notes: '',
	status: 'pending',
	received_date: '',
	payment_mode: '',
	transaction_reference: '',
};

const formFields = [
	{
		name: 'reference_number',
		label: 'Reference #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'invoice_number', label: 'Invoice #' },
	{ name: 'client_name', label: 'Client Name', required: true },
	{ name: 'client_email', label: 'Client Email', type: 'email' },
	{ name: 'client_phone', label: 'Client Phone' },
	{ name: 'invoice_date', label: 'Invoice Date', type: 'date' },
	{ name: 'due_date', label: 'Due Date', type: 'date' },
	{
		name: 'invoice_amount',
		label: 'Invoice Amount',
		type: 'number',
		step: '0.01',
	},
	{ name: 'paid_amount', label: 'Paid Amount', type: 'number', step: '0.01' },
	{ name: 'balance_due', label: 'Balance Due', type: 'number', step: '0.01' },
	{ name: 'currency', label: 'Currency' },
	{ name: 'po_number', label: 'PO Number' },
	{ name: 'payment_terms', label: 'Payment Terms' },
	{ name: 'last_follow_up_date', label: 'Last Follow-up', type: 'date' },
	{ name: 'next_follow_up_date', label: 'Next Follow-up', type: 'date' },
	{ name: 'received_date', label: 'Received Date', type: 'date' },
	{
		name: 'payment_mode',
		label: 'Payment Mode',
		type: 'select',
		options: PAYMENT_MODES,
	},
	{ name: 'transaction_reference', label: 'Transaction Ref' },
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS.filter((o) => o.value !== 'all'),
	},
	{ name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
];

const columns = [
	{ key: 'reference_number', label: 'Ref #', headClassName: 'w-28' },
	{ key: 'invoice_number', label: 'Invoice', headClassName: 'w-28' },
	{ key: 'client_name', label: 'Client' },
	{
		key: 'invoice_date',
		label: 'Invoice Date',
		date: true,
		headClassName: 'w-28',
	},
	{ key: 'due_date', label: 'Due Date', date: true, headClassName: 'w-28' },
	{
		key: 'invoice_amount',
		label: 'Invoiced',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right',
	},
	{
		key: 'paid_amount',
		label: 'Received',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right text-emerald-700',
	},
	{
		key: 'balance_due',
		label: 'Balance',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-semibold text-rose-700',
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-28',
		render: (row) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[row.status] || STATUS_BADGE.pending}`}
			>
				{row.status || 'pending'}
			</span>
		),
	},
];

const statsConfig = [
	{ key: 'total', label: 'Total', tone: 'purple', icon: DocumentTextIcon },
	{ key: 'pending', label: 'Pending', tone: 'amber', icon: ClockIcon },
	{ key: 'partial', label: 'Partial', tone: 'sky', icon: ArrowDownCircleIcon },
	{ key: 'received', label: 'Received', tone: 'green', icon: CheckCircleIcon },
	{
		key: 'overdue',
		label: 'Overdue',
		tone: 'rose',
		icon: ExclamationCircleIcon,
	},
	{
		key: 'totalInvoiced',
		label: 'Total Invoiced',
		tone: 'purple',
		money: true,
	},
	{ key: 'totalReceived', label: 'Total Received', tone: 'green', money: true },
	{ key: 'totalOutstanding', label: 'Outstanding', tone: 'rose', money: true },
];

export default function PaymentReceivablePage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Payment Receivable"
			subtitle="Track amounts owed to the company by clients"
			endpoint="/api/admin/payment-receivables"
			queryKey={['payment-receivables']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			searchPlaceholder="Search by ref #, client, invoice, PO…"
			extraFilters={{
				values: { status: statusFilter },
				node: (
					<Select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="w-40"
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
