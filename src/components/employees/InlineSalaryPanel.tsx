'use client';

import Link from 'next/link';

import { formatCurrency, formatDate } from '@/lib/format';
import type { SalaryProfileResolution } from '@/lib/salary-profile-directory';
import type { EmployeeRecord } from '@/hooks/useEmployeeDirectory';

/** A stored profile value, or null when absent or not a finite number. */
function storedRate(
	profile: Record<string, unknown> | null,
	key: string
): number | null {
	const value = profile?.[key];
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
	return Number.isFinite(parsed) ? parsed : null;
}

function streamLabel(stream: SalaryProfileResolution['pay_stream']): string {
	if (stream === 'contract') return 'Contract';
	if (stream === 'payroll') return 'Payroll';
	return '—';
}

function ctcDisclosure(resolution: SalaryProfileResolution): string {
	const { ctc } = resolution;
	if (ctc.status === 'invalid')
		return `The recorded CTC is invalid (${ctc.invalid_reason || 'unknown reason'}) and is not usable.`;
	if (ctc.status === 'missing') return 'No CTC is recorded for this agreement.';
	if (ctc.legacy_fallback)
		return 'Legacy gross salary reference: no explicit employer-cost CTC is recorded for this agreement.';
	if (ctc.source === 'employer_cost')
		return 'Recorded employer cost (explicit CTC).';
	return 'Resolved from the recorded salary agreement.';
}

/**
 * Authorized salary summary for one Employee row. It reads the shared resolve
 * projection for the requested anchor: the covering agreement, its disclosed
 * CTC (explicit employer cost or a labelled legacy gross fallback) and an
 * explicit unavailable/ambiguous state. No figure is guessed from the current
 * profile and no salary write exists here - the workspace owns the editor.
 */
export default function InlineSalaryPanel({
	employee,
	resolution,
	loading,
	error,
	workspaceHref,
}: {
	employee: EmployeeRecord;
	resolution: SalaryProfileResolution | null | undefined;
	loading: boolean;
	error: string;
	workspaceHref: string;
}) {
	const workspaceLink = (
		<Link
			href={workspaceHref}
			className="font-medium text-purple-600 hover:text-purple-800"
		>
			Open salary workspace →
		</Link>
	);
	const hourlyRate = resolution
		? storedRate(resolution.profile, 'hourly_rate')
		: null;
	const dailyRate = resolution
		? storedRate(resolution.profile, 'daily_rate')
		: null;

	return (
		<div className="space-y-3" data-testid={`inline-salary-${employee.id}`}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="text-xs font-semibold uppercase text-gray-500">
						Salary summary
					</p>
					<p className="text-sm text-gray-600">
						{resolution
							? `As of ${formatDate(resolution.anchor)}`
							: 'Covering salary agreement'}
					</p>
				</div>
				{workspaceLink}
			</div>

			{loading ? (
				<p className="py-3 text-center text-sm text-gray-500">
					Loading salary summary...
				</p>
			) : error ? (
				<p role="alert" className="py-3 text-sm text-red-700">
					{error}
				</p>
			) : !resolution ? (
				<p className="py-3 text-sm text-gray-500">
					No authorized salary summary was returned for this employee.
				</p>
			) : resolution.state === 'ambiguous' ? (
				<div
					role="status"
					className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
				>
					The salary agreement is ambiguous at {formatDate(resolution.anchor)}:{' '}
					{resolution.conflict_ids.length} conflicting agreements cover this
					date. No salary figure is shown until the workspace resolves them.
				</div>
			) : resolution.state === 'unavailable' ? (
				<div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
					No salary agreement covers {formatDate(resolution.anchor)}. Employee
					Type does not decide this: the agreement&apos;s Salary Type selects
					Payroll or Contract.
				</div>
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center text-blue-800">
							<p className="text-[10px] font-medium uppercase">Monthly CTC</p>
							<p className="text-lg font-bold">
								{resolution.ctc.status === 'resolved' &&
								resolution.ctc.amount !== null
									? formatCurrency(resolution.ctc.amount)
									: resolution.ctc.status === 'invalid'
										? 'Invalid'
										: 'Not recorded'}
							</p>
						</div>
						<div className="rounded-lg border border-gray-200 bg-white p-3 text-center text-gray-700">
							<p className="text-[10px] font-medium uppercase">Salary Type</p>
							<p className="text-lg font-bold">
								{resolution.salary_type || '—'}
							</p>
						</div>
						<div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-center text-purple-800">
							<p className="text-[10px] font-medium uppercase">Stream</p>
							<p className="text-lg font-bold">
								{streamLabel(resolution.pay_stream)}
							</p>
						</div>
						<div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center text-green-800">
							<p className="text-[10px] font-medium uppercase">Coverage</p>
							<p className="text-sm font-semibold">
								Effective{' '}
								{resolution.effective_from
									? formatDate(resolution.effective_from)
									: '—'}{' '}
								→{' '}
								{resolution.effective_to
									? formatDate(resolution.effective_to)
									: 'Ongoing'}
							</p>
						</div>
					</div>
					<p className="text-xs text-gray-600">{ctcDisclosure(resolution)}</p>
					{(hourlyRate !== null || dailyRate !== null) && (
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
							<p className="font-semibold uppercase">
								Stored legacy rates (reference only)
							</p>
							{hourlyRate !== null && (
								<p>Hourly: {formatCurrency(hourlyRate)}</p>
							)}
							{dailyRate !== null && <p>Daily: {formatCurrency(dailyRate)}</p>}
							<p>
								These recorded rates are not operative; payroll uses the
								covering agreement&apos;s CTC and Basis Hours.
							</p>
						</div>
					)}
				</>
			)}
		</div>
	);
}
