'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import {
	LEAD_CONVERSION_FIELD_BY_MESSAGE,
	LEAD_CONVERSION_MESSAGES,
	canConvertLead,
	hasUsableContactDetails,
	type LeadConversionField,
} from '@/lib/lead-conversion';
import { leadKeys } from '@/components/leads/queries';
import type { LeadConversionResponse } from '@/components/leads/types';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

interface LeadConversionFacts {
	id: number;
	company_name?: string | null;
	enquiry_status: string | null;
	canonical_proposal_id: number | null;
	contact_name: string | null;
	contact_email: string | null;
	inquiry_email?: string | null;
	cc_emails?: string | null;
	phone: string | null;
	project_description: string | null;
	owner_user_id: number | null;
	owner_name: string | null;
}

interface LeadConversionActionProps {
	lead: LeadConversionFacts;
	canConvert: boolean;
	/** The list row: the action without the qualification panel. */
	compact?: boolean;
}

type FieldErrors = Partial<Record<LeadConversionField, string>>;

/**
 * The Lead-to-Proposal handoff on the Lead screens.
 *
 * One request, one handoff: the server creates the canonical Proposal,
 * marks the Lead Converted, records the conversion, and moves the
 * scheduled work. The panel never writes a Proposal and never writes a
 * stage. Every refusal comes back attached to the field it belongs to,
 * and a successful handoff opens the Proposal of the enquiry.
 */
