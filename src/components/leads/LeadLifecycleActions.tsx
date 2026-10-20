'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import {
	LEAD_LIFECYCLE_ACTIONS,
	LEAD_LIFECYCLE_ACTIVE_ACTIONS,
	LEAD_LIFECYCLE_FIELD_BY_MESSAGE,
	LEAD_LIFECYCLE_MESSAGES,
	LEAD_LIFECYCLE_OWNER_ACTIONS,
	LEAD_LIFECYCLE_QUALIFICATION_ACTIONS,
	LEAD_LIFECYCLE_REASON_ACTIONS,
	canApplyLeadLifecycleAction,
	type LeadLifecycleAction,
	type LeadLifecycleField,
} from '@/lib/lead-lifecycle';
import { formatDate } from '@/lib/format';
import { leadKeys } from '@/components/leads/queries';
import type {
	LeadDetail,
	LeadLifecycleResponse,
} from '@/components/leads/types';

interface LeadLifecycleActionsProps {
	lead: Pick<
		LeadDetail,
		| 'id'
		| 'enquiry_status'
		| 'owner_user_id'
		| 'owner_name'
		| 'next_action_date'
		| 'contact_name'
		| 'contact_email'
		| 'inquiry_email'
		| 'cc_emails'
		| 'phone'
		| 'project_description'
	>;
	owners: Array<{ id: number; full_name: string }>;
	canDecide: boolean;
}

type FieldErrors = Partial<Record<LeadLifecycleField, string>>;

/**
 * The explicit lifecycle decisions of a Lead.
 *
 * Qualify, Nurture, Disqualify, and Reopen are accountable decisions: the
 * panel collects what the decision needs, the server decides whether the
 * decision is allowed, and every refusal comes back attached to the field
 * it belongs to. The panel never writes a stage itself.
 */
