'use client';

import { useState, useCallback, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { apiGet, apiPost } from '@/lib/api-client';
import {
	CheckCircleIcon,
	ArrowPathIcon,
	ArrowLeftIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

const PRIORITIES = [
	{
		value: 'low',
		label: 'Low',
		color: 'text-gray-700',
		description: 'Can wait',
	},
	{
		value: 'medium',
		label: 'Medium',
		color: 'text-blue-700',
		description: 'Normal',
	},
	{
		value: 'high',
		label: 'High',
		color: 'text-orange-700',
		description: 'Needs attention',
	},
	{
		value: 'critical',
		label: 'Urgent',
		color: 'text-red-700',
		description: 'Critical',
	},
];

const inputClass =
	'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500';

export default function CreateTicketPage() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const errorId = useId();
	const [formError, setFormError] = useState(null);
	const [departmentId, setDepartmentId] = useState('');
	const [formData, setFormData] = useState({
		subject: '',
		description: '',
		priority: 'medium',
		attachment_url: '',
	});

	const departmentsQuery = useQuery({
		queryKey: ['ticket-departments'],
		queryFn: () => apiGet('/api/ticket-departments'),
	});

	const departments = departmentsQuery.data?.data ?? [];
	const selectedDepartment = departments.find(
		(department) => String(department.id) === departmentId
	);
	const departmentsPending = departmentsQuery.isPending;
	const departmentsFailed = departmentsQuery.isError;
	const noDepartments =
		!departmentsPending && !departmentsFailed && departments.length === 0;

	const createTicket = useMutation({
		mutationFn: (payload) => apiPost('/api/tickets', payload),
		onMutate: () => setFormError(null),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ['tickets'] });
			router.push(`/tickets/${result.data.id}`);
		},
		onError: (error) => {
			setFormError(
				error?.message ||
					'We could not create the ticket. Check the form and try again.'
			);
		},
	});

	const handleSubmit = useCallback(
		(e) => {
			e.preventDefault();
			setFormError(null);

			if (departments.length === 0) {
				setFormError(
					'No responsible department is available. A super-admin must configure one before a ticket can be submitted.'
				);
				return;
			}
			if (!departmentId) {
				setFormError('Select the department responsible for this ticket.');
				return;
			}
			if (
				!departments.some(
					(department) => String(department.id) === departmentId
				)
			) {
				setFormError(
					'The selected department is no longer available. Choose another department.'
				);
				return;
			}

			createTicket.mutate({
				...formData,
				attachment_url: formData.attachment_url.trim() || null,
				ticket_department_id: Number(departmentId),
			});
		},
		[createTicket, departmentId, departments, formData]
	);

	const submitBlocked =
		createTicket.isPending ||
		departmentsPending ||
		departmentsFailed ||
		noDepartments;

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="flex pt-2 sm:pl-16">
				<div className="flex-1">
					<div className="px-2 sm:px-3 lg:px-4 py-2">
						{/* Back */}
						<button
							type="button"
							onClick={() => router.push('/tickets')}
							className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
						>
							<ArrowLeftIcon className="h-4 w-4" />
							Back to Tickets
						</button>

						{/* Header */}
						<h1 className="text-2xl font-bold text-gray-900 mb-6">
							New Support Ticket
						</h1>

						{/* Form */}
						<div className="bg-white rounded-lg border border-gray-200 p-6">
							<form onSubmit={handleSubmit} className="space-y-5">
								{departmentsFailed && (
									<div
										role="alert"
										className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4"
									>
										<ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-red-600" />
										<div className="flex-1">
											<p className="text-sm font-medium text-red-900">
												Could not load departments
											</p>
											<p className="text-sm text-red-800 mt-1">
												{departmentsQuery.error?.message ||
													'The department list is unavailable right now.'}
											</p>
											<button
												type="button"
												onClick={() => departmentsQuery.refetch()}
												className="mt-2 text-sm font-medium text-red-900 underline hover:no-underline"
											>
												Try again
											</button>
										</div>
									</div>
								)}

								{formError && (
									<div
										id={errorId}
										role="alert"
										className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4"
									>
										<ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-red-600" />
										<p className="text-sm text-red-800">{formError}</p>
									</div>
								)}

								{/* Responsible department */}
								<div>
									<label
										htmlFor="ticket-department"
										className="block text-sm font-medium text-gray-700 mb-1"
									>
										Responsible department
									</label>

									{departmentsPending ? (
										<div
											className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
											role="status"
										>
											<ArrowPathIcon className="h-4 w-4 animate-spin" />
											Loading departments...
										</div>
									) : noDepartments ? (
										<div
											className="rounded-lg border border-amber-200 bg-amber-50 p-4"
											role="status"
										>
											<p className="text-sm font-medium text-amber-900">
												No department is available
											</p>
											<p className="text-sm text-amber-800 mt-1">
												A super-admin must assign an active role with at least
												one active member to a ticket department under Admin
												&rarr; Tickets before tickets can be submitted.
											</p>
										</div>
									) : (
										<>
											<select
												id="ticket-department"
												required
												value={departmentId}
												onChange={(e) => {
													setDepartmentId(e.target.value);
													setFormError(null);
												}}
												disabled={createTicket.isPending || departmentsFailed}
												aria-describedby="ticket-department-help"
												aria-invalid={Boolean(formError) && !departmentId}
												className={inputClass}
											>
												<option value="">Select a department</option>
												{departments.map((department) => (
													<option
														key={department.id}
														value={String(department.id)}
													>
														{department.name}
													</option>
												))}
											</select>
											<p
												id="ticket-department-help"
												className="mt-1.5 text-xs text-gray-500"
											>
												{selectedDepartment ? (
													<>
														{selectedDepartment.role_name
															? `The ${selectedDepartment.role_name} role handles this department.`
															: 'This department has no responsible role.'}{' '}
														{selectedDepartment.handler_count === 1
															? 'One handler will receive an email alert with the ticket number, subject, priority, and a secure link.'
															: `${selectedDepartment.handler_count} handlers will receive an email alert with the ticket number, subject, priority, and a secure link.`}{' '}
														Your description and attachments are not included in
														the email.
													</>
												) : (
													'The responsible role for the department receives an email alert with the ticket number, subject, priority, and a secure link. Your description and attachments are not included in the email.'
												)}
											</p>
										</>
									)}
								</div>

								{/* Subject */}
								<div>
									<label
										htmlFor="ticket-subject"
										className="block text-sm font-medium text-gray-700 mb-1"
									>
										Subject
									</label>
									<input
										id="ticket-subject"
										type="text"
										required
										value={formData.subject}
										onChange={(e) =>
											setFormData({ ...formData, subject: e.target.value })
										}
										placeholder="Brief summary of your request"
										disabled={createTicket.isPending}
										className={inputClass}
									/>
								</div>

								{/* Description */}
								<div>
									<label
										htmlFor="ticket-description"
										className="block text-sm font-medium text-gray-700 mb-1"
									>
										Description
									</label>
									<textarea
										id="ticket-description"
										required
										value={formData.description}
										onChange={(e) =>
											setFormData({
												...formData,
												description: e.target.value,
											})
										}
										placeholder="Please describe your request in detail..."
										rows={5}
										disabled={createTicket.isPending}
										className={`${inputClass} resize-none`}
									/>
								</div>

								{/* Priority */}
								<fieldset>
									<legend className="block text-sm font-medium text-gray-700 mb-2">
										Priority
									</legend>
									<div className="flex gap-2">
										{PRIORITIES.map((priority) => (
											<button
												key={priority.value}
												type="button"
												aria-pressed={formData.priority === priority.value}
												onClick={() =>
													setFormData({
														...formData,
														priority: priority.value,
													})
												}
												disabled={createTicket.isPending}
												className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border-2 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
													formData.priority === priority.value
														? 'border-[#64126D] bg-purple-50 text-[#64126D]'
														: 'border-gray-200 text-gray-600 hover:border-gray-300'
												}`}
											>
												{priority.label}
											</button>
										))}
									</div>
								</fieldset>

								{/* Attachment URL */}
								<div>
									<label
										htmlFor="ticket-attachment"
										className="block text-sm font-medium text-gray-700 mb-1"
									>
										Attachment URL{' '}
										<span className="text-xs font-normal text-gray-400">
											(optional)
										</span>
									</label>
									<input
										id="ticket-attachment"
										type="url"
										value={formData.attachment_url}
										onChange={(e) =>
											setFormData({
												...formData,
												attachment_url: e.target.value,
											})
										}
										placeholder="https://example.com/file.pdf"
										disabled={createTicket.isPending}
										className={inputClass}
									/>
								</div>

								{/* Buttons */}
								<div className="flex gap-3 pt-3 border-t border-gray-100">
									<button
										type="button"
										onClick={() => router.push('/tickets')}
										disabled={createTicket.isPending}
										className="flex-1 px-4 py-2.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
									>
										Cancel
									</button>
									<button
										type="submit"
										disabled={submitBlocked}
										aria-describedby={formError ? errorId : undefined}
										className="flex-1 px-4 py-2.5 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
									>
										{createTicket.isPending ? (
											<>
												<ArrowPathIcon className="h-4 w-4 animate-spin" />
												Creating...
											</>
										) : (
											<>
												<CheckCircleIcon className="h-4 w-4" />
												Submit Ticket
											</>
										)}
									</button>
								</div>

								{submitBlocked && !createTicket.isPending && (
									<p className="text-xs text-gray-500 text-center">
										{noDepartments
											? 'Ticket submission is blocked until a responsible department is configured.'
											: departmentsFailed
												? 'Ticket submission is blocked until the department list loads.'
												: departmentsPending
													? 'Ticket submission is available once departments load.'
													: ''}
									</p>
								)}
							</form>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
