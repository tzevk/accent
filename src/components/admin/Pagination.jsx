'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export default function Pagination({ page, totalPages, total, onPageChange }) {
	if (!totalPages || totalPages <= 1) {
		return total > 0 ? (
			<div className="text-xs text-gray-500 px-2">
				Showing {total} record{total === 1 ? '' : 's'}
			</div>
		) : null;
	}

	const prev = Math.max(1, page - 1);
	const next = Math.min(totalPages, page + 1);

	return (
		<div className="flex items-center justify-between px-2 py-2 text-xs text-gray-600">
			<div>
				Page <span className="font-semibold text-gray-900">{page}</span> of{' '}
				<span className="font-semibold text-gray-900">{totalPages}</span>
				<span className="ml-2 text-gray-500">({total} records)</span>
			</div>
			<div className="flex gap-1">
				<button
					type="button"
					onClick={() => onPageChange(prev)}
					disabled={page <= 1}
					className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<ChevronLeftIcon className="h-3.5 w-3.5" />
					Prev
				</button>
				<button
					type="button"
					onClick={() => onPageChange(next)}
					disabled={page >= totalPages}
					className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Next
					<ChevronRightIcon className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}