export default function LeadLifecycleActions({
	lead,
	owners,
	canDecide,
}: LeadLifecycleActionsProps) {
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<LeadLifecycleAction | null>(null);
	const [reason, setReason] = useState('');
	const [scheduledFor, setScheduledFor] = useState('');
	const [nextActionText, setNextActionText] = useState('');
	const [ownerUserId, setOwnerUserId] = useState(() => {
		const current = lead.owner_user_id;
		if (current === null) return '';
		// An owner who is no longer in the assignment directory cannot be
		// assigned again, so the operator has to choose an active one.
		return owners.some((owner) => owner.id === current) ? String(current) : '';
	});
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [requestError, setRequestError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const decision = useMutation<
		LeadLifecycleResponse,
		Error,
		{ action: LeadLifecycleAction; body: Record<string, unknown> }
	>({
		mutationFn: ({ body }) =>
			apiPost<LeadLifecycleResponse>(`/api/leads/${lead.id}/stage`, body),
		onSuccess: (response, variables) => {
			setFieldErrors({});
			setRequestError(null);
			setSelected(null);
			setReason('');
			setScheduledFor('');
			setNextActionText('');
			setNotice(
				`${variables.action} recorded. The lead is now ${response.data.stage}, and the decision is on the timeline.`
			);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			void queryClient.invalidateQueries({
				queryKey: leadKeys.timeline(String(lead.id)),
			});
		},
		onError: (error) => {
			const field = LEAD_LIFECYCLE_FIELD_BY_MESSAGE[error.message];
			if (field) {
				setFieldErrors({ [field]: error.message });
				setRequestError(null);
			} else {
				setFieldErrors({});
				setRequestError(error.message);
			}
		},
	});

	const stage = lead.enquiry_status;
	const availableActions = LEAD_LIFECYCLE_ACTIONS.filter((action) =>
		canApplyLeadLifecycleAction(action, stage)
	);
	const needsReason =
		selected !== null && LEAD_LIFECYCLE_REASON_ACTIONS.includes(selected);
	const needsOwner =
		selected !== null && LEAD_LIFECYCLE_OWNER_ACTIONS.includes(selected);
	const needsNextAction =
		selected !== null &&
		LEAD_LIFECYCLE_ACTIVE_ACTIONS.includes(selected) &&
		lead.next_action_date === null;
	const showsQualificationFacts =
		selected !== null &&
		LEAD_LIFECYCLE_QUALIFICATION_ACTIONS.includes(selected);

	const contactDetails =
		lead.phone ??
		lead.contact_email ??
		lead.inquiry_email ??
		lead.cc_emails ??
		null;

	const startDecision = (action: LeadLifecycleAction): void => {
		setSelected(action);
		setFieldErrors({});
		setRequestError(null);
		setNotice(null);
	};

	const cancelDecision = (): void => {
		setSelected(null);
		setFieldErrors({});
		setRequestError(null);
	};

	const submitDecision = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (selected === null) return;
		const errors: FieldErrors = {};
		if (needsReason && reason.trim() === '') {
			errors.reason = LEAD_LIFECYCLE_MESSAGES.reason_required;
		}
		if (needsNextAction && scheduledFor.trim() === '') {
			errors.next_action = LEAD_LIFECYCLE_MESSAGES.next_action_invalid;
		}
		if (needsOwner && ownerUserId.trim() === '') {
			errors.owner = LEAD_LIFECYCLE_MESSAGES.owner_required;
		}
		setFieldErrors(errors);
		setRequestError(null);
		if (Object.keys(errors).length > 0) return;

		const body: Record<string, unknown> = { action: selected };
		if (reason.trim() !== '') body.reason = reason.trim();
		if (needsOwner) body.owner_user_id = Number(ownerUserId);
		if (needsNextAction) {
			body.next_action = {
				scheduled_for: scheduledFor,
				next_action:
					nextActionText.trim() === '' ? undefined : nextActionText.trim(),
			};
		}
		decision.mutate({ action: selected, body });
	};

	if (!canDecide) {
		return (
			<section
				aria-label="Lead lifecycle actions"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900">
					Lifecycle decisions
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					You do not have permission to decide the stage of this lead.
				</p>
			</section>
		);
	}

	if (stage === 'Converted') {
		return (
			<section
				aria-label="Lead lifecycle actions"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900">
					Lifecycle decisions
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					This lead is converted. Routine sales work belongs to the linked
					proposal, so the lead takes no lifecycle decision.
				</p>
			</section>
		);
	}

	if (stage === null) {
		return (
			<section
				aria-label="Lead lifecycle actions"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900">
					Lifecycle decisions
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					Resolve the stage of this lead before deciding anything about it.
				</p>
			</section>
		);
	}

	const saving = decision.isPending;

	return (
		<section
			aria-label="Lead lifecycle actions"
			className="bg-white rounded-lg border border-gray-200 p-6"
		>
			<h3 className="text-lg font-medium text-gray-900">Lifecycle decisions</h3>
			<p className="mt-1 text-sm text-gray-600">
				Qualify, nurture, disqualify, or reopen this lead. Every decision is
				recorded with its reason, its author, and the time.
			</p>

			<div className="mt-3 flex flex-wrap gap-2">
				{availableActions.map((action) => (
					<button
						key={action}
						type="button"
						onClick={() => startDecision(action)}
						disabled={saving}
						aria-pressed={selected === action}
						className={
							selected === action
								? 'px-3 py-2 text-sm rounded-md bg-[#64126D] text-white'
								: 'px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
						}
					>
						{action}
					</button>
				))}
			</div>

			{selected !== null ? (
				<form onSubmit={submitDecision} className="mt-4 space-y-4">
					{showsQualificationFacts ? (
						<fieldset className="rounded-md border border-gray-200 p-3">
							<legend className="px-1 text-sm font-medium text-gray-700">
								Qualification facts
							</legend>
							<dl className="space-y-2">
								<div>
									<dt className="text-xs font-medium text-gray-600">
										Named contact
									</dt>
									<dd className="text-sm text-gray-900">
										{lead.contact_name ?? 'Missing'}
									</dd>
									{fieldErrors.contact_name ? (
										<p role="alert" className="mt-1 text-sm text-red-600">
											{fieldErrors.contact_name}
										</p>
									) : null}
								</div>
								<div>
									<dt className="text-xs font-medium text-gray-600">
										Phone or email
									</dt>
									<dd className="text-sm text-gray-900">
										{contactDetails ?? 'Missing'}
									</dd>
									{fieldErrors.contact_details ? (
										<p role="alert" className="mt-1 text-sm text-red-600">
											{fieldErrors.contact_details}
										</p>
									) : null}
								</div>
								<div>
									<dt className="text-xs font-medium text-gray-600">
										Project need
									</dt>
									<dd className="text-sm text-gray-900">
										{lead.project_description ?? 'Missing'}
									</dd>
									{fieldErrors.project_need ? (
										<p role="alert" className="mt-1 text-sm text-red-600">
											{fieldErrors.project_need}
										</p>
									) : null}
								</div>
							</dl>
							<p className="mt-2 text-xs text-gray-500">
								Budget and project timing are not lead fields, so they never
								block a qualification.
							</p>
						</fieldset>
					) : null}

					{needsOwner ? (
						<div>
							<label
								htmlFor={`lead-lifecycle-owner-${lead.id}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Lead owner
							</label>
							{owners.length > 0 ? (
								<select
									id={`lead-lifecycle-owner-${lead.id}`}
									value={ownerUserId}
									onChange={(event) => setOwnerUserId(event.target.value)}
									disabled={saving}
									aria-invalid={fieldErrors.owner ? true : undefined}
									aria-describedby={
										fieldErrors.owner
											? `lead-lifecycle-owner-error-${lead.id}`
											: undefined
									}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
								>
									<option value="">Choose an owner</option>
									{owners.map((owner) => (
										<option key={owner.id} value={String(owner.id)}>
											{owner.full_name}
										</option>
									))}
								</select>
							) : (
								<p className="text-sm text-gray-900">
									{lead.owner_name ?? 'Unassigned intake'}
								</p>
							)}
							{fieldErrors.owner ? (
								<p
									id={`lead-lifecycle-owner-error-${lead.id}`}
									role="alert"
									className="mt-1 text-sm text-red-600"
								>
									{fieldErrors.owner}
								</p>
							) : null}
						</div>
					) : null}

					{needsNextAction ? (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label
									htmlFor={`lead-lifecycle-date-${lead.id}`}
									className="block text-sm font-medium text-gray-700 mb-1"
								>
									Next action date
								</label>
								<input
									id={`lead-lifecycle-date-${lead.id}`}
									type="date"
									value={scheduledFor}
									onChange={(event) => setScheduledFor(event.target.value)}
									disabled={saving}
									aria-invalid={fieldErrors.next_action ? true : undefined}
									aria-describedby={
										fieldErrors.next_action
											? `lead-lifecycle-date-error-${lead.id}`
											: undefined
									}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
								/>
							</div>
							<div>
								<label
									htmlFor={`lead-lifecycle-text-${lead.id}`}
									className="block text-sm font-medium text-gray-700 mb-1"
								>
									Next action description
								</label>
								<input
									id={`lead-lifecycle-text-${lead.id}`}
									type="text"
									value={nextActionText}
									onChange={(event) => setNextActionText(event.target.value)}
									disabled={saving}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
								/>
							</div>
							{fieldErrors.next_action ? (
								<p
									id={`lead-lifecycle-date-error-${lead.id}`}
									role="alert"
									className="md:col-span-2 text-sm text-red-600"
								>
									{fieldErrors.next_action}
								</p>
							) : null}
						</div>
					) : (
						<p className="text-sm text-gray-700">
							Next action: {formatDate(lead.next_action_date)}
						</p>
					)}

					{needsReason ? (
						<div>
							<label
								htmlFor={`lead-lifecycle-reason-${lead.id}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Reason
							</label>
							<textarea
								id={`lead-lifecycle-reason-${lead.id}`}
								rows={3}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								disabled={saving}
								aria-invalid={fieldErrors.reason ? true : undefined}
								aria-describedby={
									fieldErrors.reason
										? `lead-lifecycle-reason-error-${lead.id}`
										: undefined
								}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
							{fieldErrors.reason ? (
								<p
									id={`lead-lifecycle-reason-error-${lead.id}`}
									role="alert"
									className="mt-1 text-sm text-red-600"
								>
									{fieldErrors.reason}
								</p>
							) : null}
						</div>
					) : null}

					{fieldErrors.action ? (
						<p role="alert" className="text-sm text-red-600">
							{fieldErrors.action}
						</p>
					) : null}

					<div className="flex gap-3">
						<button
							type="submit"
							disabled={saving}
							className="px-4 py-2 bg-[#64126D] text-white text-sm rounded-md hover:bg-[#52105a] disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{saving ? 'Applying…' : `Apply ${selected}`}
						</button>
						<button
							type="button"
							onClick={cancelDecision}
							disabled={saving}
							className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				</form>
			) : null}

			<div aria-live="polite" className="mt-3 space-y-2">
				{requestError ? (
					<p role="alert" className="text-sm text-red-600">
						{requestError}
					</p>
				) : null}
				{notice ? <p className="text-sm text-green-700">{notice}</p> : null}
			</div>
		</section>
	);
}
