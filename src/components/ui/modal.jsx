'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { XMarkIcon } from '@heroicons/react/24/outline';

export default function Modal({
	open,
	onClose,
	title,
	children,
	footer,
	size = 'md',
	dismissible = true,
}) {
	const panelRef = useRef(null);

	useEffect(() => {
		if (!open) return undefined;

		const previouslyFocused = document.activeElement;
		panelRef.current?.focus?.();

		const onKey = (e) => {
			if (e.key === 'Escape' && dismissible) {
				onClose?.();
				return;
			}
			// Lightweight focus trap: wrap Tab within the dialog.
			if (e.key === 'Tab' && panelRef.current) {
				const focusables = panelRef.current.querySelectorAll(
					'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
				);
				if (focusables.length === 0) return;
				const first = focusables[0];
				const last = focusables[focusables.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		document.addEventListener('keydown', onKey);
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = '';
			// Restore focus to the trigger that opened the dialog.
			if (previouslyFocused instanceof HTMLElement) {
				previouslyFocused.focus();
			}
		};
	}, [open, onClose, dismissible]);

	// Rendered through a portal: an ancestor with backdrop-filter/transform
	// (e.g. the dashboard's blurred cards) would otherwise become the
	// containing block for position:fixed and freeze the modal off-screen.
	if (!open || typeof document === 'undefined') return null;

	const sizeClass =
		{
			sm: 'max-w-md',
			md: 'max-w-xl',
			lg: 'max-w-3xl',
			xl: 'max-w-5xl',
		}[size] || 'max-w-xl';

	return createPortal(
		<div
			className="anim-modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
			onClick={(e) => {
				if (dismissible && e.target === e.currentTarget) onClose?.();
			}}
		>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				className={cn(
					'anim-modal-panel relative w-full rounded-xl bg-white shadow-2xl ring-1 ring-black/5 my-8 outline-none',
					sizeClass
				)}
			>
				<div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
					<h2 className="text-sm font-semibold text-gray-900">{title}</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close dialog"
						className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]/40"
					>
						<XMarkIcon className="h-4 w-4" aria-hidden />
					</button>
				</div>
				<div className="px-5 py-4">{children}</div>
				{footer ? (
					<div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 bg-gray-50 rounded-b-xl">
						{footer}
					</div>
				) : null}
			</div>
		</div>,
		document.body
	);
}
