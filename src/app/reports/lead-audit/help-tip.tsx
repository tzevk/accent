'use client';

import { useId, type ReactNode } from 'react';

interface HelpTipProps {
	/** Accessible name of the help control, e.g. "About Leads recorded". */
	label: string;
	/** The explanatory sentence shown on hover and keyboard focus. */
	children: ReactNode;
	className?: string;
	/** Open the panel toward the left edge; use near a card's right edge. */
	align?: 'left' | 'right';
}

/**
 * The report's inline explanation affordance.
 *
 * Decision surfaces keep labels and figures; the supporting sentence lives
 * behind this question mark, revealed on hover or keyboard focus. The text
 * stays in the accessibility tree and is announced through
 * `aria-describedby`, so a pointer is not required to reach it.
 */
export function HelpTip({
	label,
	children,
	className = '',
	align = 'left',
}: HelpTipProps) {
	const id = useId();
	return (
		<span className={`group/help relative inline-flex shrink-0 ${className}`}>
			<button
				type="button"
				aria-label={label}
				aria-describedby={id}
				className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-400 text-[11px] font-bold leading-none text-gray-600 after:absolute after:-inset-2 after:content-[''] hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-1"
			>
				?
			</button>
			<span
				id={id}
				role="tooltip"
				className={`pointer-events-none absolute top-full z-30 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-2 text-left text-xs font-normal leading-normal text-gray-700 opacity-0 shadow-lg group-hover/help:opacity-100 group-focus-within/help:opacity-100 motion-safe:transition-opacity ${
					align === 'right' ? 'right-0' : 'left-0'
				}`}
			>
				{children}
			</span>
		</span>
	);
}

export default HelpTip;
