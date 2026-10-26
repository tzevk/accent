'use client';

import {
	forwardRef,
	type ComponentPropsWithoutRef,
	type ComponentRef,
} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = forwardRef<
	ComponentRef<typeof TooltipPrimitive.Content>,
	ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent(
	{ className, sideOffset = 6, collisionPadding = 12, ...props },
	ref
) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				ref={ref}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					'z-[60] max-w-[min(18rem,calc(100vw-1.5rem))] rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-md',
					className
				)}
				{...props}
			/>
		</TooltipPrimitive.Portal>
	);
});

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
