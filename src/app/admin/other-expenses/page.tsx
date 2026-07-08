'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	DocumentTextIcon,
	CheckCircleIcon,
	XCircleIcon,
	PaperAirplaneIcon,
	BanknotesIcon,
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

const CATEGORY_OPTIONS = [
	{ value: 'Office Supplies', label: 'Office Supplies' },
	{ value: 'Repairs & Maintenance', label: 'Repairs & Maintenance' },
	{ value: 'Bank Charges', label: 'Bank Charges' },
	{ value: 'Conveyance', label: 'Conveyance' },
	{ value: 'Printing & Stationery', label: 'Printing & Stationery' },
	{ value: 'Postage & Courier', label: 'Postage & Courier' },
	{ value: 'Telephone / Internet', label: 'Telephone / Internet' },
	{ value: 'Subscription', label: 'Subscription' },
	{ value: 'Training', label: 'Training' },
	{ value: 'Miscellaneous', label: 'Miscellaneous' },
];

const PAYEE_TYPE_OPTIONS = [
	{ value: 'vendor', label: 'Vendor' },
	{ value: 'employee', label: 'Employee' },
];

const STATUS_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	submitted: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	rejected: 'bg-rose-100 text-rose-700',
};

const PAYEE_BADGE: Record<string, string> = {
	vendor: 'bg-violet-100 text-violet-700',
	employee: 'bg-cyan-100 text-cyan-700',
};

const STATUS_OPTIONS_FOR_FORM = STATUS_OPTIONS.filter((o) => o.value !== 'all');

const schema = z.object({
	voucher_number: z.string().nullable().optional(),
	voucher_date: z.string().min(1, 'Voucher date is required'),
	expense_category: z.string().min(1, 'Category is required'),
	payee_type: z.enum(['vendor', 'employee']),
	vendor_id: z.coerce.number().int().optional(),
	vendor_name: z.string().nullable().optional(),
	employee_id: z.coerce.number().int().optional(),
	employee_name: z.string().nullable().optional(),
	bill_no: z.string().nullable().optional(),
	bill_date: z.string().nullable().optional(),
	bill_amount: z.coerce.number().min(0, 'Bill amount must be ≥ 0'),
	gst_amount: z.coerce.number().min(0).optional(),
	description: z.string().nullable().optional(),
	status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(),
});

const defaultValues = {
	voucher_number: '',
	voucher_date: new Date().toISOString().split('T')[0],
	expense_category: 'Office Supplies',
	payee_type: 'vendor' as const,
	vendor_name: '',
	vendor_id: undefined as number | undefined,
	employee_name: '',
	employee_id: undefined as number | undefined,
	bill_no: '',
	bill_date: '',
	bill_amount: '',
	gst_amount: '',
	description: '',
	status: 'submitted' as const,
};

const formFields = [
	{
		name: 'voucher_number',
		label: 'Voucher #',
		hint: 'Auto-generated if blank',
	},
	{
		name: 'voucher_date',
		label: 'Voucher Date',
		type: 'date' as const,
		required: true,
	},
	{
		name: 'expense_category',
		label: 'Expense Category',
		type: 'select' as const,
		required: true,
		options: CATEGORY_OPTIONS,
	},
	{
		name: 'payee_type',
		label: 'Payee Type',
		type: 'select' as const,
		required: true,
		options: PAYEE_TYPE_OPTIONS,
	},
	{
		name: 'vendor_name',
		label: 'Vendor',
		vendorAutofill: true,
		dependentOn: {
			field: 'payee_type',
			values: ['vendor'],
			clearFields: ['vendor_id'],
		},
	},
	{
		name: 'employee_name',
		label: 'Employee',
		employeeAutofill: true,
		dependentOn: {
			field: 'payee_type',
			values: ['employee'],
			clearFields: ['employee_id'],
		},
	},
	{ name: 'bill_no', label: 'Bill No.' },
	{ name: 'bill_date', label: 'Bill Date', type: 'date' as const },
	{
		name: 'bill_amount',
		label: 'Bill Amount',
		type: 'number' as const,
		step: '0.01',
		required: true,
	},
	{
		name: 'gst_amount',
		label: 'GST / IGST',
		type: 'number' as const,
		step: '0.01',
	},
	{
		name: 'description',
		label: 'Description',
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
	{ key: 'sr_no', label: 'Sr. No', headClassName: 'w-16' },
	{
		key: 'voucher_date',
		label: 'Voucher Date',
		date: true,
		headClassName: 'w-28',
	},
	{ key: 'expense_category', label: 'Expense Category', headClassName: 'w-44' },
	{
		key: 'payee_type',
		label: 'Vendor / Employee',
		render: (row: Record<string, unknown>) => {
			const name: string = String(row.vendor_name || row.employee_name || '');
			const displayName = name || '—';
			const type = (row.payee_type as string) || 'vendor';
			return (
				<span className="inline-flex items-center gap-1.5">
					{displayName}
					<span
						className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${PAYEE_BADGE[type] || PAYEE_BADGE.vendor}`}
					>
						{type === 'employee' ? 'EMP' : 'VND'}
					</span>
				</span>
			);
		},
	},
	{ key: 'bill_no', label: 'Bill No.' },
	{ key: 'bill_date', label: 'Bill Date', date: true, headClassName: 'w-28' },
	{
		key: 'bill_amount',
		label: 'Bill Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right tabular-nums',
	},
	{
		key: 'gst_amount',
		label: 'GST / IGST',
		money: true,
		headClassName: 'w-28 text-right',
		cellClassName: 'text-right tabular-nums',
	},
	{
		key: 'net_amount',
		label: 'Net Bill Amount',
		money: true,
		headClassName: 'w-36 text-right',
		cellClassName: 'text-right font-semibold tabular-nums',
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-28',
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
		key: 'totalAmount',
		label: 'Total Amount',
		tone: 'purple' as const,
		money: true,
		icon: BanknotesIcon,
	},
	{
		key: 'approvedAmount',
		label: 'Approved',
		tone: 'sky' as const,
		money: true,
	},
];

function transformSubmit(values: Record<string, unknown>) {
	const result = { ...values };
	if (result.payee_type === 'vendor') {
		delete result.employee_name;
		delete result.employee_id;
	}
	if (result.payee_type === 'employee') {
		delete result.vendor_name;
		delete result.vendor_id;
	}
	delete result.sr_no;
	return result;
}

export default function OtherExpensesPage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Other Expenses"
			subtitle="Track miscellaneous expenses against vendors and employees"
			endpoint="/api/admin/other-expenses"
			queryKey={['other-expenses']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			transformSubmit={transformSubmit}
			searchPlaceholder="Search by voucher #, bill #, vendor, employee…"
			vendorListEndpoint="/api/vendors"
			employeeListEndpoint="/api/employees/list"
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
