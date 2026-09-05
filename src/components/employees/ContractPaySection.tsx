'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import usePayrollPreview from '@/hooks/usePayrollPreview';
import {
	datePart,
	enabled,
	num,
	timePart,
	today,
	type SalaryProfileRecord,
} from '@/components/employees/SalaryProfileSection';
import { formatCurrency, formatDate } from '@/lib/format';
import { sub, toNumber } from '@/lib/money';
import type { EmployeeRecord } from '@/hooks/useEmployeeDirectory';

const DURATION_OPTIONS: { value: string; label: string }[] = [
	{ value: 'monthly', label: 'Monthly' },
	{ value: 'quarterly', label: 'Quarterly' },
	{ value: 'half_yearly', label: '6 Months' },
	{ value: 'yearly', label: 'Yearly' },
	{ value: 'project', label: 'Project' },
];

/**
 * Contract editor fields plus the stored agreement values the save must
 * round-trip unchanged (loans, advances, PL, working hours) so editing a
 * contract from this page never wipes data owned elsewhere.
 */
interface ContractFormState {
	contract_amount: string;
	contract_duration: string;
	contract_end_date: string;
	tds_percentage: string;
	effective_from: string;
	effective_to: string;
	std_in_time: string;
	std_out_time: string;
	pl_total: string;
	pl_used: string;
	pl_balance: string;
	loan_amount: string;
	loan_amount_per_month: string;
	loan_no_of_months: string;
	loan_total_amount: string;
	loan_active: boolean;
	advance_amount: string;
	advance_active: boolean;
}

const createEmptyContractForm = (): ContractFormState => ({
	contract_amount: '',
	contract_duration: 'monthly',
	contract_end_date: '',
	tds_percentage: '',
	effective_from: today(),
	effective_to: '',
	std_in_time: '09:00',
	std_out_time: '17:30',
	pl_total: '21',
	pl_used: '0',
	pl_balance: '21',
	loan_amount: '',
	loan_amount_per_month: '',
	loan_no_of_months: '',
	loan_total_amount: '',
	loan_active: false,
	advance_amount: '',
	advance_active: false,
});

const profileAmount = (profile: SalaryProfileRecord): number => {
	if (profile.salary_type === 'contract') return num(profile.contract_amount);
	if (profile.salary_type === 'lumpsum') return num(profile.lumpsum_amount);
	return num(profile.gross_salary);
};
/**
 * Route-owned Contract pay workflow: agreement history and the contract
 * editor (amount, duration, end date, TDS) with TDS derived through the
 * shared calculation boundary, including the documented 10% fallback.
 */
