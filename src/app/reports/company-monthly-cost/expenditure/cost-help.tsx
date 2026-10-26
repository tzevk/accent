'use client';

import { InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
	PopoverClose,
	PopoverTitle,
	PopoverDescription,
} from '@/components/ui/popover';
import {
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from '@/components/ui/tooltip';
import { COST_DEFINITIONS } from './shared';

const definitions = Object.entries(COST_DEFINITIONS);

/** Optional definitions supplement the visible cost basis and missing-data warnings. */
export function CostLabel({ term }: { term: keyof typeof COST_DEFINITIONS }) {
	const definition = COST_DEFINITIONS[term];
	return (
		<span className="inline-flex max-w-full items-center gap-1">
			<span>{definition.label}</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label={`About ${definition.label.toLowerCase()}`}
						className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
					>
						<InformationCircleIcon aria-hidden="true" className="h-4 w-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent>{definition.description}</TooltipContent>
			</Tooltip>
		</span>
	);
}

export function CostHelp() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="max-w-full shrink-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
				>
					<InformationCircleIcon
						aria-hidden="true"
						className="h-4 w-4 shrink-0"
					/>
					How costs are calculated
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[28rem] flex-col overflow-hidden p-0"
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 p-4">
					<div>
						<PopoverTitle className="text-sm font-semibold">
							How costs are calculated
						</PopoverTitle>
						<PopoverDescription className="mt-1 text-xs leading-relaxed text-gray-600">
							Monthly expenditure combines confirmed costs and salary estimates.
							It is not available funds, cash paid, or remaining budget.
						</PopoverDescription>
					</div>
					<PopoverClose asChild>
						<button
							type="button"
							aria-label="Close cost explanation"
							className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
						>
							<XMarkIcon aria-hidden="true" className="h-5 w-5" />
						</button>
					</PopoverClose>
				</div>
				<section
					tabIndex={0}
					aria-label="Cost definitions"
					className="min-h-0 overflow-y-auto overscroll-contain p-4 text-xs leading-relaxed text-gray-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#64126D]"
				>
					<p className="rounded-lg bg-purple-50 p-3 font-medium text-[#64126D]">
						Monthly expenditure = confirmed cost + salary estimates not already
						recorded.
					</p>
					<p className="mt-3">
						Project cost + Company overhead + Unallocated cost = Monthly
						expenditure, when currencies can be combined.
					</p>
					<dl className="mt-4 space-y-4">
						{definitions.map(([key, definition]) => (
							<div key={key}>
								<dt className="font-semibold text-gray-900">
									{definition.label}
								</dt>
								<dd className="mt-0.5">{definition.description}</dd>
							</div>
						))}
					</dl>
					<p className="mt-4 border-t border-gray-200 pt-3">
						Project filters change the detail, not company totals. Currencies
						are never combined without supported conversion evidence.
					</p>
				</section>
			</PopoverContent>
		</Popover>
	);
}
