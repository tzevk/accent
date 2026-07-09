'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	ArrowUpCircleIcon,
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
	{ value: 'issued', label: 'Issued' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE = {
	pending: 'bg-amber-100 text-amber-700',
	issued: 'bg-emerald-100 text-emerald-700',
	cancelled: 'bg-slate-100 text-slate-500',
};

const schema = z.object({
	reference_number: z.string().nullable().optional(),
	payee_name: z.string().min(1, 'Payee name is required'),
	amount: z.coerce.number().min(0).optional(),
	issue_date: z.string().nullable().optional(),
	payment_mode: z
		.enum(['cash', 'bank', 'cheque', 'card', 'upi', 'other', ''])
		.optional(),
	transaction_reference: z.string().nullable().optional(),
	bank_name: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	status: z.enum(['pending', 'issued', 'cancelled']).optional(),
});

const defaultValues = {
	reference_number: '',
	payee_name: '',
	amount: '',
	issue_date: '',
	payment_mode: '',
	transaction_reference: '',
	bank_name: '',
	notes: '',
	status: 'pending',
};

const formFields = [
	{
		name: 'reference_number',
		label: 'Reference #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'payee_name', label: 'Payee Name', required: true },
	{ name: 'amount', label: 'Amount', type: 'number', step: '0.01' },
	{ name: 'issue_date', label: 'Issue Date', type: 'date' },
	{
		name: 'payment_mode',
		label: 'Payment Mode',
		type: 'select',
		options: [
			{ value: '', label: 'Select mode…' },
			{ value: 'cash', label: 'Cash' },
			{ value: 'bank', label: 'Bank Transfer' },
			{ value: 'cheque', label: 'Cheque' },
			{ value: 'card', label: 'Card' },
			{ value: 'upi', label: 'UPI' },
			{ value: 'other', label: 'Other' },
		],
	},
	{ name: 'transaction_reference', label: 'Transaction Ref' },
	{ name: 'bank_name', label: 'Bank Name' },
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
	{ key: 'payee_name', label: 'Payee' },
	{
		key: 'amount',
		label: 'Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{ key: 'issue_date', label: 'Issue Date', date: true, headClassName: 'w-28' },
	{ key: 'payment_mode', label: 'Mode', headClassName: 'w-24' },
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
	{ key: 'issued', label: 'Issued', tone: 'green', icon: CheckCircleIcon },
	{
		key: 'totalAmount',
		label: 'Total Amount',
		tone: 'purple',
		money: true,
	},
];

export default function PaymentIssuePage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Payment Issue"
			subtitle="Payments issued to vendors and suppliers"
			endpoint="/api/admin/payment-issues"
			queryKey={['payment-issues']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			searchPlaceholder="Search by ref #, payee, transaction…"
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