export default function ContractPaySection({
	employee,
}: {
	employee: EmployeeRecord;
}) {
	const employeeId = employee.id;

	const [form, setForm] = useState<ContractFormState>(createEmptyContractForm);
	const [editingId, setEditingId] = useState<number | string | null>(null);
	const [storedOverrideFlag, setStoredOverrideFlag] = useState(false);
	const [saving, setSaving] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const autoLoadedForRef = useRef<number | string | null>(null);

	const update = useCallback((patch: Partial<ContractFormState>) => {
		setForm((previous) => ({ ...previous, ...patch }));
	}, []);

	const profilesQuery = useQuery({
		queryKey: ['salary-profiles', employeeId],
		queryFn: async () => {
			const data = (await apiGet('/api/payroll/salary-profile', {
				employee_id: employeeId,
			})) as { success?: boolean; data?: SalaryProfileRecord[] };
			return data.data || [];
		},
		enabled: Boolean(employeeId),
	});
	const profiles = profilesQuery.data || [];

	const loadProfile = useCallback(
		(profile: SalaryProfileRecord) => {
			setEditingId(profile.id);
			setStoredOverrideFlag(enabled(profile.is_manual_override));
			setForm({
				...createEmptyContractForm(),
				contract_amount: String(profile.contract_amount ?? ''),
				contract_duration: profile.contract_duration || 'monthly',
				contract_end_date: datePart(profile.contract_end_date),
				// A stored rate of 0/blank behaves like "no explicit rate": the
				// documented Contract fallback applies (matching the previous UI).
				tds_percentage: num(profile.tds_percentage)
					? String(num(profile.tds_percentage))
					: '',
				effective_from: datePart(profile.effective_from) || today(),
				effective_to: datePart(profile.effective_to),
				std_in_time: timePart(profile.std_in_time, '09:00'),
				std_out_time: timePart(profile.std_out_time, '17:30'),
				pl_total: String(num(profile.pl_total) || 21),
				pl_used: String(num(profile.pl_used)),
				pl_balance: String(num(profile.pl_balance)),
				loan_amount: String(profile.loan_amount ?? ''),
				loan_amount_per_month: String(profile.loan_amount_per_month ?? ''),
				loan_no_of_months: String(profile.loan_no_of_months ?? ''),
				loan_total_amount: String(profile.loan_total_amount ?? ''),
				loan_active: enabled(profile.loan_active),
				advance_amount: String(profile.advance_amount ?? ''),
				advance_active: enabled(profile.advance_active),
			});
			// Privilege Leave usage comes from the attendance records, matching the
			// previous employee page behavior on the contract edit path.
			void (async () => {
				try {
					const year = new Date().getFullYear();
					const data = (await apiGet('/api/attendance/summary', {
						year,
						employee_id: profile.employee_id ?? employeeId,
					})) as {
						success?: boolean;
						data?: { total_privilege_leave?: unknown }[];
					};
					if (!data.success || !data.data) return;
					const used = data.data.reduce(
						(sum, row) =>
							sum + (parseInt(String(row.total_privilege_leave)) || 0),
						0
					);
					const total = parseInt(String(profile.pl_total)) || 21;
					setForm((previous) => ({
						...previous,
						pl_used: String(used),
						pl_balance: String(Math.max(0, total - used)),
					}));
				} catch {
					// PL usage stays at the stored value when attendance is unavailable.
				}
			})();
		},
		[employeeId]
	);

	// Entering the workflow loads the latest contract agreement, matching the
	// previous employee page behavior when the salary tab opened.
	useEffect(() => {
		const list = profilesQuery.data || [];
		if (!list.length || autoLoadedForRef.current === employeeId) return;
		autoLoadedForRef.current = employeeId;
		const contractProfile = list.find(
			(profile) => profile.salary_type === 'contract'
		);
		if (contractProfile) loadProfile(contractProfile);
	}, [employeeId, loadProfile, profilesQuery.data]);

	const resetForm = useCallback(() => {
		setEditingId(null);
		setStoredOverrideFlag(false);
		setForm(createEmptyContractForm());

		setErrorMessage('');
	}, []);

	// The TDS formula (stored profile rate, else the Contract fallback) lives
	// in the shared calculation boundary; the editor only displays its result.
	const draftProfile = useMemo(
		() => ({
			salary_type: 'contract',
			gross_salary: form.contract_amount,
			tds_percentage:
				form.tds_percentage === '' ? undefined : form.tds_percentage,
		}),
		[form.contract_amount, form.tds_percentage]
	);
	const { preview } = usePayrollPreview({
		employeeId,
		salaryProfile: draftProfile,
	});

	const amount = num(form.contract_amount);
	const inHand =
		amount > 0 && preview ? toNumber(sub(amount, preview.tds)) : null;
	const tdsHint =
		!amount || !preview
			? '💡 No PF/ESIC. 10% TDS will be deducted by default.'
			: `💡 No PF/ESIC. TDS @ ${preview.tds_percentage}% = ${formatCurrency(preview.tds)} | In-Hand CTC: ${formatCurrency(inHand ?? amount)}`;

	const saveProfile = async () => {
		if (!employeeId) {
			setErrorMessage('No employee selected');
			return;
		}
		if (!form.contract_amount) {
			setErrorMessage('Please enter contract amount');
			return;
		}

		setSaving(true);
		setErrorMessage('');
		setSuccessMessage('');
		try {
			const payload: Record<string, unknown> = {
				...(editingId ? { id: editingId } : {}),
				employee_id: employeeId,
				salary_type: 'contract',
				effective_from: form.effective_from || today(),
				effective_to: form.effective_to || null,
				da_year: new Date().getFullYear(),
				is_manual_override: storedOverrideFlag,
				std_in_time: form.std_in_time || '09:00',
				std_out_time: form.std_out_time || '17:30',
				pl_total: parseInt(form.pl_total) || 0,
				pl_used: parseInt(form.pl_used) || 0,
				pl_balance: parseInt(form.pl_balance) || 0,
				loan_amount: num(form.loan_amount),
				loan_amount_per_month: num(form.loan_amount_per_month),
				loan_no_of_months: parseInt(form.loan_no_of_months) || 0,
				loan_total_amount: num(form.loan_total_amount),
				loan_active: form.loan_active,
				advance_amount: num(form.advance_amount),
				advance_active: form.advance_active,
				contract_amount: amount,
				contract_duration: form.contract_duration || 'monthly',
				contract_end_date: form.contract_end_date || null,
				// The resolved rate is persisted, matching the previous behavior
				// that wrote the explicit fallback when no rate was stored.
				tds_percentage: preview?.tds_percentage ?? 10,
				gross_salary: amount,
				net_pay: inHand ?? amount,
				employer_cost: amount,
			};

			await apiPost('/api/payroll/salary-profile', payload);

			setSuccessMessage(
				editingId
					? '✓ Salary profile updated!'
					: '✓ New salary profile created!'
			);
			await profilesQuery.refetch();
			resetForm();
			setTimeout(() => setSuccessMessage(''), 4000);
		} catch (error) {
			setErrorMessage(
				`Failed to save: ${(error as Error).message || 'unknown error'}`
			);
		} finally {
			setSaving(false);
		}
	};

	const deleteProfile = async (profileId: number | string) => {
		if (
			!window.confirm(
				'Are you sure you want to delete this contract agreement? This action cannot be undone.'
			)
		) {
			return;
		}
		try {
			await apiDelete(`/api/payroll/salary-profile?id=${profileId}`);
			if (editingId === profileId) resetForm();
			await profilesQuery.refetch();
			setSuccessMessage('Contract agreement deleted successfully');
			setTimeout(() => setSuccessMessage(''), 3000);
		} catch (error) {
			setErrorMessage(
				`Failed to delete: ${(error as Error).message || 'unknown error'}`
			);
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-lg font-semibold text-gray-900">Contract Pay</h3>
				<span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
					Salary Type: Contract
				</span>
			</div>

			{successMessage && (
				<div
					role="status"
					className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800"
				>
					{successMessage}
				</div>
			)}
			{errorMessage && (
				<div
					role="alert"
					className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
				>
					{errorMessage}
				</div>
			)}

			{profilesQuery.isPending ? (
				<p className="text-sm text-gray-500">Loading contract agreements...</p>
			) : profilesQuery.error ? (
				<p role="alert" className="text-sm text-red-700">
					{profilesQuery.error instanceof Error
						? profilesQuery.error.message
						: 'Failed to load contract agreements'}
				</p>
			) : profiles.length > 0 ? (
				<div className="space-y-2">
					<h4 className="text-sm font-medium text-gray-700">
						Salary Profile History
					</h4>
					{profiles.map((profile) => {
						const isContract = profile.salary_type === 'contract';
						return (
							<div
								key={String(profile.id)}
								className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
									editingId === profile.id
										? 'border-amber-300 bg-amber-50'
										: 'border-gray-200 bg-white'
								}`}
							>
								<div>
									<div className="flex items-center gap-2">
										<span
											className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
												isContract
													? 'bg-amber-100 text-amber-800'
													: 'bg-gray-100 text-gray-600'
											}`}
										>
											{isContract
												? 'Contract'
												: profile.salary_type === 'custom'
													? 'Legacy Custom'
													: 'Payroll (Monthly)'}
										</span>
										<span className="text-sm font-medium text-gray-900">
											{formatCurrency(profileAmount(profile))}
										</span>
										{isContract && profile.tds_percentage ? (
											<span className="text-xs text-gray-500">
												TDS: {num(profile.tds_percentage)}%
											</span>
										) : null}
									</div>
									<p className="text-xs text-gray-500">
										Effective: {formatDate(datePart(profile.effective_from))}
										{profile.effective_to
											? ` → ${formatDate(datePart(profile.effective_to))}`
											: ' → open'}
									</p>
									{!isContract && (
										<p className="text-xs text-gray-400">
											{profile.salary_type === 'custom'
												? 'Legacy custom agreement — values shown as stored'
												: 'Payroll Salary Profile — managed on the Payroll route'}
										</p>
									)}
								</div>
								{isContract && (
									<div className="flex gap-2">
										<button
											type="button"
											onClick={() => loadProfile(profile)}
											className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100"
										>
											{editingId === profile.id ? 'Editing' : 'Edit'}
										</button>
										<button
											type="button"
											onClick={() => void deleteProfile(profile.id)}
											className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100"
										>
											Delete
										</button>
									</div>
								)}
							</div>
						);
					})}
				</div>
			) : (
				<p className="text-sm text-gray-500">
					No contract agreement yet. Add one below.
				</p>
			)}

			<div
				className={`rounded-xl border-2 bg-white p-4 ${
					editingId ? 'border-amber-300' : 'border-gray-200'
				}`}
			>
				<div className="mb-4 flex items-center justify-between">
					<h4 className="text-base font-semibold text-gray-900">
						{editingId ? 'Edit Contract Agreement' : 'New Contract Agreement'}
					</h4>
					{editingId && (
						<button
							type="button"
							onClick={resetForm}
							className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
						>
							Cancel Edit
						</button>
					)}
				</div>
				<div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
					<div>
						<label
							htmlFor="contract-amount"
							className="mb-1 block text-xs font-medium text-gray-600"
						>
							Amount (₹) *
						</label>
						<input
							id="contract-amount"
							type="number"
							value={form.contract_amount}
							onChange={(event) =>
								update({ contract_amount: event.target.value })
							}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
							placeholder="0"
						/>
					</div>
					<div>
						<label
							htmlFor="contract-duration"
							className="mb-1 block text-xs font-medium text-gray-600"
						>
							Duration
						</label>
						<select
							id="contract-duration"
							value={form.contract_duration || 'monthly'}
							onChange={(event) =>
								update({ contract_duration: event.target.value })
							}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
						>
							{DURATION_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					<div>
						<label
							htmlFor="contract-end-date"
							className="mb-1 block text-xs font-medium text-gray-600"
						>
							End Date
						</label>
						<input
							id="contract-end-date"
							type="date"
							value={form.contract_end_date || ''}
							onChange={(event) =>
								update({ contract_end_date: event.target.value })
							}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
						/>
					</div>
				</div>
				<div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
					<p className="text-xs text-amber-700">{tdsHint}</p>
					<button
						type="button"
						onClick={() => void saveProfile()}
						disabled={saving || !form.contract_amount}
						className={`rounded-lg px-5 py-2 text-sm font-medium text-white shadow transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
							editingId
								? 'bg-blue-600 hover:bg-blue-700'
								: 'bg-amber-600 hover:bg-amber-700'
						}`}
					>
						{saving ? '⏳' : editingId ? 'Update' : '+ Add'}
					</button>
				</div>
			</div>
		</div>
	);
}
