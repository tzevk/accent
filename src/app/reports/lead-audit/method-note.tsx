'use client';

import type { ReactNode } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

interface MethodNoteProps {
	/** The disclosure label, for example How to read these figures. */
	title: string;
	/** One short line under the label; never a paragraph. */
	summary?: string;
	children: ReactNode;
	className?: string;
}

/**
 * A collapsed explanation panel.
 *
 * The decision surfaces keep figures and one-line meanings visible; metric
 * definitions, coverage, exclusions, and filter-scope detail live here. The
 * content is still in the page (and in the accessibility tree once opened),
 * so nothing required by the report contract is removed from the DOM.
 */
export function MethodNote({
	title,
	summary,
	children,
	className = '',
}: MethodNoteProps) {
	return (
		<details
			className={`group rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] sm:p-4 [&::-webkit-details-marker]:hidden">
				<ChevronRightIcon
					className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-90"
					aria-hidden="true"
				/>
				<span className="min-w-0">
					<span className="block text-sm font-bold text-gray-900">{title}</span>
					{summary ? (
						<span className="block text-xs text-gray-600">{summary}</span>
					) : null}
				</span>
			</summary>
			<div className="border-t border-gray-100 p-3 sm:p-4">{children}</div>
		</details>
	);
}

export default MethodNote;