export default function LeadConversionAction({
	lead,
	canConvert,
	compact = false,
}: LeadConversionActionProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState('');
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [requestError, setRequestError] = useState<string | null>(null);

	const conversion = useMutation<
		LeadConversionResponse,
		Error,
		Record<string, unknown>
	>({
		mutationFn: (body) =>
			apiPost<LeadConversionResponse>(`/api/leads/${lead.id}/convert`, body),
		onSuccess: (response) => {
			setFieldErrors({});
			setRequestError(null);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			void queryClient.invalidateQueries({
				queryKey: leadKeys.timeline(String(lead.id)),
			});
			router.push(`/proposals/${response.data.proposal_id}`);
		},
		onError: (error) => {
			const field = LEAD_CONVERSION_FIELD_BY_MESSAGE[error.message];
			if (field) {
				setFieldErrors({ [field]: error.message });
				setRequestError(null);
			} else {
				setFieldErrors({});
				setRequestError(error.message);
			}
		},
	});

	if (!canConvert) {
		if (compact) return null;
		return (
			<section
				aria-label="Convert to Proposal"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900">
					Convert to Proposal
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					You do not have permission to convert this lead. The handoff needs the
					lead convert, lead update, and proposal create permissions.
				</p>
			</section>
		);
	}

	const proposalId = lead.canonical_proposal_id;
	if (proposalId !== null) {
		if (compact) return null;
		return (
			<section
				aria-label="Convert to Proposal"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900">
					Convert to Proposal
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					This enquiry already has its canonical proposal.
				</p>
				<button
					type="button"
					onClick={() => router.push(`/proposals/${proposalId}`)}
					className="mt-3 bg-[#64126D] text-white px-4 py-2 rounded-md hover:bg-[#52105a]"
				>
					Open Proposal #{proposalId}
				</button>
			</section>
		);
	}

	const stageReady = canConvertLead(lead.enquiry_status);
	const contactDetails =
		lead.phone ?? lead.contact_email ?? lead.inquiry_email ?? null;
	const contactUsable = hasUsableContactDetails({
		phone: lead.phone,
		contact_email: lead.contact_email,
		inquiry_email: lead.inquiry_email,
		cc_emails: lead.cc_emails,
	});
	const facts = [
		{
			field: 'contact_name' as const,
			label: 'Named contact',
			value: lead.contact_name,
		},
		{
			field: 'contact_details' as const,
			label: 'Phone or email',
			value: contactUsable ? contactDetails : null,
		},
		{
			field: 'project_need' as const,
			label: 'Project need',
			value: lead.project_description,
		},
		{
			field: 'owner' as const,
			label: 'Lead owner',
			value:
				lead.owner_name ?? (lead.owner_user_id === null ? null : 'Assigned'),
		},
	];

	const startConversion = (): void => {
		setOpen(true);
		setFieldErrors({});
		setRequestError(null);
	};

	const submitConversion = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const body: Record<string, unknown> = {};
		if (title.trim() !== '') body.proposal_title = title.trim();
		conversion.mutate(body);
	};

	const errorEntries = Object.entries(fieldErrors) as Array<
		[LeadConversionField, string]
	>;
	// The refusals that belong to no single field of the panel: the
	// canonical-Proposal conflict and the stage refusal.
	const generalErrors = errorEntries.filter(
		([field]) =>
			field !== 'contact_name' &&
			field !== 'contact_details' &&
			field !== 'project_need' &&
			field !== 'owner' &&
			field !== 'proposal_title'
	);

	const actionButton = (
		<button
			type="button"
			onClick={compact ? () => conversion.mutate({}) : startConversion}
			disabled={conversion.isPending || !stageReady}
			className="px-3 py-2 text-sm rounded-md bg-[#64126D] text-white hover:bg-[#52105a] disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{conversion.isPending ? 'Converting...' : 'Convert to Proposal'}
		</button>
	);

	if (compact) {
		return (
			<div>
				<button
					type="button"
					onClick={() => conversion.mutate({})}
					disabled={conversion.isPending || !stageReady}
					title={
						stageReady
							? 'Convert to Proposal'
							: LEAD_CONVERSION_MESSAGES.stage_required
					}
					aria-label={`Convert lead ${lead.company_name ?? lead.id} to a proposal`}
					className="p-2 text-purple-700 hover:text-purple-900 hover:bg-purple-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<DocumentTextIcon className="h-4 w-4" />
				</button>
				{errorEntries.length > 0 ? (
					<div role="alert" className="mt-1 text-xs text-red-600">
						{errorEntries.map(([field, message]) => (
							<p key={field}>{message}</p>
						))}
					</div>
				) : null}
				{requestError ? (
					<p role="alert" className="mt-1 text-xs text-red-600">
						{requestError}
					</p>
				) : null}
			</div>
		);
	}

	return (
		<section
			aria-label="Convert to Proposal"
			className="bg-white rounded-lg border border-gray-200 p-6"
		>
			<h3 className="text-lg font-medium text-gray-900">Convert to Proposal</h3>
			<p className="mt-1 text-sm text-gray-600">
				Create the canonical proposal of this enquiry. The lead is marked
				converted, the conversion is recorded, and the scheduled work moves to
				the proposal.
			</p>

			{!stageReady ? (
				<p className="mt-3 text-sm text-amber-700">
					{LEAD_CONVERSION_MESSAGES.stage_required}
				</p>
			) : null}

			<div className="mt-3">{actionButton}</div>

			{open && stageReady ? (
				<form onSubmit={submitConversion} className="mt-4 space-y-4">
					<div>
						<label
							htmlFor={`lead-conversion-title-${lead.id}`}
							className="block text-sm font-medium text-gray-700 mb-1"
						>
							Proposal title
						</label>
						<input
							id={`lead-conversion-title-${lead.id}`}
							type="text"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							disabled={conversion.isPending}
							aria-invalid={fieldErrors.proposal_title ? true : undefined}
							aria-describedby={
								fieldErrors.proposal_title
									? `lead-conversion-title-error-${lead.id}`
									: undefined
							}
							placeholder="Taken from the lead when left empty"
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
						/>
						{fieldErrors.proposal_title ? (
							<p
								id={`lead-conversion-title-error-${lead.id}`}
								role="alert"
								className="mt-1 text-sm text-red-600"
							>
								{fieldErrors.proposal_title}
							</p>
						) : null}
					</div>

					<fieldset className="rounded-md border border-gray-200 p-3">
						<legend className="px-1 text-sm font-medium text-gray-700">
							Conversion facts
						</legend>
						<dl className="space-y-2">
							{facts.map((fact) => (
								<div key={fact.field}>
									<dt className="text-xs font-medium text-gray-600">
										{fact.label}
									</dt>
									<dd className="text-sm text-gray-900">
										{fact.value ?? 'Missing'}
									</dd>
									{fieldErrors[fact.field] ? (
										<p role="alert" className="mt-1 text-sm text-red-600">
											{fieldErrors[fact.field]}
										</p>
									) : null}
								</div>
							))}
						</dl>
						<p className="mt-2 text-xs text-gray-500">
							Budget and project timing are not lead fields, so they never block
							a conversion.
						</p>
					</fieldset>

					{generalErrors.length > 0 ? (
						<div role="alert" className="text-sm text-red-600">
							{generalErrors.map(([field, message]) => (
								<p key={field}>{message}</p>
							))}
						</div>
					) : null}

					{requestError ? (
						<p role="alert" className="text-sm text-red-600">
							{requestError}
						</p>
					) : null}

					<div className="flex items-center gap-3">
						<button
							type="submit"
							disabled={conversion.isPending}
							className="bg-[#64126D] text-white px-4 py-2 rounded-md hover:bg-[#52105a] disabled:opacity-50"
						>
							{conversion.isPending ? 'Converting...' : 'Convert lead'}
						</button>
						<button
							type="button"
							onClick={() => setOpen(false)}
							disabled={conversion.isPending}
							className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50"
						>
							Cancel
						</button>
					</div>
				</form>
			) : null}
		</section>
	);
}
