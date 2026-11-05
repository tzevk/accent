'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { TICKET_STATUSES } from '@/lib/tickets/constants';
import {
	TicketIcon,
	ArrowLeftIcon,
	ChatBubbleLeftRightIcon,
	PaperClipIcon,
	ArrowPathIcon,
	ClockIcon,
	UserIcon,
	BuildingOffice2Icon,
} from '@heroicons/react/24/outline';

const PRIORITIES = [
	{
		value: 'low',
		label: 'Low',
		color: 'bg-gray-100 text-gray-700 border-gray-300',
	},
	{
		value: 'medium',
		label: 'Medium',
		color: 'bg-blue-100 text-blue-700 border-blue-300',
	},
	{
		value: 'high',
		label: 'High',
		color: 'bg-orange-100 text-orange-700 border-orange-300',
	},
	{
		value: 'critical',
		label: 'Urgent',
		color: 'bg-red-100 text-red-700 border-red-300',
	},
];

/** Badge colours for the persisted ticket statuses; labels come from the shared enum. */
const STATUS_COLORS = {
	open: 'bg-blue-100 text-blue-800',
	in_progress: 'bg-yellow-100 text-yellow-800',
	pending_info: 'bg-orange-100 text-orange-800',
	resolved: 'bg-green-100 text-green-800',
	closed: 'bg-gray-100 text-gray-800',
};

const selectClass =
	'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500';

