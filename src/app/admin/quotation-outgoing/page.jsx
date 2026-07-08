'use client';

/**
 * Quotation (Incoming) — quotations received from vendors.
 * Uses /api/admin/outgoing-quotations via ResourcePage.
 * Simple CRUD for vendor quotations (vendor name, amount, status).
 */

import { z } from 'zod';
import { useState } from 'react';
import {
	DocumentTextIcon,
	PaperAirplaneIcon,
	CheckCircleIcon,
	XCircleIcon,
} from '@heroicons/react/24/outline';
import ResourcePage from '@/components/admin/ResourcePage';
import { Select } from '@/components/ui/form-fields';

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'sent', label: 'Sent' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'expired', label: 'Expired' },
];

const STATUS_BADGE = {
	draft: 'bg-slate-100 text-slate-700',
	sent: 'bg-sky-100 text-sky-700',
	approved: 'bg-emerald-100 text-emerald-700',
	rejected: 'bg-rose-100 text-rose-700',
	expired: 'bg-amber-100 text-amber-700',
};

const schema = z.object({
	quotation_number: z.string().nullable().optional(),
	quotation_date: z.string().nullable().optional(),
	vendor_name: z.string().min(1, 'Vendor name is required'),
	vendor_email: z
		.string()
		.email('Invalid email')
		.nullable()
		.optional()
		.or(z.literal('')),
	vendor_phone: z.string().nullable().optional(),
	vendor_address: z.string().nullable().optional(),
	subject: z.string().nullable().optional(),
	subtotal: z.coerce.number().min(0).optional(),
	tax_rate: z.coerce.number().min(0).optional(),
	tax_amount: z.coerce.number().min(0).optional(),
	discount: z.coerce.number().min(0).optional(),
	total: z.coerce.number().min(0).optional(),
	valid_until: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	terms: z.string().nullable().optional(),
	status: z
		.enum(['draft', 'sent', 'approved', 'rejected', 'expired'])
		.optional(),
});

const defaultValues = {
	quotation_number: '',
	quotation_date: '',
	vendor_name: '',
	vendor_email: '',
	vendor_phone: '',
	vendor_address: '',
	subject: '',
	subtotal: '',
	tax_rate: 18,
	tax_amount: '',
	discount: '',
	total: '',
	valid_until: '',
	notes: '',
	terms: '',
	status: 'draft',
};

const formFields = [
	{
		name: 'quotation_number',
		label: 'Quotation #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'quotation_date', label: 'Quotation Date', type: 'date' },
	{ name: 'vendor_name', label: 'Vendor Name', required: true },
	{ name: 'vendor_email', label: 'Vendor Email', type: 'email' },
	{ name: 'vendor_phone', label: 'Vendor Phone' },
	{
		name: 'vendor_address',
		label: 'Vendor Address',
		type: 'textarea',
		fullWidth: true,
	},
	{ name: 'subject', label: 'Subject', fullWidth: true },
	{ name: 'subtotal', label: 'Subtotal', type: 'number', step: '0.01' },
	{ name: 'tax_rate', label: 'Tax Rate (%)', type: 'number', step: '0.01' },
	{
		name: 'tax_amount',
		label: 'Tax Amount',
		type: 'number',
		step: '0.01',
		computed: {
			dependsOn: ['subtotal', 'tax_rate'],
			calculate: (v) =>
				((Number(v.subtotal) || 0) * (Number(v.tax_rate) || 0)) / 100,
		},
	},
	{ name: 'discount', label: 'Discount', type: 'number', step: '0.01' },
	{
		name: 'total',
		label: 'Total',
		type: 'number',
		step: '0.01',
		computed: {
			dependsOn: ['subtotal', 'tax_rate', 'discount'],
			calculate: (v) => {
				const sub = Number(v.subtotal) || 0;
				const tax = (sub * (Number(v.tax_rate) || 0)) / 100;
				return sub + tax - (Number(v.discount) || 0);
			},
		},
	},
	{ name: 'valid_until', label: 'Valid Until', type: 'date' },
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS.filter((o) => o.value !== 'all'),
	},
	{ name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
	{
		name: 'terms',
		label: 'Terms & Conditions',
		type: 'textarea',
		fullWidth: true,
	},
];

const columns = [
	{ key: 'quotation_number', label: 'Quotation #', headClassName: 'w-32' },
	{ key: 'quotation_date', label: 'Date', date: true, headClassName: 'w-28' },
	{ key: 'vendor_name', label: 'Vendor' },
	{ key: 'subject', label: 'Subject' },
	{
		key: 'total',
		label: 'Total',
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
	{ key: 'sent', label: 'Sent', tone: 'sky', icon: PaperAirplaneIcon },
	{ key: 'approved', label: 'Approved', tone: 'green', icon: CheckCircleIcon },
	{ key: 'rejected', label: 'Rejected', tone: 'rose', icon: XCircleIcon },
];

export default function OutgoingQuotationPage() {
	const [statusFilter, setStatusFilter] = useState('all');

	return (
		<ResourcePage
			title="Quotation (Incoming)"
			subtitle="Quotations received from vendors"
			endpoint="/api/admin/outgoing-quotations"
			queryKey={['outgoing-quotations']}
			columns={columns}
			statsConfig={statsConfig}
			defaultValues={defaultValues}
			zodSchema={schema}
			formFields={formFields}
			searchPlaceholder="Search by number, vendor, subject…"
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
