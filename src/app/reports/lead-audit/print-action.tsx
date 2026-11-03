'use client';

import { PrinterIcon } from '@heroicons/react/24/outline';

/**
 * The secondary Print action for the management summary (#406).
 *
 * Browser printing only: no server-side PDF renderer, no popup window, and no
 * `reports:export` requirement. The page disables the action while the report
 * is loading or has failed, because printing an incomplete or failed report
 * would present a blank or stale summary as the management record.
 */
export interface PrintActionProps {
	/** True while the report is loading, failed, or has no body yet. */
	disabled?: boolean;
	/** Why printing is unavailable; shown only as accessible description. */
	disabledReason?: string;
}

export default function PrintAction({
	disabled = false,
	disabledReason = 'The summary can be printed once the report has loaded.',
}: PrintActionProps) {
	const handlePrint = () => {
		if (disabled) return;
		window.print();
	};

	return (
		<button
			type="button"
			onClick={handlePrint}
			disabled={disabled}
			title={disabled ? disabledReason : 'Print the management summary'}
			className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<PrinterIcon className="h-4 w-4" aria-hidden="true" />
			Print summary
		</button>
	);
}
