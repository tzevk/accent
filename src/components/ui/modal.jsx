'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { XMarkIcon } from '@heroicons/react/24/outline';

export default function Modal({
	open,
	onClose,
	title,
	children,
	footer,
	size = 'md',
}) {
	useEffect(() => {
		if (!open) return undefined;
		const onKey = (e) => {
			if (e.key === 'Escape') onClose?.();
		};
		document.addEventListener('keydown', onKey);
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = '';
		};
	}, [open, onClose]);

	if (!open) return null;

	const sizeClass =
		{
			sm: 'max-w-md',
			md: 'max-w-xl',
			lg: 'max-w-3xl',
			xl: 'max-w-5xl',
		}[size] || 'max-w-xl';

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose?.();
			}}
		>
			<div
				className={cn(
					'relative w-full rounded-xl bg-white shadow-2xl ring-1 ring-black/5 my-8',
					sizeClass
				)}
			>
				<div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
					<h2 className="text-sm font-semibold text-gray-900">{title}</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					>
						<XMarkIcon className="h-4 w-4" />
					</button>
				</div>
				<div className="px-5 py-4">{children}</div>
				{footer ? (
					<div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 bg-gray-50 rounded-b-xl">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	);
}
