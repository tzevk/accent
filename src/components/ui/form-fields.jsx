'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const inputBase =
	'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-colors focus:border-ring focus:outline-hidden focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground';

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
				'block text-xs font-semibold text-foreground mb-1',
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
			className={cn('text-[11px] text-muted-foreground mt-1', className)}
			{...props}
		>
			{children}
		</p>
	);
});

function FieldGroup({
	label,
	htmlFor,
	hint,
	error,
	required,
	children,
	className,
}) {
	return (
		<div className={cn('flex flex-col', className)}>
			{label ? (
				<Label htmlFor={htmlFor}>
					{label}
					{required ? <span className="text-destructive ml-0.5">*</span> : null}
				</Label>
			) : null}
			{children}
			{error ? (
				<p className="text-[11px] text-destructive mt-1">{error}</p>
			) : hint ? (
				<FieldHint>{hint}</FieldHint>
			) : null}
		</div>
	);
}

export { Input, Textarea, Select, Label, FieldHint, FieldGroup };
