'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
	LEAD_ACTIVITY_TYPES,
	LEAD_CALL_OUTCOMES,
	type LeadActivityType,
} from '@/lib/lead-activities';
import { apiPost } from '@/lib/api-client';
import { leadKeys } from '@/components/leads/queries';
import type { LeadActivityResponse } from '@/components/leads/types';

interface LeadActivityFormProps {
	leadId: string;
	canRecord: boolean;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, not an ISO instant. */
function toLocalInputValue(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}`
	);
}

/**
 * Record one Lead activity: a call, an email, a meeting, or a plain-text
 * note, with the dated next action it schedules in the same interaction.
 *
 * The server owns the stage and the rules; this form only collects what the
 * person did and sends it. Notes stay plain text.
 */
export default function LeadActivityForm({
	leadId,
	canRecord,
}: LeadActivityFormProps) {
	const queryClient = useQueryClient();
	const [activityType, setActivityType] = useState<LeadActivityType>('Call');
	// The outcome is never guessed: a call without a chosen outcome is
	// refused before it is sent.
	const [callOutcome, setCallOutcome] = useState('');
	const [replyConfirmed, setReplyConfirmed] = useState(false);
	const [occurredAt, setOccurredAt] = useState(() =>
		toLocalInputValue(new Date())
	);
	const [notes, setNotes] = useState('');
	const [scheduleNext, setScheduleNext] = useState(false);
	const [nextActionType, setNextActionType] =
		useState<LeadActivityType>('Call');
	const [scheduledFor, setScheduledFor] = useState('');
	const [nextActionText, setNextActionText] = useState('');
	const [validationError, setValidationError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const activityMutation = useMutation<
		LeadActivityResponse,
		Error,
		Record<string, unknown>
	>({
		mutationFn: (body) =>
			apiPost<LeadActivityResponse>(`/api/leads/${leadId}/activities`, body),
		onSuccess: (response) => {
			setNotice(
				response.data.next_action_date
					? `Activity recorded. Next action: ${response.data.next_action_date}.`
					: 'Activity recorded.'
			);
			setNotes('');
			setValidationError(null);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			void queryClient.invalidateQueries({
				queryKey: leadKeys.timeline(leadId),
			});
		},
	});

	if (!canRecord) {
		return (
			<p className="text-sm text-gray-600">
				You do not have permission to record lead activity.
			</p>
		);
	}

	const saving = activityMutation.isPending;
	const requestError = activityMutation.error?.message ?? null;

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		activityMutation.reset();
		setNotice(null);
		if (activityType === 'Call' && !callOutcome) {
			setValidationError('A call needs its outcome.');
			return;
		}
		if (scheduleNext && !scheduledFor) {
			setValidationError('The next action needs its date.');
			return;
		}
		setValidationError(null);

		const body: Record<string, unknown> = {
			activity_type: activityType,
			notes: notes.trim() === '' ? undefined : notes,
		};
		if (occurredAt) body.occurred_at = occurredAt;
		if (activityType === 'Call') body.call_outcome = callOutcome;
		if (activityType === 'Email') body.reply_confirmed = replyConfirmed;
		if (scheduleNext) {
			body.next_action = {
				activity_type: nextActionType,
				scheduled_for: scheduledFor,
				next_action: nextActionText.trim() === '' ? undefined : nextActionText,
			};
		}
		activityMutation.mutate(body);
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<label
						htmlFor={`lead-activity-type-${leadId}`}
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Activity type
					</label>
					<select
						id={`lead-activity-type-${leadId}`}
						value={activityType}
						onChange={(event) =>
							setActivityType(event.target.value as LeadActivityType)
						}
						disabled={saving}
						className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
					>
						{LEAD_ACTIVITY_TYPES.map((type) => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>
				</div>
				{activityType === 'Call' ? (
					<div>
						<label
							htmlFor={`lead-activity-outcome-${leadId}`}
							className="block text-sm font-medium text-gray-700 mb-1"
						>
							Call outcome
						</label>
						<select
							id={`lead-activity-outcome-${leadId}`}
							value={callOutcome}
							onChange={(event) => setCallOutcome(event.target.value)}
							disabled={saving}
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
						>
							<option value="">Choose an outcome</option>
							{LEAD_CALL_OUTCOMES.map((outcome) => (
								<option key={outcome} value={outcome}>
									{outcome}
								</option>
							))}
						</select>
					</div>
				) : null}
				{activityType === 'Email' ? (
					<div className="md:col-span-2">
						<label className="flex items-center gap-2 text-sm font-medium text-gray-700">
							<input
								type="checkbox"
								checked={replyConfirmed}
								onChange={(event) => setReplyConfirmed(event.target.checked)}
								disabled={saving}
								className="h-4 w-4 rounded border-gray-300"
							/>
							The client replied to this email
						</label>
					</div>
				) : null}
				<div>
					<label
						htmlFor={`lead-activity-occurred-${leadId}`}
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Occurred at
					</label>
					<input
						id={`lead-activity-occurred-${leadId}`}
						type="datetime-local"
						value={occurredAt}
						onChange={(event) => setOccurredAt(event.target.value)}
						disabled={saving}
						className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
					/>
				</div>
				<div className="md:col-span-2">
					<label
						htmlFor={`lead-activity-notes-${leadId}`}
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Notes
					</label>
					<textarea
						id={`lead-activity-notes-${leadId}`}
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						rows={3}
						disabled={saving}
						placeholder="Plain text only"
						className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
					/>
				</div>
			</div>

			<fieldset className="border-t border-gray-200 pt-4">
				<legend className="text-sm font-medium text-gray-700">
					Next action
				</legend>
				<label className="flex items-center gap-2 text-sm text-gray-700 mt-2">
					<input
						type="checkbox"
						checked={scheduleNext}
						onChange={(event) => setScheduleNext(event.target.checked)}
						disabled={saving}
						className="h-4 w-4 rounded border-gray-300"
					/>
					Schedule the next action now
				</label>
				{scheduleNext ? (
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
						<div>
							<label
								htmlFor={`lead-next-action-type-${leadId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Next action type
							</label>
							<select
								id={`lead-next-action-type-${leadId}`}
								value={nextActionType}
								onChange={(event) =>
									setNextActionType(event.target.value as LeadActivityType)
								}
								disabled={saving}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							>
								{LEAD_ACTIVITY_TYPES.map((type) => (
									<option key={type} value={type}>
										{type}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor={`lead-next-action-date-${leadId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Next action date
							</label>
							<input
								id={`lead-next-action-date-${leadId}`}
								type="date"
								value={scheduledFor}
								onChange={(event) => setScheduledFor(event.target.value)}
								disabled={saving}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</div>
						<div>
							<label
								htmlFor={`lead-next-action-text-${leadId}`}
								className="block text-sm font-medium text-gray-700 mb-1"
							>
								Next action description
							</label>
							<input
								id={`lead-next-action-text-${leadId}`}
								type="text"
								value={nextActionText}
								onChange={(event) => setNextActionText(event.target.value)}
								disabled={saving}
								className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</div>
					</div>
				) : null}
			</fieldset>

			<div aria-live="polite">
				{validationError ? (
					<p className="text-sm text-red-600" role="alert">
						{validationError}
					</p>
				) : null}
				{requestError ? (
					<p className="text-sm text-red-600" role="alert">
						{requestError}
					</p>
				) : null}
				{notice && !validationError && !requestError ? (
					<p className="text-sm text-green-700">{notice}</p>
				) : null}
			</div>

			<button
				type="submit"
				disabled={saving}
				className="px-4 py-2 bg-[#64126D] text-white text-sm rounded-md hover:bg-[#52105a] disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{saving ? 'Recording…' : 'Record activity'}
			</button>
		</form>
	);
}
