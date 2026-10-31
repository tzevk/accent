'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
	BanknotesIcon,
	PlusIcon,
	TrashIcon,
	ArrowLeftIcon,
	CheckIcon,
} from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import { formatCurrency, formatDateInput } from '@/lib/format';
import { add, div } from '@/lib/money';

const inputClassName =
	'w-full min-w-0 min-h-[40px] rounded-md border border-gray-300 bg-white px-3 py-2 text-base shadow-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]';
const labelClassName = 'mb-1 block text-sm font-medium text-gray-700';
const helperClassName = 'mt-1 text-sm text-gray-600 break-words';
const hintClassName = 'mt-1 text-sm text-gray-600';
const sectionClassName =
	'rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6';

const optionLabel = (options, value) =>
	options.find((o) => o.value === value)?.label || '';

// Total-only parsing: invalid input counts as 0, valid decimals pass through
// to the money helpers. Raw line-item strings still persist untouched.
const toMoneyNumber = (value) => {
	if (value === '' || value === null || value === undefined) return 0;
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
};

export default function NewCashVoucherPage() {
	const router = useRouter();
	const { user, loading: authLoading } = useSessionRBAC();
	const [saving, setSaving] = useState(false);
	const [employees, setEmployees] = useState([]);
	const [projects, setProjects] = useState([]);
	const [descriptions, setDescriptions] = useState([]);
	const [accountHeads, setAccountHeads] = useState([]);

	// Form state
	const [formData, setFormData] = useState({
		voucher_number: '',
		voucher_date: new Date().toISOString().split('T')[0],
		paid_to: '',
		project_number: '',
		payment_mode: 'cash', // cash or cheque
		total_amount: 0,
		amount_in_words: '',
		prepared_by: '',
		checked_by: '',
		approved_by: '',
		receiver_signature: '',
		description: '',
		notes: '',
	});

	// Line items
	const [lineItems, setLineItems] = useState([
		{
			sr_no: 1,
			bill_date: '',
			bill_no: '',
			account_head: '',
			amount_rs: '',
			amount_ps: '',
			description: '',
		},
	]);

	// Fetch next voucher number and employees
	useEffect(() => {
		const fetchVoucherNumber = async () => {
			try {
				const res = await fetch('/api/admin/cash-vouchers/next-number');
				const data = await res.json();
				if (data.success) {
					setFormData((prev) => ({
						...prev,
						voucher_number: data.voucher_number,
					}));
				}
			} catch (error) {
				console.error('Error fetching voucher number:', error);
			}
		};

		const fetchEmployees = async () => {
			try {
				const res = await fetch('/api/employee-master/list');
				const data = await res.json();
				if (data.success) {
					setEmployees(data.data || []);
				}
			} catch (error) {
				console.error('Error fetching employees:', error);
			}
		};

		const fetchProjects = async () => {
			try {
				const res = await fetch('/api/projects/list');
				const data = await res.json();
				if (data.success) {
					setProjects(data.data || []);
				}
			} catch (error) {
				console.error('Error fetching projects:', error);
			}
		};

		const fetchDescriptions = async () => {
			try {
				const res = await fetch('/api/masters/descriptions');
				const data = await res.json();
				if (data.success) {
					// Only get active descriptions
					setDescriptions(
						(data.data || []).filter((d) => d.is_active !== false)
					);
				}
			} catch (error) {
				console.error('Error fetching descriptions:', error);
			}
		};

		const fetchAccountHeads = async () => {
			try {
				const res = await fetch('/api/masters/account-heads');
				const data = await res.json();
				if (data.success) {
					// Only get active account heads
					setAccountHeads(
						(data.data || []).filter((d) => d.is_active !== false)
					);
				}
			} catch (error) {
				console.error('Error fetching account heads:', error);
			}
		};

		if (!authLoading && user) {
			fetchVoucherNumber();
			fetchEmployees();
			fetchProjects();
			fetchDescriptions();
			fetchAccountHeads();
			setFormData((prev) => ({
				...prev,
				prepared_by: user.full_name || user.username || '',
			}));
		}
	}, [authLoading, user]);

	// Calculate total
	useEffect(() => {
		const lineItemsTotal = lineItems.reduce((sum, item) => {
			return add(
				sum,
				toMoneyNumber(item.amount_rs),
				div(toMoneyNumber(item.amount_ps), 100)
			).toNumber();
		}, 0);
		setFormData((prev) => ({
			...prev,
			total_amount: lineItemsTotal,
		}));
	}, [lineItems]);

	// Convert number to words
	const numberToWords = (num) => {
		const ones = [
			'',
			'One',
			'Two',
			'Three',
			'Four',
			'Five',
			'Six',
			'Seven',
			'Eight',
			'Nine',
			'Ten',
			'Eleven',
			'Twelve',
			'Thirteen',
			'Fourteen',
			'Fifteen',
			'Sixteen',
			'Seventeen',
			'Eighteen',
			'Nineteen',
		];
		const tens = [
			'',
			'',
			'Twenty',
			'Thirty',
			'Forty',
			'Fifty',
			'Sixty',
			'Seventy',
			'Eighty',
			'Ninety',
		];

		if (num === 0) return 'Zero';

		const convertLessThanThousand = (n) => {
			if (n === 0) return '';
			if (n < 20) return ones[n];
			if (n < 100)
				return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
			return (
				ones[Math.floor(n / 100)] +
				' Hundred' +
				(n % 100 ? ' ' + convertLessThanThousand(n % 100) : '')
			);
		};

		const wholePart = Math.floor(num);
		const decimalPart = Math.round((num - wholePart) * 100);

		let result = '';

		if (wholePart >= 10000000) {
			result +=
				convertLessThanThousand(Math.floor(wholePart / 10000000)) + ' Crore ';
			num = wholePart % 10000000;
		}
		if (wholePart >= 100000) {
			result +=
				convertLessThanThousand(Math.floor((wholePart % 10000000) / 100000)) +
				' Lakh ';
		}
		if (wholePart >= 1000) {
			result +=
				convertLessThanThousand(Math.floor((wholePart % 100000) / 1000)) +
				' Thousand ';
		}
		if (wholePart >= 100) {
			result +=
				convertLessThanThousand(Math.floor((wholePart % 1000) / 100)) +
				' Hundred ';
		}
		if (wholePart % 100 > 0) {
			result += convertLessThanThousand(wholePart % 100);
		}

		result = result.trim() + ' Rupees';

		if (decimalPart > 0) {
			result += ' and ' + convertLessThanThousand(decimalPart) + ' Paise';
		}

		return result + ' Only';
	};

	// Update amount in words when total changes; clear stale words at zero
	useEffect(() => {
		setFormData((prev) => ({
			...prev,
			amount_in_words:
				prev.total_amount > 0 ? numberToWords(prev.total_amount) : '',
		}));
	}, [formData.total_amount]);

	// Add new line item
	const addLineItem = () => {
		setLineItems((prev) => [
			...prev,
			{
				sr_no: prev.length + 1,
				bill_date: '',
				bill_no: '',
				account_head: '',
				amount_rs: '',
				amount_ps: '',
				description: '',
			},
		]);
	};

	// Remove line item
	const removeLineItem = (index) => {
		if (lineItems.length === 1) return;
		setLineItems((prev) => {
			const updated = prev.filter((_, i) => i !== index);
			return updated.map((item, i) => ({ ...item, sr_no: i + 1 }));
		});
	};

	// Update line item
	const updateLineItem = (index, field, value) => {
		setLineItems((prev) =>
			prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
		);
	};

	// Handle form submit
	const handleSubmit = async (e) => {
		e.preventDefault();
		setSaving(true);

		try {
			const res = await fetch('/api/admin/cash-vouchers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...formData,
					line_items: lineItems,
					voucher_type: 'payment',
				}),
			});

			const data = await res.json();

			if (data.success) {
				router.push('/admin/cash-voucher');
			} else {
				alert('Failed to save voucher: ' + (data.error || 'Unknown error'));
			}
		} catch (error) {
			console.error('Error saving voucher:', error);
			alert('Failed to save voucher');
		} finally {
			setSaving(false);
		}
	};

	const employeeOptions = employees.map((emp) => ({
		id: emp.id,
		value: emp.full_name || `${emp.first_name} ${emp.last_name}`,
		label: emp.full_name || `${emp.first_name} ${emp.last_name}`,
	}));
	const projectOptions = projects.map((proj) => ({
		id: proj.id || proj.project_id,
		value: proj.project_code || proj.project_id,
		label: proj.project_code
			? `${proj.project_code} - ${proj.name}`
			: proj.name || proj.project_id,
	}));
	const accountHeadOptions = accountHeads.map((h) => ({
		id: h.id,
		value: h.account_head_name,
		label: h.account_head_name,
	}));
	const descriptionOptions = descriptions.map((d) => ({
		id: d.id,
		value: d.description_name,
		label: d.description_name,
	}));
	const paidToLabel = optionLabel(employeeOptions, formData.paid_to);
	const projectLabel = optionLabel(projectOptions, formData.project_number);

	if (authLoading) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
				<Sidebar />
				<div className="flex-1 flex flex-col">
					<Navbar />
					<div className="flex-1 flex items-center justify-center">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
			<div className="flex-1 flex flex-col">
				<Navbar />

				<main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
					{/* Header */}
					<div className="mb-6 flex items-center gap-4">
						<button
							type="button"
							onClick={() => router.back()}
							aria-label="Go back"
							className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
						>
							<ArrowLeftIcon aria-hidden="true" className="h-5 w-5" />
						</button>
						<div className="min-w-0">
							<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
								<BanknotesIcon
									aria-hidden="true"
									className="h-7 w-7 shrink-0 text-[#64126D]"
								/>
								<span className="break-words">New Petty Cash Voucher</span>
							</h1>
							<p className="mt-1 text-sm text-gray-500">
								Create a new cash/cheque payment voucher
							</p>
						</div>
					</div>

					<form
						onSubmit={handleSubmit}
						className="mx-auto w-full max-w-5xl space-y-6"
					>
						{/* Company header */}
						<div className={sectionClassName}>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0">
									<p className="text-base font-bold text-gray-900">
										Accent Techno Solutions Pvt. Ltd.
									</p>
									<p className="text-sm text-gray-600">
										17/130, Anand Nagar, Neharu Road, Vakola, Santacruz (E),
										Mumbai - 400 055.
									</p>
								</div>
								<p className="shrink-0 text-sm font-bold tracking-wide text-[#64126D]">
									PETTY CASH-CHEQUE VOUCHER
								</p>
							</div>
						</div>

						{/* Voucher details */}
						<section
							aria-labelledby="voucher-details-heading"
							className={sectionClassName}
						>
							<h2
								id="voucher-details-heading"
								className="mb-4 text-lg font-semibold text-gray-900"
							>
								Voucher details
							</h2>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<div className="min-w-0">
									<label htmlFor="voucher-number" className={labelClassName}>
										Voucher number
									</label>
									<input
										id="voucher-number"
										name="voucher_number"
										type="text"
										autoComplete="off"
										value={formData.voucher_number}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												voucher_number: e.target.value,
											}))
										}
										className={inputClassName}
									/>
								</div>
								<div className="min-w-0">
									<label htmlFor="voucher-date" className={labelClassName}>
										Voucher date
									</label>
									<input
										id="voucher-date"
										name="voucher_date"
										type="date"
										value={formData.voucher_date}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												voucher_date: e.target.value,
											}))
										}
										className={inputClassName}
									/>
								</div>
								<div className="min-w-0">
									<span className={labelClassName}>Paid to</span>
									<SearchableSelect
										options={employeeOptions}
										value={formData.paid_to}
										onChange={(val) =>
											setFormData((prev) => ({
												...prev,
												paid_to: val,
											}))
										}
										placeholder="Select Employee"
										aria-label="Paid to"
										className="w-full min-w-0"
										buttonClassName="min-h-[40px] border-gray-300"
									/>
									{paidToLabel ? (
										<p className={helperClassName}>Selected: {paidToLabel}</p>
									) : null}
								</div>
								<div className="min-w-0">
									<span className={labelClassName}>Project</span>
									<SearchableSelect
										options={projectOptions}
										value={formData.project_number}
										onChange={(val) =>
											setFormData((prev) => ({
												...prev,
												project_number: val,
											}))
										}
										placeholder="Select Project"
										aria-label="Project"
										className="w-full min-w-0"
										buttonClassName="min-h-[40px] border-gray-300"
									/>
									{projectLabel ? (
										<p className={helperClassName}>Selected: {projectLabel}</p>
									) : null}
								</div>
							</div>
						</section>

						{/* Line items */}
						<section
							aria-labelledby="line-items-heading"
							className={sectionClassName}
						>
							<h2
								id="line-items-heading"
								className="mb-4 text-lg font-semibold text-gray-900"
							>
								Line items
							</h2>
							<div className="space-y-4">
								{lineItems.map((item, index) => {
									const itemNo = index + 1;
									const accountHeadLabel = optionLabel(
										accountHeadOptions,
										item.account_head
									);
									const descriptionLabel = optionLabel(
										descriptionOptions,
										item.description
									);
									return (
										<fieldset
											key={index}
											className="min-w-0 rounded-lg border border-gray-200 bg-slate-50/50 p-4"
										>
											<legend className="px-1 text-sm font-semibold text-gray-900">
												Item {itemNo}
											</legend>
											<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
												<div className="min-w-0">
													<label
														htmlFor={`item-${index}-bill-date`}
														className={labelClassName}
													>
														Bill date{' '}
														<span className="sr-only">for item {itemNo}</span>
													</label>
													<input
														id={`item-${index}-bill-date`}
														name={`item-${index}-bill-date`}
														type="date"
														value={formatDateInput(item.bill_date)}
														onChange={(e) =>
															updateLineItem(index, 'bill_date', e.target.value)
														}
														className={inputClassName}
													/>
												</div>
												<div className="min-w-0">
													<label
														htmlFor={`item-${index}-bill-no`}
														className={labelClassName}
													>
														Bill no.{' '}
														<span className="sr-only">for item {itemNo}</span>
													</label>
													<input
														id={`item-${index}-bill-no`}
														name={`item-${index}-bill-no`}
														type="text"
														autoComplete="off"
														value={item.bill_no ?? ''}
														onChange={(e) =>
															updateLineItem(index, 'bill_no', e.target.value)
														}
														className={inputClassName}
														placeholder="Bill number"
													/>
												</div>
												<div className="min-w-0 sm:col-span-2">
													<span className={labelClassName}>
														Account head{' '}
														<span className="sr-only">for item {itemNo}</span>
													</span>
													<SearchableSelect
														options={accountHeadOptions}
														value={item.account_head}
														onChange={(val) =>
															updateLineItem(index, 'account_head', val)
														}
														placeholder="Select Account Head"
														aria-label={`Item ${itemNo} account head`}
														className="w-full min-w-0"
														buttonClassName="min-h-[40px] border-gray-300"
													/>
													{accountHeadLabel ? (
														<p className={helperClassName}>
															Selected: {accountHeadLabel}
														</p>
													) : null}
												</div>
												<div className="min-w-0 sm:col-span-2">
													<div
														role="group"
														aria-label={`Item ${itemNo} amount`}
														className="grid grid-cols-2 gap-4"
													>
														<div className="min-w-0">
															<label
																htmlFor={`item-${index}-amount-rs`}
																className={labelClassName}
															>
																Rupees (Rs){' '}
																<span className="sr-only">
																	for item {itemNo}
																</span>
															</label>
															<input
																id={`item-${index}-amount-rs`}
																name={`item-${index}-amount-rs`}
																type="number"
																min="0"
																step="any"
																inputMode="numeric"
																value={item.amount_rs ?? ''}
																onChange={(e) =>
																	updateLineItem(
																		index,
																		'amount_rs',
																		e.target.value
																	)
																}
																className={inputClassName}
																placeholder="0"
															/>
														</div>
														<div className="min-w-0">
															<label
																htmlFor={`item-${index}-amount-ps`}
																className={labelClassName}
															>
																Paise (Ps){' '}
																<span className="sr-only">
																	for item {itemNo}
																</span>
															</label>
															<input
																id={`item-${index}-amount-ps`}
																name={`item-${index}-amount-ps`}
																type="number"
																min="0"
																max="99"
																step="1"
																inputMode="numeric"
																value={item.amount_ps ?? ''}
																onChange={(e) =>
																	updateLineItem(
																		index,
																		'amount_ps',
																		e.target.value
																	)
																}
																className={inputClassName}
																placeholder="00"
															/>
														</div>
													</div>
													<p className={hintClassName}>
														Rupees and paise stay separate. Paise from 0 to 99.
													</p>
												</div>
												<div className="min-w-0 sm:col-span-2">
													<span className={labelClassName}>
														Description{' '}
														<span className="sr-only">for item {itemNo}</span>
													</span>
													<SearchableSelect
														options={descriptionOptions}
														value={item.description}
														onChange={(val) => {
															updateLineItem(index, 'description', val);
															setFormData((prev) => ({
																...prev,
																description: val,
															}));
														}}
														placeholder="Select Description"
														aria-label={`Item ${itemNo} description`}
														className="w-full min-w-0"
														buttonClassName="min-h-[40px] border-gray-300"
													/>
													{descriptionLabel ? (
														<p className={helperClassName}>
															Selected: {descriptionLabel}
														</p>
													) : null}
												</div>
											</div>
											{lineItems.length > 1 && (
												<div className="mt-3 flex justify-end">
													<button
														type="button"
														onClick={() => removeLineItem(index)}
														aria-label={`Remove item ${itemNo}`}
														className="inline-flex min-h-[40px] items-center gap-1 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
													>
														<TrashIcon aria-hidden="true" className="h-4 w-4" />
														Remove
													</button>
												</div>
											)}
										</fieldset>
									);
								})}
							</div>
							<button
								type="button"
								onClick={addLineItem}
								className="mt-4 inline-flex min-h-[40px] items-center gap-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-[#64126D] hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
							>
								<PlusIcon aria-hidden="true" className="h-4 w-4" />
								Add row
							</button>
						</section>

						{/* Payment summary */}
						<section
							aria-labelledby="payment-summary-heading"
							className={sectionClassName}
						>
							<h2
								id="payment-summary-heading"
								className="mb-4 text-lg font-semibold text-gray-900"
							>
								Payment summary
							</h2>
							<fieldset className="min-w-0">
								<legend className="text-sm font-medium text-gray-700">
									Payment method
								</legend>
								<div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
									<div className="flex min-h-[40px] items-center gap-2">
										<input
											id="payment-mode-cash"
											name="payment_mode"
											type="radio"
											value="cash"
											checked={formData.payment_mode === 'cash'}
											onChange={(e) =>
												setFormData((prev) => ({
													...prev,
													payment_mode: e.target.value,
												}))
											}
											className="h-4 w-4 accent-[#64126D] focus-visible:ring-2 focus-visible:ring-[#64126D]"
										/>
										<label
											htmlFor="payment-mode-cash"
											className="text-base text-gray-900"
										>
											Cash
										</label>
									</div>
									<div className="flex min-h-[40px] items-center gap-2">
										<input
											id="payment-mode-cheque"
											name="payment_mode"
											type="radio"
											value="cheque"
											checked={formData.payment_mode === 'cheque'}
											onChange={(e) =>
												setFormData((prev) => ({
													...prev,
													payment_mode: e.target.value,
												}))
											}
											className="h-4 w-4 accent-[#64126D] focus-visible:ring-2 focus-visible:ring-[#64126D]"
										/>
										<label
											htmlFor="payment-mode-cheque"
											className="text-base text-gray-900"
										>
											Cheque
										</label>
									</div>
								</div>
							</fieldset>
							<div className="mt-4 grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 sm:grid-cols-2">
								<div className="min-w-0">
									<p className="text-sm font-medium text-gray-700">Total</p>
									<p
										aria-live="polite"
										className="mt-1 break-words text-2xl font-bold text-gray-900"
									>
										{formatCurrency(formData.total_amount)}
									</p>
								</div>
								<div className="min-w-0">
									<p className="text-sm font-medium text-gray-700">
										Amount in words
									</p>
									<p
										aria-live="polite"
										className="mt-1 break-words text-base text-gray-900"
									>
										{formData.amount_in_words || '—'}
									</p>
								</div>
							</div>
						</section>

						{/* Sign-off */}
						<section
							aria-labelledby="sign-off-heading"
							className={sectionClassName}
						>
							<h2
								id="sign-off-heading"
								className="mb-4 text-lg font-semibold text-gray-900"
							>
								Sign-off
							</h2>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
								<div className="min-w-0">
									<label htmlFor="prepared-by" className={labelClassName}>
										Prepared by
									</label>
									<input
										id="prepared-by"
										name="prepared_by"
										type="text"
										autoComplete="off"
										value={formData.prepared_by}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												prepared_by: e.target.value,
											}))
										}
										className={inputClassName}
									/>
								</div>
								<div className="min-w-0">
									<label htmlFor="checked-by" className={labelClassName}>
										Checked by
									</label>
									<input
										id="checked-by"
										name="checked_by"
										type="text"
										autoComplete="off"
										value={formData.checked_by}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												checked_by: e.target.value,
											}))
										}
										className={inputClassName}
										placeholder="Name"
									/>
								</div>
								<div className="min-w-0">
									<label htmlFor="approved-by" className={labelClassName}>
										Approved by
									</label>
									<input
										id="approved-by"
										name="approved_by"
										type="text"
										autoComplete="off"
										value={formData.approved_by}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												approved_by: e.target.value,
											}))
										}
										className={inputClassName}
										placeholder="Name"
									/>
								</div>
								<div className="min-w-0">
									<label
										htmlFor="receiver-signature"
										className={labelClassName}
									>
										Receiver signature
									</label>
									<input
										id="receiver-signature"
										name="receiver_signature"
										type="text"
										autoComplete="off"
										value={formData.receiver_signature}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												receiver_signature: e.target.value,
											}))
										}
										className={inputClassName}
										placeholder="Name"
									/>
								</div>
							</div>
						</section>

						{/* Action Buttons */}
						<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button
								type="button"
								onClick={() => router.back()}
								className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-6 py-2 text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={saving}
								className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-[#64126D] px-6 py-2 text-white transition-colors hover:bg-[#52105a] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
							>
								{saving ? (
									<>
										<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
										Saving...
									</>
								) : (
									<>
										<CheckIcon aria-hidden="true" className="h-5 w-5" />
										Save Voucher
									</>
								)}
							</button>
						</div>
					</form>
				</main>
			</div>
		</div>
	);
}
