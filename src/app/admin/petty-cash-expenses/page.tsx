'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	DocumentTextIcon,
	CheckCircleIcon,
	XCircleIcon,
	PaperAirplaneIcon,
	BanknotesIcon,
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SelectHTMLAttributes, RefAttributes } from 'react';
import ResourcePage from '@/components/admin/ResourcePage';
import { Select as _Select } from '@/components/ui/form-fields';

const Select: ComponentType<
	SelectHTMLAttributes<HTMLSelectElement> & RefAttributes<HTMLSelectElement>
> = _Select as unknown as ComponentType<
	SelectHTMLAttributes<HTMLSelectElement> & RefAttributes<HTMLSelectElement>
>;

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
];

const TYPE_OPTIONS = [
	{ value: 'all', label: 'All types' },
	{ value: 'receipt', label: 'Receipt' },
	{ value: 'payment', label: 'Payment' },
];

const CATEGORY_OPTIONS = [
	{ value: 'Office Supplies', label: 'Office Supplies' },
	{ value: 'Conveyance', label: 'Conveyance' },
	{ value: 'Courier', label: 'Courier' },
	{ value: 'Postage', label: 'Postage' },
	{ value: 'Printing & Stationery', label: 'Printing & Stationery' },
	{ value: 'Refreshments', label: 'Refreshments' },
	{ value: 'Repairs', label: 'Repairs' },
	{ value: 'Bank Charges', label: 'Bank Charges' },
	{ value: 'Subscription', label: 'Subscription' },
	{ value: 'Miscellaneous', label: 'Miscellaneous' },
];

const PAYMENT_MODE_OPTIONS = [
	{ value: 'cash', label: 'Cash' },
	{ value: 'bank', label: 'Bank Transfer' },
	{ value: 'cheque', label: 'Cheque' },
	{ value: 'card', label: 'Card' },
	{ value: 'upi', label: 'UPI' },
	{ value: 'other', label: 'Other' },
];

const TRANSACTION_TYPE_OPTIONS = [
	{ value: 'payment', label: 'Payment' },
	{ value: 'receipt', label: 'Receipt / Top-up' },
];

const STATUS_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	submitted: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	rejected: 'bg-rose-100 text-rose-700',
};

const TYPE_BADGE: Record<string, string> = {
	receipt: 'bg-emerald-100 text-emerald-700',
	payment: 'bg-orange-100 text-orange-700',
};

const STATUS_OPTIONS_FOR_FORM = STATUS_OPTIONS.filter((o) => o.value !== 'all');

const schema = z.object({
	transaction_number: z.string().nullable().optional(),
	transaction_date: z.string().min(1, 'Date is required'),
	transaction_type: z.enum(['receipt', 'payment']),
	expense_category: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	custodian_employee_id: z.coerce.number().int().optional(),
	custodian_employee_name: z.string().nullable().optional(),
	amount: z.coerce.number().min(0, 'Amount must be ≥ 0'),
	payment_mode: z
		.enum(['cash', 'bank', 'cheque', 'card', 'upi', 'other'])
		.optional(),
	payment_reference: z.string().nullable().optional(),
	recipient_name: z.string().nullable().optional(),
	bill_no: z.string().nullable().optional(),
	bill_date: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(),
});

const defaultValues = {
	transaction_number: '',
	transaction_date: new Date().toISOString().split('T')[0],
	transaction_type: 'payment' as const,
	expense_category: 'Office Supplies',
	description: '',
	custodian_employee_name: '',
	custodian_employee_id: undefined as number | undefined,
	amount: '',
	payment_mode: 'cash' as const,
	payment_reference: '',
	recipient_name: '',
	bill_no: '',
	bill_date: '',
	notes: '',
	status: 'submitted' as const,
};

const formFields = [
	{
		name: 'transaction_number',
		label: 'Voucher No.',
		hint: 'Auto-generated if blank',
	},
	{
		name: 'transaction_date',
		label: 'Date',
		type: 'date' as const,
		required: true,
	},
	{
		name: 'transaction_type',
		label: 'Transaction Type',
		type: 'select' as const,
		required: true,
		options: TRANSACTION_TYPE_OPTIONS,
	},
	{
		name: 'expense_category',
		label: 'Expense Category',
		type: 'select' as const,
		options: CATEGORY_OPTIONS,
	},
	{
		name: 'description',
		label: 'Particulars',
		fullWidth: true,
	},
	{
		name: 'custodian_employee_name',
		label: 'Custodian (Employee)',
		employeeAutofill: true,
	},
	{
		name: 'amount',
		label: 'Amount',
		type: 'number' as const,
		step: '0.01',
		required: true,
	},
	{
		name: 'payment_mode',
		label: 'Payment Mode',
		type: 'select' as const,
		options: PAYMENT_MODE_OPTIONS,
	},
	{
		name: 'payment_reference',
		label: 'Payment Reference',
	},
	{
		name: 'recipient_name',
		label: 'Received From / Paid To',
	},
	{ name: 'bill_no', label: 'Bill No.' },
	{ name: 'bill_date', label: 'Bill Date', type: 'date' as const },
	{
		name: 'notes',
		label: 'Remarks',
		type: 'textarea' as const,
		fullWidth: true,
	},
	{
		name: 'status',
		label: 'Status',
		type: 'select' as const,
		options: STATUS_OPTIONS_FOR_FORM,
	},
];

