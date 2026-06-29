'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const variantMap = {
	default: 'bg-[#64126D] text-white hover:bg-[#52105a] disabled:bg-purple-300',
	outline:
		'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50',
	danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
	ghost: 'text-[#64126D] hover:bg-purple-50 disabled:opacity-50',
};

const sizeMap = {
	sm: 'h-8 px-3 text-xs',
	md: 'h-9 px-4 text-sm',
	lg: 'h-10 px-5 text-sm',
};

const Button = forwardRef(function Button(
	{
		className,
		variant = 'default',
		size = 'md',
		type = 'button',
		loading = false,
		disabled,
		children,
		...props
	},
	ref
) {
	return (
		<button
			ref={ref}
			type={type}
			disabled={disabled || loading}
			className={cn(
				'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:cursor-not-allowed',
				variantMap[variant] || variantMap.default,
				sizeMap[size] || sizeMap.md,
				className
			)}
			{...props}
		>
			{loading ? (
				<span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
			) : null}
			{children}
		</button>
	);
});

export { Button };
