'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const inputBase =
	'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-[#64126D] focus:outline-none focus:ring-1 focus:ring-[#64126D] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

const Input = forwardRef(function Input(
	{ className, type = 'text', ...props },
	ref
) {
	return (
		<input
			ref={ref}
			type={type}
			className={cn(inputBase, className)}
			{...props}
		/>
	);
});

const Textarea = forwardRef(function Textarea(
	{ className, rows = 3, ...props },
	ref
) {
	return (
		<textarea
			ref={ref}
			rows={rows}
			className={cn(inputBase, 'resize-y min-h-[80px]', className)}
			{...props}
		/>
	);
});

const Select = forwardRef(function Select(
	{ className, children, ...props },
	ref
) {
	return (
		<select ref={ref} className={cn(inputBase, 'pr-8', className)} {...props}>
			{children}
		</select>
	);
});

const Label = forwardRef(function Label(
	{ className, children, ...props },
	ref
) {
	return (
		<label
			ref={ref}
			className={cn(
				'block text-xs font-semibold text-gray-700 mb-1',
				className
			)}
			{...props}
		>
			{children}
		</label>
	);
});

const FieldHint = forwardRef(function FieldHint(
	{ className, children, ...props },
	ref
) {
	return (
		<p
			ref={ref}
			className={cn('text-[11px] text-gray-500 mt-1', className)}
			{...props}
		>
			{children}
		</p>
	);
});

function FieldGroup({ label, hint, error, required, children, className }) {
	return (
		<div className={cn('flex flex-col', className)}>
			{label ? (
				<Label>
					{label}
					{required ? <span className="text-rose-500 ml-0.5">*</span> : null}
				</Label>
			) : null}
			{children}
			{error ? (
				<p className="text-[11px] text-rose-600 mt-1">{error}</p>
			) : hint ? (
				<FieldHint>{hint}</FieldHint>
			) : null}
		</div>
	);
}

export { Input, Textarea, Select, Label, FieldHint, FieldGroup };
