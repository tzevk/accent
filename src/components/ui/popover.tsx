'use client';

import {
	forwardRef,
	type ComponentPropsWithoutRef,
	type ComponentRef,
} from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

const PopoverContent = forwardRef<
	ComponentRef<typeof PopoverPrimitive.Content>,
	ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
	{
		className,
		align = 'center',
		sideOffset = 8,
		collisionPadding = 12,
		...props
	},
	ref
) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					'z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-lg',
					className
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
});

export {
	Popover,
	PopoverTrigger,
	PopoverContent,
	PopoverClose,
	PopoverTitle,
	PopoverDescription,
};
