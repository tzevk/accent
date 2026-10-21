'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
	PhoneIcon,
	EnvelopeIcon,
	UserIcon,
	CalendarDaysIcon,
	ChatBubbleLeftRightIcon,
	ArrowRightIcon,
} from '@heroicons/react/24/outline';

/**
 * The Lead work queue: the outstanding scheduled work of every Lead, soonest
 * first. The rows come from the Lead activity log, so a scheduled item and a
 * completed one never look the same.
 */
export default function UpcomingFollowups({ limit = 10 }) {
	const [work, setWork] = useState([]);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);

	const fetchWork = useCallback(async () => {
		try {
			setLoading(true);
			setFailed(false);
			const res = await fetch(`/api/leads/work?scope=upcoming&limit=${limit}`);
			const data = await res.json();

			if (data.success && data.data && Array.isArray(data.data.work)) {
				setWork(data.data.work);
			} else {
				setFailed(true);
			}
		} catch (error) {
			console.error('Error fetching lead work:', error);
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}, [limit]);

	useEffect(() => {
		fetchWork();
	}, [fetchWork]);

	const getTypeIcon = (type) => {
		const t = (type || '').toLowerCase();
		if (t.includes('call') || t.includes('phone')) return PhoneIcon;
		if (t.includes('email') || t.includes('mail')) return EnvelopeIcon;
		if (t.includes('meeting') || t.includes('visit')) return UserIcon;
		return ChatBubbleLeftRightIcon;
	};

	const getDateLabel = (dateStr) => {
		if (!dateStr) return 'No date';
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const date = new Date(dateStr);
		date.setHours(0, 0, 0, 0);

		const diffDays = Math.round((date - now) / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		if (diffDays === -1) return 'Yesterday';
		if (diffDays <= 7 && diffDays > 0) return `In ${diffDays} days`;

		return new Date(dateStr).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
		});
	};

	const formatDate = (dateStr) => {
		if (!dateStr) return '-';
		return new Date(dateStr).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
		});
	};

	if (loading) {
		return (
			<div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
				<div className="px-6 py-4 border-b border-purple-200">
					<div className="h-6 w-48 bg-gray-200 rounded animate-pulse"></div>
				</div>
				<div className="p-6">
					<div className="space-y-3">
						{[...Array(5)].map((_, i) => (
							<div
								key={i}
								className="h-16 bg-gray-100 rounded animate-pulse"
							></div>
						))}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-purple-200">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-white border border-purple-200 rounded-lg flex items-center justify-center">
							<ChatBubbleLeftRightIcon className="h-5 w-5 text-[#64126D]" />
						</div>
						<div>
							<h3 className="text-lg font-semibold text-gray-900">
								Follow-ups
							</h3>
							<p className="text-sm text-gray-500">{work.length} scheduled</p>
						</div>
					</div>
				</div>
			</div>

			{/* Lead work */}
			<div className="divide-y divide-gray-100">
				{failed ? (
					<div className="px-6 py-12 text-center" role="alert">
						<ChatBubbleLeftRightIcon className="h-12 w-12 mx-auto mb-3 text-red-300" />
						<p className="text-red-700 font-medium">
							The follow-up list could not be loaded
						</p>
						<p className="text-sm text-gray-500 mt-1">Try again in a moment.</p>
					</div>
				) : work.length === 0 ? (
					<div className="px-6 py-12 text-center">
						<ChatBubbleLeftRightIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
						<p className="text-gray-500 font-medium">No follow-ups found</p>
						<p className="text-sm text-gray-400 mt-1">
							Follow-ups will appear here when scheduled
						</p>
					</div>
				) : (
					work.map((item) => {
						const TypeIcon = getTypeIcon(item.activity_type);
						const dateLabel = getDateLabel(item.scheduled_for);
						const isToday = dateLabel === 'Today';

						return (
							<Link
								key={item.id}
								href={`/leads/${item.lead_id}`}
								className={`block px-6 py-4 hover:bg-purple-50/40 transition-colors cursor-pointer ${
									isToday ? 'bg-orange-50/30' : ''
								}`}
							>
								<div className="flex items-start gap-4">
									{/* Type Icon */}
									<div
										className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
											isToday ? 'bg-orange-100' : 'bg-purple-100'
										}`}
									>
										<TypeIcon
											className={`h-5 w-5 ${
												isToday ? 'text-orange-600' : 'text-[#64126D]'
											}`}
										/>
									</div>

									{/* Content */}
									<div className="flex-1 min-w-0">
										<div className="flex items-start justify-between gap-3">
											<div className="flex-1 min-w-0">
												<p className="font-medium text-gray-900 truncate">
													{item.company_name || 'Unknown Company'}
												</p>
												<p className="text-sm text-gray-500 truncate">
													{item.activity_type || 'Follow-up'}
												</p>
											</div>

											{/* Date Badge */}
											<span className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-blue-100 text-blue-700 border border-blue-200">
												{dateLabel}
											</span>
										</div>

										{/* Next Action */}
										{item.next_action && (
											<div className="flex items-center gap-1.5 mt-2 text-xs text-purple-600">
												<ArrowRightIcon className="h-3 w-3" />
												<span className="font-medium">Next:</span>
												<span className="truncate">{item.next_action}</span>
											</div>
										)}

										{/* Footer Info */}
										<div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
											<span className="flex items-center gap-1">
												<CalendarDaysIcon className="h-3 w-3" />
												{formatDate(item.scheduled_for)}
											</span>
											{item.status && (
												<span className="flex items-center gap-1">
													{item.status}
												</span>
											)}
										</div>
									</div>
								</div>
							</Link>
						);
					})
				)}
			</div>

			{/* Footer */}
			{work.length > limit && (
				<div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm">
					<Link
						href="/leads"
						className="text-[#64126D] font-medium hover:underline flex items-center gap-1"
					>
						View all follow-ups
						<ArrowRightIcon className="h-4 w-4" />
					</Link>
				</div>
			)}
		</div>
	);
}