export default function TicketDetailPage() {
	const params = useParams();
	const router = useRouter();
	const queryClient = useQueryClient();
	const ticketId = params.id;

	const [newComment, setNewComment] = useState('');
	const [isInternalNote, setIsInternalNote] = useState(false);
	const [commentError, setCommentError] = useState(null);
	const [nextStatus, setNextStatus] = useState('');
	const [resolutionNotes, setResolutionNotes] = useState('');
	const [statusError, setStatusError] = useState(null);

	const ticketQuery = useQuery({
		queryKey: ['tickets', 'detail', String(ticketId)],
		queryFn: () => apiGet(`/api/tickets/${ticketId}`),
		enabled: Boolean(ticketId),
		staleTime: 0,
		refetchOnWindowFocus: true,
		retry: false,
	});

	const ticket = ticketQuery.data?.data ?? null;

	const refreshTicket = () => {
		// The detail query lives under the tickets prefix, so this also refreshes
		// the list and any capability booleans cached for this ticket.
		queryClient.invalidateQueries({ queryKey: ['tickets'] });
	};

	const commentMutation = useMutation({
		mutationFn: (payload) => apiPost(`/api/tickets/${ticketId}`, payload),
		onMutate: () => setCommentError(null),
		onSuccess: () => {
			setNewComment('');
			setIsInternalNote(false);
			refreshTicket();
		},
		onError: (error) => {
			setCommentError(
				error?.message || 'We could not send your reply. Please try again.'
			);
			refreshTicket();
		},
	});

	const statusMutation = useMutation({
		mutationFn: (payload) =>
			apiPut('/api/tickets', { id: Number(ticketId), ...payload }),
		onMutate: () => setStatusError(null),
		onSuccess: () => {
			setNextStatus('');
			setResolutionNotes('');
			refreshTicket();
		},
		onError: (error) => {
			setStatusError(
				error?.message || 'We could not update the status. Please try again.'
			);
			refreshTicket();
		},
	});

	const handleAddComment = (e) => {
		e.preventDefault();
		setCommentError(null);
		if (!newComment.trim()) {
			setCommentError('Enter a reply before sending.');
			return;
		}
		commentMutation.mutate({
			comment: newComment.trim(),
			is_internal: isInternalNote,
		});
	};

	const effectiveStatus = nextStatus || ticket?.status || '';
	const needsResolutionNotes =
		effectiveStatus === 'resolved' || effectiveStatus === 'closed';

	const handleStatusUpdate = (e) => {
		e.preventDefault();
		setStatusError(null);
		if (!ticket) return;
		if (effectiveStatus === ticket.status) {
			setStatusError('Choose a different status to update this ticket.');
			return;
		}
		const payload = { status: effectiveStatus };
		if (needsResolutionNotes && resolutionNotes.trim()) {
			payload.resolution_notes = resolutionNotes.trim();
		}
		statusMutation.mutate(payload);
	};

	const getStatusBadge = (status) => {
		const config = TICKET_STATUSES.find((s) => s.value === status);
		if (!config) {
			return (
				<span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
					{status || 'Unknown'}
				</span>
			);
		}
		return (
			<span
				className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[config.value] || 'bg-gray-100 text-gray-700'}`}
			>
				{config.label}
			</span>
		);
	};

	const getPriorityBadge = (priority) => {
		const p = PRIORITIES.find((p) => p.value === priority);
		if (!p) return priority;
		return (
			<span
				className={`px-2 py-0.5 text-xs font-medium rounded-full border ${p.color}`}
			>
				{p.label}
			</span>
		);
	};

	if (ticketQuery.isPending) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<Sidebar />
				<div className="flex pt-16 sm:pl-16">
					<div className="flex-1">
						<div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
							<div className="text-center py-16">
								<ArrowPathIcon className="h-6 w-6 text-gray-400 animate-spin mx-auto mb-3" />
								<p className="text-sm text-gray-500">Loading ticket...</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (ticketQuery.isError || !ticket) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<Sidebar />
				<div className="flex pt-16 sm:pl-16">
					<div className="flex-1">
						<div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
							<div
								role="alert"
								className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-center"
							>
								<TicketIcon className="h-12 w-12 text-red-300 mx-auto mb-3" />
								<p className="text-sm font-medium text-red-900">
									This ticket could not be opened
								</p>
								<p className="text-sm text-red-800 mt-1">
									{ticketQuery.error?.message ||
										'The ticket may have been removed, or you no longer have access to it.'}
								</p>
								<button
									type="button"
									onClick={() => router.push('/tickets')}
									className="mt-3 px-4 py-2 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785]"
								>
									Back to Tickets
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	const supportReply = (comment) => comment.user_id !== ticket.user_id;

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<Sidebar />

			<div className="flex pt-16 sm:pl-16">
				<div className="flex-1">
					<div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
						{/* Back */}
						<button
							type="button"
							onClick={() => router.push('/tickets')}
							className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
						>
							<ArrowLeftIcon className="h-4 w-4" />
							Back to Tickets
						</button>

						{/* Ticket Header */}
						<div className="mb-6">
							<div className="flex items-center gap-2 mb-2 flex-wrap">
								<span className="text-xs font-mono text-gray-400">
									{ticket.ticket_number}
								</span>
								{getStatusBadge(ticket.status)}
								{getPriorityBadge(ticket.priority)}
							</div>
							<h1 className="text-xl font-bold text-gray-900">
								{ticket.subject}
							</h1>
							<div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
								<span className="flex items-center gap-1">
									<UserIcon className="h-3.5 w-3.5" />
									{ticket.user_name}
								</span>
								<span className="flex items-center gap-1">
									<ClockIcon className="h-3.5 w-3.5" />
									{formatDateTime(ticket.created_at)}
								</span>
								{ticket.ticket_department_name && (
									<span className="flex items-center gap-1">
										<BuildingOffice2Icon className="h-3.5 w-3.5" />
										{ticket.ticket_department_name}
										{ticket.ticket_role_name && ` · ${ticket.ticket_role_name}`}
									</span>
								)}
							</div>
						</div>

						{/* Waiting for the employee */}
						{ticket.status === 'pending_info' && (
							<div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-5">
								<p className="text-sm font-medium text-orange-800">
									This ticket is waiting for the employee to provide the
									requested information.
								</p>
							</div>
						)}

						{/* Description */}
						<div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
							<h2 className="text-sm font-semibold text-gray-700 mb-2">
								Description
							</h2>
							<p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
								{ticket.description}
							</p>
						</div>

						{/* Attachment */}
						{ticket.attachment_url && (
							<div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
								<div className="flex items-center gap-2">
									<PaperClipIcon className="h-4 w-4 text-gray-400" />
									<a
										href={ticket.attachment_url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm text-[#64126D] hover:underline break-all"
									>
										{ticket.attachment_url}
									</a>
								</div>
							</div>
						)}

						{/* Resolution */}
						{ticket.resolution_notes && (
							<div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
								<h2 className="text-sm font-semibold text-green-800 mb-1">
									Resolution
								</h2>
								<p className="text-sm text-green-900 whitespace-pre-wrap">
									{ticket.resolution_notes}
								</p>
								{ticket.resolved_at && (
									<p className="text-xs text-green-700 mt-2">
										Resolved on {formatDateTime(ticket.resolved_at)}
										{ticket.resolved_by_name &&
											` by ${ticket.resolved_by_name}`}
									</p>
								)}
							</div>
						)}

						{/* Sidebar Info */}
						<div className="flex flex-wrap gap-4 mb-5">
							<div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-2">
								<div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-[#64126D]">
									<BuildingOffice2Icon className="h-3.5 w-3.5" />
								</div>
								<div>
									<p className="text-xs text-gray-500">
										Responsible department
									</p>
									<p className="text-sm font-medium text-gray-900">
										{ticket.ticket_department_name || 'Not routed'}
									</p>
									<p className="text-xs text-gray-600">
										{ticket.ticket_role_name
											? `Role: ${ticket.ticket_role_name}`
											: ticket.ticket_department_name
												? 'No responsible role configured'
												: 'No responsible role'}
									</p>
								</div>
							</div>
							{ticket.assigned_to_name && (
								<div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-2">
									<div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-[#64126D] text-xs font-bold">
										{ticket.assigned_to_name.charAt(0).toUpperCase()}
									</div>
									<div>
										<p className="text-xs text-gray-500">Assigned to</p>
										<p className="text-sm font-medium text-gray-900">
											{ticket.assigned_to_name}
										</p>
									</div>
								</div>
							)}
							{ticket.updated_at && ticket.updated_at !== ticket.created_at && (
								<div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
									<p className="text-xs text-gray-500">Last updated</p>
									<p className="text-sm font-medium text-gray-900">
										{formatDateTime(ticket.updated_at)}
									</p>
								</div>
							)}
						</div>

						{/* Status update — only when the server says this viewer may update it */}
						{ticket.can_update_status && (
							<div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
								<h2 className="text-sm font-semibold text-gray-900 mb-3">
									Update status
								</h2>
								<form onSubmit={handleStatusUpdate} className="space-y-3">
									<div>
										<label
											htmlFor="ticket-status"
											className="block text-sm font-medium text-gray-700 mb-1"
										>
											Status
										</label>
										<select
											id="ticket-status"
											value={effectiveStatus}
											onChange={(e) => {
												setNextStatus(e.target.value);
												setStatusError(null);
											}}
											disabled={statusMutation.isPending}
											className={`${selectClass} sm:max-w-xs`}
										>
											{!TICKET_STATUSES.some(
												(s) => s.value === ticket.status
											) && (
												<option value={ticket.status}>{ticket.status}</option>
											)}
											{TICKET_STATUSES.map((status) => (
												<option key={status.value} value={status.value}>
													{status.label}
												</option>
											))}
										</select>
									</div>

									{needsResolutionNotes && (
										<div>
											<label
												htmlFor="ticket-resolution-notes"
												className="block text-sm font-medium text-gray-700 mb-1"
											>
												Resolution notes{' '}
												<span className="text-xs font-normal text-gray-400">
													(optional)
												</span>
											</label>
											<textarea
												id="ticket-resolution-notes"
												value={resolutionNotes}
												onChange={(e) => setResolutionNotes(e.target.value)}
												rows={3}
												disabled={statusMutation.isPending}
												placeholder="What fixed the issue?"
												className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-500"
											/>
										</div>
									)}

									{statusError && (
										<p
											role="alert"
											className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
										>
											{statusError}
										</p>
									)}
									{statusMutation.isSuccess && !statusMutation.isPending && (
										<p className="text-sm text-green-700" role="status">
											Status updated.
										</p>
									)}

									<div className="flex justify-end">
										<button
											type="submit"
											disabled={
												statusMutation.isPending ||
												effectiveStatus === ticket.status
											}
											className="px-4 py-2 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
										>
											{statusMutation.isPending ? (
												<>
													<ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
													Saving...
												</>
											) : (
												'Save status'
											)}
										</button>
									</div>
								</form>
							</div>
						)}

						{/* Comments */}
						<div className="bg-white rounded-lg border border-gray-200 p-5">
							<h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-1.5">
								<ChatBubbleLeftRightIcon className="h-4 w-4" />
								Comments ({ticket.comments?.length || 0})
							</h2>

							{ticket.comments && ticket.comments.length > 0 ? (
								<div className="space-y-3 mb-5">
									{ticket.comments.map((comment) => {
										const isSupport = supportReply(comment);
										return (
											<div
												key={comment.id}
												className={`rounded-lg p-3 ${
													comment.is_internal
														? 'bg-amber-50 border-l-2 border-amber-400'
														: isSupport
															? 'bg-green-50 border-l-2 border-green-400'
															: 'bg-gray-50 border-l-2 border-gray-300'
												}`}
											>
												<div className="flex items-center justify-between mb-1 gap-2">
													<div className="flex items-center gap-1.5 flex-wrap">
														<span className="text-sm font-medium text-gray-900">
															{comment.user_name}
														</span>
														{isSupport && (
															<span className="text-[10px] px-1.5 py-0.5 bg-green-200 text-green-800 rounded font-medium">
																Support
															</span>
														)}
														{Boolean(comment.is_internal) && (
															<span className="text-[10px] px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded font-medium">
																Internal note
															</span>
														)}
													</div>
													<span className="text-xs text-gray-400 shrink-0">
														{formatDateTime(comment.created_at)}
													</span>
												</div>
												<p className="text-sm text-gray-700 whitespace-pre-wrap">
													{comment.comment}
												</p>
											</div>
										);
									})}
								</div>
							) : (
								<div className="text-center py-6 mb-4">
									<p className="text-xs text-gray-400">No comments yet</p>
								</div>
							)}

							{/* Reply */}
							{ticket.status === 'closed' ? (
								<div className="border-t border-gray-100 pt-4 text-center">
									<p className="text-xs text-gray-400">This ticket is closed</p>
								</div>
							) : ticket.can_update_status ? (
								<form
									onSubmit={handleAddComment}
									className="border-t border-gray-100 pt-4 space-y-3"
								>
									<div>
										<label
											htmlFor="ticket-reply"
											className="block text-sm font-medium text-gray-700 mb-1"
										>
											Reply
										</label>
										<textarea
											id="ticket-reply"
											value={newComment}
											onChange={(e) => setNewComment(e.target.value)}
											placeholder={
												ticket.status === 'pending_info'
													? 'Provide the requested information...'
													: 'Write a reply...'
											}
											rows={3}
											disabled={commentMutation.isPending}
											aria-invalid={Boolean(commentError)}
											className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-500 ${
												ticket.status === 'pending_info'
													? 'border-orange-300 bg-orange-50'
													: 'border-gray-300'
											}`}
										/>
									</div>

									{ticket.can_reassign && (
										<div className="flex items-start gap-2">
											<input
												id="ticket-internal-note"
												type="checkbox"
												checked={isInternalNote}
												onChange={(e) => setIsInternalNote(e.target.checked)}
												disabled={commentMutation.isPending}
												className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#64126D] focus:ring-[#64126D]"
											/>
											<label
												htmlFor="ticket-internal-note"
												className="text-sm text-gray-700"
											>
												Internal note
												<span className="block text-xs text-gray-500">
													Hidden from the employee. Only super-admins can add
													internal notes.
												</span>
											</label>
										</div>
									)}

									{commentError && (
										<p
											role="alert"
											className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
										>
											{commentError}
										</p>
									)}

									<div className="flex justify-end">
										<button
											type="submit"
											disabled={!newComment.trim() || commentMutation.isPending}
											className="px-4 py-2 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
										>
											{commentMutation.isPending ? (
												<>
													<ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
													Sending...
												</>
											) : (
												'Send Reply'
											)}
										</button>
									</div>
								</form>
							) : (
								<div className="border-t border-gray-100 pt-4 text-center">
									<p className="text-xs text-gray-400">
										You can view this ticket but cannot reply to it.
									</p>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
