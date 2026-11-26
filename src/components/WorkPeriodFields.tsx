'use client';

import { useId } from 'react';

export type WorkPeriodFieldsValue = {
	start: string;
	end: string;
	quantity: string | number;
	dateCompleted: string;
	remarks: string;
};

export type WorkPeriodFieldsProps = {
	value: WorkPeriodFieldsValue;
	onChange: (next: WorkPeriodFieldsValue) => void;
	disabled?: boolean;
};

const controlClass =
	'min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base shadow-sm transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 sm:text-sm';

/** Shared controlled fields for Employee and manager Work Period forms. */
export function WorkPeriodFields({
	value,
	onChange,
	disabled = false,
}: WorkPeriodFieldsProps) {
	const id = useId();
	const startId = `${id}-start`;
	const endId = `${id}-end`;
	const quantityId = `${id}-quantity`;
	const dateCompletedId = `${id}-date-completed`;
	const remarksId = `${id}-remarks`;
	const timeZoneHintId = `${id}-time-zone-hint`;
	const update = (patch: Partial<WorkPeriodFieldsValue>) =>
		onChange({ ...value, ...patch });

	return (
		<div lang="en-IN" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div className="min-w-0">
				<label
					htmlFor={startId}
					className="mb-1 block text-sm font-semibold text-gray-700 after:ml-0.5 after:text-red-600 after:content-['*']"
				>
					Start (IST)
				</label>
				<input
					id={startId}
					name="start"
					type="datetime-local"
					step="60"
					autoComplete="off"
					required
					disabled={disabled}
					value={value.start}
					onChange={(event) => update({ start: event.target.value })}
					aria-describedby={timeZoneHintId}
					className={controlClass}
				/>
			</div>
			<div className="min-w-0">
				<label
					htmlFor={endId}
					className="mb-1 block text-sm font-semibold text-gray-700 after:ml-0.5 after:text-red-600 after:content-['*']"
				>
					End (IST)
				</label>
				<input
					id={endId}
					name="end"
					type="datetime-local"
					step="60"
					autoComplete="off"
					required
					disabled={disabled}
					value={value.end}
					onChange={(event) => update({ end: event.target.value })}
					aria-describedby={timeZoneHintId}
					className={controlClass}
				/>
			</div>
			<div className="min-w-0">
				<label
					htmlFor={quantityId}
					className="mb-1 block text-sm font-semibold text-gray-700"
				>
					Quantity
				</label>
				<input
					id={quantityId}
					name="quantity"
					type="number"
					min="0"
					step="0.01"
					inputMode="decimal"
					autoComplete="off"
					disabled={disabled}
					value={value.quantity}
					onChange={(event) => update({ quantity: event.target.value })}
					className={controlClass}
				/>
			</div>
			<div className="min-w-0">
				<label
					htmlFor={dateCompletedId}
					className="mb-1 block text-sm font-semibold text-gray-700 after:ml-0.5 after:text-red-600 after:content-['*']"
				>
					Date Completed
				</label>
				<input
					id={dateCompletedId}
					name="dateCompleted"
					type="date"
					autoComplete="off"
					required
					disabled={disabled}
					value={value.dateCompleted}
					onChange={(event) => update({ dateCompleted: event.target.value })}
					className={controlClass}
				/>
			</div>
			<div className="min-w-0 sm:col-span-2 lg:col-span-4">
				<label
					htmlFor={remarksId}
					className="mb-1 block text-sm font-semibold text-gray-700"
				>
					Remarks
				</label>
				<textarea
					id={remarksId}
					name="remarks"
					rows={2}
					disabled={disabled}
					value={value.remarks}
					onChange={(event) => update({ remarks: event.target.value })}
					className={`${controlClass} min-h-20 resize-y`}
				/>
			</div>
			<p
				id={timeZoneHintId}
				className="text-xs text-gray-600 sm:col-span-2 lg:col-span-4"
			>
				Enter both endpoints as YYYY-MM-DD HH:MM in India Standard Time (IST).
			</p>
		</div>
	);
}
