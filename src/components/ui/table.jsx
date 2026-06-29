'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const Table = forwardRef(function Table({ className, ...props }, ref) {
	return (
		<div className="relative w-full overflow-auto">
			<table
				ref={ref}
				className={cn('w-full caption-bottom text-sm', className)}
				{...props}
			/>
		</div>
	);
});

const TableHeader = forwardRef(function TableHeader(
	{ className, ...props },
	ref
) {
	return (
		<thead
			ref={ref}
			className={cn('bg-gray-50 border-b border-gray-200', className)}
			{...props}
		/>
	);
});

const TableBody = forwardRef(function TableBody({ className, ...props }, ref) {
	return (
		<tbody
			ref={ref}
			className={cn(
				'[&_tr:last-child]:border-0 divide-y divide-gray-200',
				className
			)}
			{...props}
		/>
	);
});

const TableFooter = forwardRef(function TableFooter(
	{ className, ...props },
	ref
) {
	return (
		<tfoot
			ref={ref}
			className={cn(
				'border-t border-gray-200 bg-gray-50 font-medium [&>tr]:last:border-b-0',
				className
			)}
			{...props}
		/>
	);
});

const TableRow = forwardRef(function TableRow({ className, ...props }, ref) {
	return (
		<tr
			ref={ref}
			className={cn(
				'hover:bg-gray-50 transition-colors data-[state=selected]:bg-purple-50',
				className
			)}
			{...props}
		/>
	);
});

const TableHead = forwardRef(function TableHead({ className, ...props }, ref) {
	return (
		<th
			ref={ref}
			className={cn(
				'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap',
				className
			)}
			{...props}
		/>
	);
});

const TableCell = forwardRef(function TableCell({ className, ...props }, ref) {
	return (
		<td
			ref={ref}
			className={cn('px-4 py-3 text-sm text-gray-900 align-middle', className)}
			{...props}
		/>
	);
});

const TableCaption = forwardRef(function TableCaption(
	{ className, ...props },
	ref
) {
	return (
		<caption
			ref={ref}
			className={cn('mt-4 text-sm text-gray-500', className)}
			{...props}
		/>
	);
});

const TableEmpty = forwardRef(function TableEmpty(
	{ className, children, ...props },
	ref
) {
	return (
		<tr ref={ref} {...props}>
			<td
				colSpan={100}
				className={cn(
					'px-4 py-12 text-center text-sm text-gray-500',
					className
				)}
			>
				{children}
			</td>
		</tr>
	);
});

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
	TableEmpty,
};
