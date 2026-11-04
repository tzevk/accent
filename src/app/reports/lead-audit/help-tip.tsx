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
	/** Inverse suits the purple report header. */
	tone?: 'default' | 'inverse';
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
	tone = 'default',
}: HelpTipProps) {
	const id = useId();
	return (
		<span className={`group/help relative inline-flex shrink-0 ${className}`}>
			<button
				type="button"
				aria-label={label}
				aria-describedby={id}
				className={`relative inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold leading-none after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
					tone === 'inverse'
						? 'border-white/60 text-white hover:bg-white/20 focus-visible:ring-white'
						: 'border-gray-400 text-gray-600 hover:bg-gray-100 focus-visible:ring-[#64126D]'
				}`}
			>
				?
			</button>
			<span
				id={id}
				role="tooltip"
				className={`pointer-events-none absolute top-full z-30 mt-1 hidden w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-2 text-left text-xs font-normal leading-normal text-gray-700 shadow-lg group-hover/help:block group-focus-within/help:block ${
					align === 'right' ? 'right-0' : 'left-0'
				}`}
			>
				{children}
			</span>
		</span>
	);
}

export default HelpTip;
