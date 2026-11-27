import { useState } from 'react';
import { ClockIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';

const segments = [
	{
		key: 'hour',
		label: 'Hour',
		options: Array.from({ length: 12 }, (_, index) =>
			String(index || 12).padStart(2, '0')
		),
	},
	{
		key: 'minute',
		label: 'Minute',
		options: Array.from({ length: 60 }, (_, minute) =>
			String(minute).padStart(2, '0')
		),
	},
	{ key: 'meridiem', label: 'AM/PM', options: ['AM', 'PM'] },
] as const;

type ClockParts = Record<(typeof segments)[number]['key'], string>;

function clockParts(value: string): ClockParts {
	if (!value) return { hour: '', minute: '00', meridiem: '' };
	const hour = Number(value.slice(0, 2));
	return {
		hour: String(hour % 12 || 12).padStart(2, '0'),
		minute: value.slice(3, 5),
		meridiem: hour < 12 ? 'AM' : 'PM',
	};
}

export function formatWorkPeriodClock(value: string) {
	const { hour, minute, meridiem } = clockParts(value);
	return `${hour}:${minute} ${meridiem}`;
}

type WorkPeriodTimePickerProps = {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	describedBy?: string;
	disabled: boolean;
};

// ReUI's Hour / Minute / AM/PM popover, adapted to Accent's Radix popover
// and native radio keyboard behavior. https://reui.io/docs/components/radix/time-picker
export function WorkPeriodTimePicker({
	id,
	label,
	value,
	onChange,
	describedBy,
	disabled,
}: WorkPeriodTimePickerProps) {
	const [draft, setDraft] = useState(() => clockParts(value));
	const canApply = Boolean(draft.hour && draft.meridiem);

	return (
		<Popover onOpenChange={(open) => open && setDraft(clockParts(value))}>
			<PopoverTrigger
				id={id}
				type="button"
				aria-labelledby={`${id}-label ${id}-value`}
				aria-describedby={describedBy}
				disabled={disabled}
				className="inline-flex min-h-7 w-full items-center justify-center gap-1 rounded border border-input bg-background px-1 text-xs tabular-nums whitespace-nowrap text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:border-ring disabled:opacity-50"
			>
				<span id={`${id}-label`} className="sr-only">
					{label}
				</span>
				<span
					id={`${id}-value`}
					className={cn(!value && 'text-muted-foreground')}
				>
					{value ? formatWorkPeriodClock(value) : 'Pick time'}
				</span>
				<ClockIcon
					aria-hidden="true"
					className="hidden size-3 shrink-0 text-muted-foreground @min-[76rem]:block"
				/>
			</PopoverTrigger>
			<PopoverContent
				aria-label={label}
				align="start"
				sideOffset={4}
				onOpenAutoFocus={(event) => {
					if (!(event.target instanceof HTMLElement)) return;
					const panel = event.target;
					const hours = panel.querySelector('[role="group"]');
					const firstHour = hours?.querySelector<HTMLInputElement>('input');
					const selectedHour =
						hours?.querySelector<HTMLInputElement>('input:checked');
					event.preventDefault();
					(selectedHour ?? firstHour)?.focus({ preventScroll: true });
					for (const checked of panel.querySelectorAll('input:checked')) {
						const row = checked.closest('label');
						const column = row?.parentElement;
						if (row && column) {
							column.scrollTop =
								row.offsetTop - (column.clientHeight - row.offsetHeight) / 2;
						}
					}
				}}
				className="max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto border-border bg-popover p-0 text-popover-foreground"
			>
				<div className="grid grid-cols-3 divide-x divide-border" dir="ltr">
					{segments.map(({ key, label: columnLabel, options }) => (
						<div
							role="group"
							aria-label={columnLabel}
							key={key}
							className="min-w-0"
						>
							<div
								className="px-2 pt-2 pb-1 text-center text-xs text-muted-foreground"
								aria-hidden="true"
							>
								{columnLabel}
							</div>
							<div className="relative flex h-40 flex-col gap-1 overflow-y-auto overscroll-contain px-2 py-1">
								{options.map((option) => (
									<label
										key={option}
										className="relative grid min-h-7 shrink-0 cursor-pointer place-items-center rounded-md text-sm tabular-nums select-none hover:bg-accent has-checked:bg-primary has-checked:font-medium has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring forced-colors:has-checked:bg-[Highlight] forced-colors:has-checked:text-[HighlightText]"
									>
										<input
											className="sr-only"
											type="radio"
											name={`${id}-${key}`}
											checked={draft[key] === option}
											onChange={() =>
												setDraft((current) => ({ ...current, [key]: option }))
											}
										/>
										{option}
									</label>
								))}
							</div>
						</div>
					))}
				</div>
				<div className="flex justify-end gap-2 border-t border-border p-2 text-xs font-semibold">
					<PopoverClose
						type="button"
						className="min-h-8 rounded-md px-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
					>
						Cancel
					</PopoverClose>
					<PopoverClose
						type="button"
						disabled={!canApply}
						className="min-h-8 rounded-md bg-primary px-3 text-primary-foreground enabled:hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
						onClick={() => {
							const hour =
								(Number(draft.hour) % 12) + (draft.meridiem === 'PM' ? 12 : 0);
							onChange(`${String(hour).padStart(2, '0')}:${draft.minute}`);
						}}
					>
						OK
					</PopoverClose>
				</div>
			</PopoverContent>
		</Popover>
	);
}
