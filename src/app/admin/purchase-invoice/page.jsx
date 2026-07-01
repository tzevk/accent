'use client';

import { z } from 'zod';
import { useState } from 'react';
import {
	DocumentTextIcon,
	PaperAirplaneIcon,
	CheckCircleIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import ResourcePage from '@/components/admin/ResourcePage';
import { Select } from '@/components/ui/form-fields';

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'paid', label: 'Paid' },
	{ value: 'overdue', label: 'Overdue' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE = {
	draft: 'bg-slate-100 text-slate-700',
	pending: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	paid: 'bg-emerald-100 text-emerald-700',
	overdue: 'bg-rose-100 text-rose-700',
	cancelled: 'bg-gray-100 text-gray-500',
};

const schema = z.object({
	invoice_number: z.string().optional(),
	invoice_date: z.string().optional(),
	due_date: z.string().optional(),
	vendor_name: z.string().min(1, 'Vendor name is required'),
	vendor_email: z.string().email('Invalid email').optional().or(z.literal('')),
	vendor_phone: z.string().optional(),
	vendor_address: z.string().optional(),
	vendor_gstin: z.string().optional(),
	vendor_pan: z.string().optional(),
	po_number: z.string().optional(),
	po_date: z.string().optional(),
	description: z.string().optional(),
	subtotal: z.coerce.number().min(0).optional(),
	tax_rate: z.coerce.number().min(0).optional(),
	tax_amount: z.coerce.number().min(0).optional(),
	cgst_amount: z.coerce.number().min(0).optional(),
	sgst_amount: z.coerce.number().min(0).optional(),
	igst_amount: z.coerce.number().min(0).optional(),
	discount: z.coerce.number().min(0).optional(),
	total: z.coerce.number().min(0).optional(),
	amount_paid: z.coerce.number().min(0).optional(),
	balance_due: z.coerce.number().min(0).optional(),
	payment_status: z.enum(['unpaid', 'partial', 'paid', 'overdue']).optional(),
	notes: z.string().optional(),
	terms: z.string().optional(),
	attachment_url: z.string().optional(),
	status: z
		.enum(['draft', 'pending', 'approved', 'paid', 'overdue', 'cancelled'])
		.optional(),
});

const defaultValues = {
	invoice_number: '',
	invoice_date: '',
	due_date: '',
	vendor_name: '',
	vendor_email: '',
	vendor_phone: '',
	vendor_address: '',
	vendor_gstin: '',
	vendor_pan: '',
	po_number: '',
	po_date: '',
	description: '',
	subtotal: 0,
	tax_rate: 18,
	tax_amount: 0,
	cgst_amount: 0,
	sgst_amount: 0,
	igst_amount: 0,
	discount: 0,
	total: 0,
	amount_paid: 0,
	balance_due: 0,
	payment_status: 'unpaid',
	notes: '',
	terms: '',
	attachment_url: '',
	status: 'draft',
};

const formFields = [
	{
		name: 'invoice_number',
		label: 'Invoice #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'invoice_date', label: 'Invoice Date', type: 'date' },
	{ name: 'due_date', label: 'Due Date', type: 'date' },
	{
		name: 'vendor_name',
		label: 'Vendor Name',
		required: true,
		vendorAutofill: true,
	},
	{ name: 'vendor_email', label: 'Vendor Email', type: 'email' },
	{ name: 'vendor_phone', label: 'Vendor Phone' },
	{ name: 'vendor_gstin', label: 'Vendor GSTIN' },
	{ name: 'vendor_pan', label: 'Vendor PAN' },
	{ name: 'po_number', label: 'PO Number' },
	{ name: 'po_date', label: 'PO Date', type: 'date' },
	{
		name: 'vendor_address',
		label: 'Vendor Address',
		type: 'textarea',
		fullWidth: true,
	},
	{
		name: 'description',
		label: 'Description',
		type: 'textarea',
		fullWidth: true,
	},
	{ name: 'subtotal', label: 'Subtotal', type: 'number', step: '0.01' },
	{ name: 'tax_rate', label: 'Tax Rate (%)', type: 'number', step: '0.01' },
	{ name: 'tax_amount', label: 'Tax Amount', type: 'number', step: '0.01' },
	{ name: 'cgst_amount', label: 'CGST', type: 'number', step: '0.01' },
	{ name: 'sgst_amount', label: 'SGST', type: 'number', step: '0.01' },
	{ name: 'igst_amount', label: 'IGST', type: 'number', step: '0.01' },
	{ name: 'discount', label: 'Discount', type: 'number', step: '0.01' },
	{ name: 'total', label: 'Total', type: 'number', step: '0.01' },
	{ name: 'amount_paid', label: 'Amount Paid', type: 'number', step: '0.01' },
	{ name: 'balance_due', label: 'Balance Due', type: 'number', step: '0.01' },
	{
		name: 'payment_status',
		label: 'Payment Status',
		type: 'select',
		options: [
			{ value: 'unpaid', label: 'Unpaid' },
			{ value: 'partial', label: 'Partial' },
			{ value: 'paid', label: 'Paid' },
			{ value: 'overdue', label: 'Overdue' },
		],
	},
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS.filter((o) => o.value !== 'all'),
	},
	{ name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
	{ name: 'terms', label: 'Terms', type: 'textarea', fullWidth: true },
	{ name: 'attachment_url', label: 'Attachment URL', fullWidth: true },
];

const columns = [
	{ key: 'invoice_number', label: 'Invoice #', headClassName: 'w-32' },
	{ key: 'invoice_date', label: 'Date', date: true, headClassName: 'w-28' },
	{ key: 'vendor_name', label: 'Vendor' },
	{ key: 'po_number', label: 'PO #', headClassName: 'w-28' },
	{
		key: 'total',
		label: 'Total',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'balance_due',
		label: 'Balance',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right',
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-28',
		render: (row) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[row.status] || STATUS_BADGE.draft}`}
			>
				{row.status || 'draft'}
			</span>
		),
	},
];

const statsConfig = [
	{ key: 'total', label: 'Total', tone: 'purple', icon: DocumentTextIcon },
	{ key: 'draft', label: 'Draft', tone: 'slate', icon: DocumentTextIcon },
	{ key: 'pending', label: 'Pending', tone: 'amber', icon: PaperAirplaneIcon },
	{ key: 'approved', label: 'Approved', tone: 'sky', icon: CheckCircleIcon },
	{ key: 'paid', label: 'Paid', tone: 'green', icon: CheckCircleIcon },
	{
		key: 'overdue',
		label: 'Overdue',
		tone: 'rose',
		icon: ExclamationCircleIcon,
	},
	{ key: 'totalValue', label: 'Total Value', tone: 'purple', money: true },
	{ key: 'totalBalance', label: 'Outstanding', tone: 'rose', money: true },
];

export default function PurchaseInvoicePage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Purchase Invoice"
			subtitle="Invoices received from vendors for goods or services"
			endpoint="/api/admin/purchase-invoices"
			queryKey={['purchase-invoices']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			vendorListEndpoint="/api/vendors"
			searchPlaceholder="Search by invoice #, vendor, PO…"
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
