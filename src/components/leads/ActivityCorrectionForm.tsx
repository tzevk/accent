'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { LEAD_ACTIVITY_TYPES, LEAD_CALL_OUTCOMES } from '@/lib/lead-activities';
import { describeCorrectionChanges } from '@/lib/lead-corrections';
import { leadKeys } from '@/components/leads/queries';
import { formatDateTime } from '@/lib/format';
import type { LeadActivityCorrection } from '@/components/leads/types';

/**
 * The correction of one logged Lead activity.
 *
 * The person who corrects says what was wrong and why. The server owns the
 * rules: the reason is required, the version the editor saw travels with
 * the request, and a correction of an activity that moved on comes back as
 * a conflict instead of overwriting the accepted correction.
 *
 * The correction history stays visible: every correction keeps the values
 * it replaced, the reason, the person who corrected it, and the moment.
 */

interface ActivityCorrectionFormProps {
	leadId: string;
	activityId: number;
	onApplied: () => void;
	onCancel: () => void;
}

const CorrectionValuesSchema = z.object({
	activity_type: z.string().nullable(),
	call_outcome: z.string().nullable(),
	reply_confirmed: z.boolean().nullable(),
	occurred_at: z.string().nullable(),
	notes: z.string().nullable(),
});

const CorrectionSchema = z.object({
	id: z.number(),
	activity_id: z.number(),
	reason: z.string(),
	previous_values: CorrectionValuesSchema,
	corrected_values: CorrectionValuesSchema,
	corrected_by: z.number().nullable(),
	actor_name: z.string().nullable(),
	corrected_at: z.string().nullable(),
});

const CorrectionStateSchema = z.object({
	activity: z.object({
		id: z.number(),
		activity_type: z.string().nullable(),
		status: z.string().nullable(),
		call_outcome: z.string().nullable(),
		reply_confirmed: z.boolean().nullable(),
		occurred_at: z.string().nullable(),
		notes: z.string().nullable(),
		version: z.number(),
	}),
	corrections: z.array(CorrectionSchema),
});

interface ApiResponse {
	status: number;
	code: string | null;
	message: string;
	data: unknown;
}

/**
 * The correction request needs the error code of a refused request: a
 * conflict is not the same failure as an invalid value, and the person
 * correcting needs to know which one happened.
 */
async function callApi(url: string, init?: RequestInit): Promise<ApiResponse> {
	const response = await fetch(url, { credentials: 'include', ...init });
	let payload: {
		code?: string;
		error?: string;
		message?: string;
		data?: unknown;
	} = {};
	try {
		payload = (await response.json()) as typeof payload;
	} catch {}
	return {
		status: response.status,
		code: payload.code ?? null,
		message: payload.error ?? payload.message ?? '',
		data: payload.data ?? null,
	};
}

/** The fields the editor may change. */
interface CorrectionDraft {
	kind?: string;
	outcome?: string;
	reply?: string;
	occurredAt?: string;
	notes?: string;
	reason?: string;
}

