'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	DocumentTextIcon,
	CheckCircleIcon,
	XCircleIcon,
	PaperAirplaneIcon,
	ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import ResourcePage from '@/components/admin/ResourcePage';
import { Select } from '@/components/ui/form-fields';

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'reimbursed', label: 'Reimbursed' },
];

const CATEGORY_OPTIONS = [
	{ value: 'Travel', label: 'Travel' },
	{ value: 'Meals', label: 'Meals & Entertainment' },
	{ value: 'Office Supplies', label: 'Office Supplies' },
	{ value: 'Software', label: 'Software / Subscriptions' },
	{ value: 'Hardware', label: 'Hardware / Equipment' },
	{ value: 'Utilities', label: 'Utilities' },
	{ value: 'Marketing', label: 'Marketing' },
	{ value: 'Professional Services', label: 'Professional Services' },
	{ value: 'Rent', label: 'Rent' },
	{ value: 'Salary', label: 'Salary' },
	{ value: 'Other', label: 'Other' },
];

const STATUS_BADGE = {
	draft: 'bg-slate-100 text-slate-700',
	submitted: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	rejected: 'bg-rose-100 text-rose-700',
	reimbursed: 'bg-emerald-100 text-emerald-700',
};

const PAYMENT_MODES = [
	{ value: 'cash', label: 'Cash' },
	{ value: 'bank', label: 'Bank Transfer' },
	{ value: 'cheque', label: 'Cheque' },
	{ value: 'card', label: 'Card' },
	{ value: 'upi', label: 'UPI' },
	{ value: 'other', label: 'Other' },
];

const schema = z.object({
	expense_number: z.string().optional(),
	expense_date: z.string().optional(),
	category: z.string().min(1, 'Category is required'),
	sub_category: z.string().optional(),
	description: z.string().optional(),
	vendor_name: z.string().optional(),
	amount: z.coerce.number().min(0, 'Amount must be ≥ 0'),
	tax_amount: z.coerce.number().min(0).optional(),
	total_amount: z.coerce.number().min(0).optional(),
	currency: z.string().optional(),
	payment_mode: z
		.enum(['cash', 'bank', 'cheque', 'card', 'upi', 'other'])
		.optional(),
	payment_reference: z.string().optional(),
	paid_to: z.string().optional(),
	receipt_url: z.string().optional(),
	is_billable: z.coerce.boolean().optional(),
	is_reimbursable: z.coerce.boolean().optional(),
	project_id: z.coerce.number().int().optional(),
	department: z.string().optional(),
	notes: z.string().optional(),
	status: z
		.enum(['draft', 'submitted', 'approved', 'rejected', 'reimbursed'])
		.optional(),
});

const defaultValues = {
	expense_number: '',
	expense_date: '',
	category: 'Other',
	sub_category: '',
	description: '',
	vendor_name: '',
	amount: 0,
	tax_amount: 0,
	total_amount: 0,
	currency: 'INR',
	payment_mode: 'bank',
	payment_reference: '',
	paid_to: '',
	receipt_url: '',
	is_billable: false,
	is_reimbursable: false,
	department: '',
	notes: '',
	status: 'submitted',
};

const formFields = [
	{
		name: 'expense_number',
		label: 'Expense #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'expense_date', label: 'Expense Date', type: 'date' },
	{
		name: 'category',
		label: 'Category',
		type: 'select',
		required: true,
		options: CATEGORY_OPTIONS,
	},
	{ name: 'sub_category', label: 'Sub-category' },
	{ name: 'vendor_name', label: 'Vendor / Merchant' },
	{ name: 'paid_to', label: 'Paid To' },
	{ name: 'department', label: 'Department' },
	{
		name: 'description',
		label: 'Description',
		type: 'textarea',
		fullWidth: true,
	},
	{
		name: 'amount',
		label: 'Amount',
		type: 'number',
		step: '0.01',
		required: true,
	},
	{ name: 'tax_amount', label: 'Tax', type: 'number', step: '0.01' },
	{ name: 'total_amount', label: 'Total', type: 'number', step: '0.01' },
	{ name: 'currency', label: 'Currency' },
	{
		name: 'payment_mode',
		label: 'Payment Mode',
		type: 'select',
		options: PAYMENT_MODES,
	},
	{ name: 'payment_reference', label: 'Payment Reference' },
	{ name: 'receipt_url', label: 'Receipt URL', fullWidth: true },
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS.filter((o) => o.value !== 'all'),
	},
	{ name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
];

const columns = [
	{ key: 'expense_number', label: 'Expense #', headClassName: 'w-32' },
	{ key: 'expense_date', label: 'Date', date: true, headClassName: 'w-28' },
	{ key: 'category', label: 'Category', headClassName: 'w-40' },
	{ key: 'vendor_name', label: 'Vendor' },
	{ key: 'paid_to', label: 'Paid To' },
	{
		key: 'payment_mode',
		label: 'Mode',
		headClassName: 'w-24',
	},
	{
		key: 'total_amount',
		label: 'Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-28',
		render: (row) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[row.status] || STATUS_BADGE.submitted}`}
			>
				{row.status || 'submitted'}
			</span>
		),
	},
];

const statsConfig = [
	{ key: 'total', label: 'Total', tone: 'purple', icon: DocumentTextIcon },
	{
		key: 'submitted',
		label: 'Submitted',
		tone: 'amber',
		icon: PaperAirplaneIcon,
	},
	{ key: 'approved', label: 'Approved', tone: 'sky', icon: CheckCircleIcon },
	{
		key: 'reimbursed',
		label: 'Reimbursed',
		tone: 'green',
		icon: ArrowUturnLeftIcon,
	},
	{ key: 'rejected', label: 'Rejected', tone: 'rose', icon: XCircleIcon },
	{ key: 'totalAmount', label: 'Total Amount', tone: 'purple', money: true },
	{ key: 'approvedAmount', label: 'Approved', tone: 'sky', money: true },
	{ key: 'reimbursedAmount', label: 'Reimbursed', tone: 'green', money: true },
];

export default function ExpensesPage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Expense"
			subtitle="Track company expenses, reimbursements, and approvals"
			endpoint="/api/admin/expenses"
			queryKey={['expenses']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			searchPlaceholder="Search by expense #, vendor, paid to…"
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
