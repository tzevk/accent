'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

const variantMap = {
	default:
		'bg-primary text-primary-foreground hover:bg-[#52105a] disabled:bg-primary/40',
	outline:
		'border border-border bg-card text-foreground hover:bg-muted disabled:opacity-50',
	danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/40',
	ghost: 'text-primary hover:bg-muted disabled:opacity-50',
};

const sizeMap = {
	sm: 'h-8 px-3 text-xs',
	md: 'h-9 px-4 text-sm',
	icon: 'h-9 w-9 p-0',
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
				'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring disabled:cursor-not-allowed',
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