export default function ActivityCorrectionForm({
	leadId,
	activityId,
	onApplied,
	onCancel,
}: ActivityCorrectionFormProps) {
	const queryClient = useQueryClient();
	const correctionsUrl = `/api/leads/${leadId}/activities/${activityId}/corrections`;
	const [draft, setDraft] = useState<CorrectionDraft>({});
	const [validationError, setValidationError] = useState<string | null>(null);
	const [requestError, setRequestError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [saved, setSaved] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const stateQuery = useQuery({
		queryKey: ['lead-activity-corrections', leadId, activityId],
		queryFn: async () => {
			const response = await callApi(correctionsUrl);
			if (response.status !== 200) {
				throw new Error(
					response.message || 'The activity could not be loaded for correction.'
				);
			}
			const parsed = CorrectionStateSchema.safeParse(response.data);
			if (!parsed.success) {
				throw new Error('The activity could not be loaded for correction.');
			}
			return parsed.data;
		},
	});

	const activity = stateQuery.data?.activity ?? null;
	const corrections: LeadActivityCorrection[] =
		stateQuery.data?.corrections ?? [];

	const currentKind = draft.kind ?? activity?.activity_type ?? '';
	const currentOutcome = draft.outcome ?? activity?.call_outcome ?? '';
	const currentReply =
		draft.reply ??
		(activity?.reply_confirmed === null ||
		activity?.reply_confirmed === undefined
			? 'unknown'
			: activity.reply_confirmed
				? 'yes'
				: 'no');
	const currentOccurredAt =
		draft.occurredAt ?? (activity?.occurred_at ?? '').slice(0, 16);
	const currentNotes = draft.notes ?? activity?.notes ?? '';
	const reason = draft.reason ?? '';

	const handleSubmit = async (
		event: React.FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		setValidationError(null);
		setRequestError(null);
		setConflict(false);
		setSaved(false);
		if (reason.trim() === '') {
			setValidationError('A correction needs a reason.');
			return;
		}
		if (!activity) return;

		const body: Record<string, unknown> = {
			version: activity.version,
			reason: reason.trim(),
		};
		if (
			draft.kind !== undefined &&
			draft.kind !== (activity.activity_type ?? '')
		) {
			body.activity_type = draft.kind;
		}
		if (
			draft.outcome !== undefined &&
			draft.outcome !== (activity.call_outcome ?? '')
		) {
			body.call_outcome = draft.outcome === '' ? null : draft.outcome;
		}
		const replyValue =
			currentReply === 'yes' ? true : currentReply === 'no' ? false : null;
		if (draft.reply !== undefined && replyValue !== activity.reply_confirmed) {
			body.reply_confirmed = replyValue;
		}
		if (
			draft.occurredAt !== undefined &&
			draft.occurredAt !== (activity.occurred_at ?? '').slice(0, 16)
		) {
			body.occurred_at = draft.occurredAt === '' ? null : draft.occurredAt;
		}
		if (draft.notes !== undefined && draft.notes !== (activity.notes ?? '')) {
			body.notes = draft.notes;
		}

		setSubmitting(true);
		const response = await callApi(correctionsUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		setSubmitting(false);
		if (response.status === 409 && response.code === 'correction_conflict') {
			setConflict(true);
			setRequestError(
				response.message ||
					'This activity was corrected by someone else. Reload it and apply your correction to the current values.'
			);
			return;
		}
		if (response.status !== 200) {
			setRequestError(response.message || 'The correction could not be saved.');
			return;
		}
		setDraft({});
		setSaved(true);
		await stateQuery.refetch();
		void queryClient.invalidateQueries({ queryKey: leadKeys.all });
		void queryClient.invalidateQueries({
			queryKey: leadKeys.timeline(leadId),
		});
		onApplied();
	};

	return (
		<div className="mt-3 rounded-md border border-purple-200 bg-purple-50 p-4">
			<h4 className="text-sm font-medium text-gray-900">
				Correct this activity
			</h4>
			{stateQuery.isPending ? (
				<p className="mt-2 text-sm text-gray-600" role="status">
					Loading the activity…
				</p>
			) : null}
			{stateQuery.error instanceof Error ? (
				<p className="mt-2 text-sm text-red-700" role="alert">
					{stateQuery.error.message}
				</p>
			) : null}

			{activity ? (
				<form onSubmit={handleSubmit} className="mt-3 space-y-3">
					<p className="text-xs text-gray-600">
						Version {activity.version}. Only the values you change are sent; the
						values you do not change stay as they are.
					</p>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div>
							<label
								htmlFor={`lead-correction-kind-${activityId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Activity type
							</label>
							<select
								id={`lead-correction-kind-${activityId}`}
								value={currentKind}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										kind: event.target.value,
									}))
								}
								disabled={submitting}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							>
								<option value="">Unknown (not recorded)</option>
								{LEAD_ACTIVITY_TYPES.map((type) => (
									<option key={type} value={type}>
										{type}
									</option>
								))}
							</select>
						</div>
						{currentKind === 'Call' || currentKind === '' ? (
							<div>
								<label
									htmlFor={`lead-correction-outcome-${activityId}`}
									className="block text-sm font-medium text-gray-700 mb-1"
								>
									Call outcome
								</label>
								<select
									id={`lead-correction-outcome-${activityId}`}
									value={currentOutcome}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											outcome: event.target.value,
										}))
									}
									disabled={submitting}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
								>
									<option value="">Unknown (not recorded)</option>
									{LEAD_CALL_OUTCOMES.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</select>
							</div>
						) : null}
						{currentKind === 'Email' ? (
							<div>
								<label
									htmlFor={`lead-correction-reply-${activityId}`}
									className="block text-sm font-medium text-gray-700 mb-1"
								>
									Reply confirmed
								</label>
								<select
									id={`lead-correction-reply-${activityId}`}
									value={currentReply}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											reply: event.target.value,
										}))
									}
									disabled={submitting}
									className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
								>
									<option value="unknown">Unknown (not recorded)</option>
									<option value="yes">Yes, the client replied</option>
									<option value="no">No reply</option>
								</select>
							</div>
						) : null}
						<div>
							<label
								htmlFor={`lead-correction-occurred-${activityId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Occurred at
							</label>
							<input
								id={`lead-correction-occurred-${activityId}`}
								type="datetime-local"
								value={currentOccurredAt}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										occurredAt: event.target.value,
									}))
								}
								disabled={submitting}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</div>
						<div className="md:col-span-2">
							<label
								htmlFor={`lead-correction-notes-${activityId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Notes
							</label>
							<textarea
								id={`lead-correction-notes-${activityId}`}
								value={currentNotes}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										notes: event.target.value,
									}))
								}
								rows={2}
								disabled={submitting}
								placeholder="Plain text only"
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</div>
						<div className="md:col-span-2">
							<label
								htmlFor={`lead-correction-reason-${activityId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Correction reason
							</label>
							<textarea
								id={`lead-correction-reason-${activityId}`}
								value={reason}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										reason: event.target.value,
									}))
								}
								rows={2}
								disabled={submitting}
								placeholder="Why was the activity wrong?"
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</div>
					</div>

					<div aria-live="polite">
						{validationError ? (
							<p className="text-sm text-red-700" role="alert">
								{validationError}
							</p>
						) : null}
						{requestError ? (
							<div className="rounded-md bg-red-50 p-3" role="alert">
								<p className="text-sm font-medium text-red-800">
									{conflict
										? 'This activity changed underneath you.'
										: 'The correction was not saved.'}
								</p>
								<p className="mt-1 text-sm text-red-700">{requestError}</p>
								{conflict ? (
									<button
										type="button"
										onClick={() => {
											setDraft({});
											setConflict(false);
											setRequestError(null);
											void stateQuery.refetch();
										}}
										className="mt-2 text-sm font-medium text-red-800 underline"
									>
										Reload the activity
									</button>
								) : null}
							</div>
						) : null}
						{saved && !validationError && !requestError ? (
							<p className="text-sm text-green-700">
								The correction is saved. The values it replaced stay in the
								correction history.
							</p>
						) : null}
					</div>

					<div className="flex gap-2">
						<button
							type="submit"
							disabled={submitting}
							className="px-4 py-2 bg-[#64126D] text-white text-sm rounded-md hover:bg-[#52105a] disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{submitting ? 'Saving…' : 'Save correction'}
						</button>
						<button
							type="button"
							onClick={onCancel}
							disabled={submitting}
							className="px-4 py-2 border border-gray-300 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
						>
							Cancel
						</button>
					</div>
				</form>
			) : null}

			{corrections.length > 0 ? (
				<div className="mt-4">
					<h5 className="text-sm font-medium text-gray-900">
						Correction history
					</h5>
					<ol className="mt-2 space-y-2">
						{corrections.map((correction) => (
							<li
								key={correction.id}
								className="rounded-md border border-gray-200 bg-white p-3"
							>
								<p className="text-sm text-gray-800">{correction.reason}</p>
								<p className="mt-1 text-xs text-gray-600">
									{correction.actor_name
										? `by ${correction.actor_name}`
										: 'by an unknown user'}
									{correction.corrected_at
										? ` · ${formatDateTime(correction.corrected_at)}`
										: ''}
								</p>
								<ul className="mt-1 text-xs text-gray-700">
									{describeCorrectionChanges(
										correction.previous_values,
										correction.corrected_values
									).map((change) => (
										<li key={change.field}>
											{change.label}: {change.from} → {change.to}
										</li>
									))}
								</ul>
							</li>
						))}
					</ol>
				</div>
			) : null}
		</div>
	);
}