const columns = [
	{ key: 'sr_no', label: 'Sr. No', headClassName: 'w-14' },
	{
		key: 'transaction_date',
		label: 'Date',
		date: true,
		headClassName: 'w-24',
	},
	{
		key: 'transaction_number',
		label: 'Voucher No.',
		headClassName: 'w-28',
	},
	{ key: 'description', label: 'Particulars' },
	{ key: 'expense_category', label: 'Expense Category', headClassName: 'w-40' },
	{
		key: 'transaction_type',
		label: 'Received',
		headClassName: 'w-28 text-right',
		cellClassName: 'text-right tabular-nums text-emerald-700',
		render: (row: Record<string, unknown>) => {
			const isReceipt = row.transaction_type === 'receipt';
			const amt = Number(row.amount ?? 0);
			return isReceipt
				? new Intl.NumberFormat('en-IN', {
						style: 'currency',
						currency: 'INR',
						minimumFractionDigits: 2,
					}).format(amt)
				: '—';
		},
	},
	{
		key: 'transaction_type2',
		label: 'Paid',
		headClassName: 'w-28 text-right',
		cellClassName: 'text-right tabular-nums text-orange-700',
		render: (row: Record<string, unknown>) => {
			const isPayment = row.transaction_type === 'payment';
			const amt = Number(row.amount ?? 0);
			return isPayment
				? new Intl.NumberFormat('en-IN', {
						style: 'currency',
						currency: 'INR',
						minimumFractionDigits: 2,
					}).format(amt)
				: '—';
		},
	},
	{
		key: 'running_balance',
		label: 'Balance',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-semibold tabular-nums',
	},
	{
		key: 'payment_mode',
		label: 'Payment Mode',
		headClassName: 'w-24',
		render: (row: Record<string, unknown>) => {
			const mode = (row.payment_mode as string) || 'cash';
			return (
				<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-700">
					{mode}
				</span>
			);
		},
	},
	{
		key: 'approved_by_name',
		label: 'Approved By',
		headClassName: 'w-32',
		render: (row: Record<string, unknown>) => {
			const name = (row.approved_by_name as string) || '';
			const at = (row.approved_at as string) || '';
			if (name) {
				return (
					<span className="inline-flex items-center gap-1">
						{name}
						<span className="text-[10px] text-emerald-600" title={at}>
							✓
						</span>
					</span>
				);
			}
			return <span className="text-xs text-gray-400">Pending</span>;
		},
	},
	{
		key: 'notes',
		label: 'Remarks',
		headClassName: 'w-36',
		cellClassName: 'truncate max-w-[12rem]',
		render: (row: Record<string, unknown>) => {
			const n = (row.notes as string) || '';
			return n || '—';
		},
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-24',
		render: (row: Record<string, unknown>) => {
			const status = (row.status as string) || 'submitted';
			return (
				<span
					className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[status] || STATUS_BADGE.submitted}`}
				>
					{status}
				</span>
			);
		},
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
		key: 'submitted',
		label: 'Submitted',
		tone: 'amber' as const,
		icon: PaperAirplaneIcon,
	},
	{
		key: 'approved',
		label: 'Approved',
		tone: 'sky' as const,
		icon: CheckCircleIcon,
	},
	{
		key: 'rejected',
		label: 'Rejected',
		tone: 'rose' as const,
		icon: XCircleIcon,
	},
	{
		key: 'totalReceived',
		label: 'Received',
		tone: 'green' as const,
		money: true,
		icon: ArrowDownCircleIcon,
	},
	{
		key: 'totalPaid',
		label: 'Paid',
		tone: 'rose' as const,
		money: true,
		icon: ArrowUpCircleIcon,
	},
	{
		key: 'currentBalance',
		label: 'Balance',
		tone: 'purple' as const,
		money: true,
		icon: BanknotesIcon,
		hint: 'Current balance',
	},
	{
		key: 'approvedAmount',
		label: 'Approved Net',
		tone: 'sky' as const,
		money: true,
	},
];

function transformSubmit(values: Record<string, unknown>) {
	const result = { ...values };
	delete result.sr_no;
	delete result.running_balance;
	delete result.approved_by_name;
	delete result.approved_at;
	return result;
}

export default function PettyCashExpensesPage() {
	const [statusFilter, setStatusFilter] = useState('all');
	const [typeFilter, setTypeFilter] = useState('all');

	return (
		<ResourcePage
			title="Petty Cash Expenses"
			subtitle="Track petty cash receipts and payments with running balance"
			endpoint="/api/admin/petty-cash-expenses"
			queryKey={['petty-cash-expenses']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			transformSubmit={transformSubmit}
			searchPlaceholder="Search by voucher #, particulars, recipient, bill #…"
			employeeListEndpoint="/api/employees/list"
			vendorListEndpoint=""
			extraFilters={{
				values: { status: statusFilter, transaction_type: typeFilter },
				node: (
					<>
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
						<Select
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value)}
							className="w-36"
						>
							{TYPE_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</Select>
					</>
				),
			}}
		/>
	);
}
