'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
	DocumentCurrencyDollarIcon,
	ArrowLeftIcon,
	PlusIcon,
	TrashIcon,
	CheckIcon,
} from '@heroicons/react/24/outline';

const DEFAULT_GST_NUMBER = '27AAHCA5765M1ZD';
const DEFAULT_PAN_NUMBER = 'AAHCA5765M';
const DEFAULT_SERVICE_CATEGORY =
	'Consulting & Advisory Engineering Services (Service Code : 998331)';
const DEFAULT_BANK_ADDRESS =
	'City Survey No. 841 to 846, "Florence" Florence CHS LTD. Vakola, Mumbai - 400 055 / A/c No. 917020044935714';

export default function CreateInvoicePage() {
	const router = useRouter();
	const { loading: authLoading } = useSessionRBAC();

	const [saving, setSaving] = useState(false);
	const [companies, setCompanies] = useState([]);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [formData, setFormData] = useState({
		invoice_number: '',
		invoice_date: new Date().toISOString().split('T')[0],
		client_name: '',
		client_email: '',
		client_phone: '',
		client_address: '',
		client_pan: '',
		client_gstin: '',
		client_state: '',
		client_state_code: '',
		kind_attn: '',
		po_number: '',
		po_date: '',
		original_po_value: '',
		balance_po_value: '',
		line_items: [
			{ sr_no: 1, description: '', unit: '', charges: '', amount: 0 },
		],
		gst_type: 'cgst_sgst',
		cgst_rate: 9,
		sgst_rate: 9,
		igst_rate: 18,
		gst_number: '',
		pan_number: '',
		tan_number: '',
		service_category: '',
		bank_address: '',
		notes: '',
		terms: '',
		due_date: '',
		status: 'draft',
	});

	// Auto-generate invoice number on mount
	useEffect(() => {
		fetch('/api/admin/invoices/next-number')
			.then((res) => res.json())
			.then((data) => {
				if (data.success && data.invoice_number) {
					setFormData((prev) => ({
						...prev,
						invoice_number: data.invoice_number,
					}));
				}
			})
			.catch((err) =>
				console.error('Error fetching next invoice number:', err)
			);
	}, []);

	// Fetch companies on mount
	useEffect(() => {
		fetch('/api/companies')
			.then((res) => res.json())
			.then((data) => {
				if (data.success) setCompanies(data.data || []);
			})
			.catch((err) => console.error('Error fetching companies:', err));
	}, []);

	// Handle company selection
	const handleSelectCompany = (company) => {
		const addrParts = [
			company.address,
			company.city,
			company.state,
			company.country,
			company.postal_code,
		].filter(Boolean);

		setFormData((prev) => ({
			...prev,
			client_name: company.company_name || '',
			client_email: company.email || '',
			client_phone: company.phone || company.mobile_number || '',
			client_address: addrParts.join('\n'),
			client_pan: company.pan_number || '',
			client_gstin: company.gstin || '',
			client_state: company.state || '',
			client_state_code: company.state_code || '',
			kind_attn: company.contact_person || '',
		}));
		setShowSuggestions(false);
	};

	// Handle input change
	const handleChange = (e) => {
		const { name, value } = e.target;
		setFormData((prev) => ({ ...prev, [name]: value }));
	};

	// Calculate totals from line_items (matching generateInvoiceHTML logic)
	const calculateTotals = () => {
		const grossAmount = formData.line_items.reduce(
			(sum, item) => sum + (parseFloat(item.amount) || 0),
			0
		);
		const cgstAmount =
			formData.gst_type === 'cgst_sgst'
				? (grossAmount * (parseFloat(formData.cgst_rate) || 0)) / 100
				: 0;
		const sgstAmount =
			formData.gst_type === 'cgst_sgst'
				? (grossAmount * (parseFloat(formData.sgst_rate) || 0)) / 100
				: 0;
		const igstAmount =
			formData.gst_type === 'igst'
				? (grossAmount * (parseFloat(formData.igst_rate) || 0)) / 100
				: 0;
		const totalGst = cgstAmount + sgstAmount + igstAmount;
		const netAmount = grossAmount + totalGst;
		return {
			grossAmount,
			cgstAmount,
			sgstAmount,
			igstAmount,
			totalGst,
			netAmount,
		};
	};

	// Handle line item change
	const handleItemChange = (index, field, value) => {
		setFormData((prev) => {
			const newItems = [...prev.line_items];
			const parsed = field === 'amount' ? parseFloat(value) || 0 : value;
			newItems[index] = { ...newItems[index], [field]: parsed };
			return { ...prev, line_items: newItems };
		});
	};

	// Add line item
	const addItem = () => {
		setFormData((prev) => ({
			...prev,
			line_items: [
				...prev.line_items,
				{
					sr_no: prev.line_items.length + 1,
					description: '',
					unit: '',
					charges: '',
					amount: 0,
				},
			],
		}));
	};

	// Remove line item
	const removeItem = (index) => {
		if (formData.line_items.length <= 1) return;
		setFormData((prev) => ({
			...prev,
			line_items: prev.line_items
				.filter((_, i) => i !== index)
				.map((item, i) => ({ ...item, sr_no: i + 1 })),
		}));
	};

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
		if (num < 20) return ones[num];
		if (num < 100)
			return (
				tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '')
			);
		if (num < 1000)
			return (
				ones[Math.floor(num / 100)] +
				' Hundred' +
				(num % 100 ? ' ' + numberToWords(num % 100) : '')
			);
		if (num < 100000)
			return (
				numberToWords(Math.floor(num / 1000)) +
				' Thousand' +
				(num % 1000 ? ' ' + numberToWords(num % 1000) : '')
			);
		if (num < 10000000)
			return (
				numberToWords(Math.floor(num / 100000)) +
				' Lakh' +
				(num % 100000 ? ' ' + numberToWords(num % 100000) : '')
			);
		return (
			numberToWords(Math.floor(num / 10000000)) +
			' Crore' +
			(num % 10000000 ? ' ' + numberToWords(num % 10000000) : '')
		);
	};

	// Auto-generate amount in words
	const {
		grossAmount,
		cgstAmount,
		sgstAmount,
		igstAmount,
		totalGst,
		netAmount,
	} = calculateTotals();
	const amountInWords = (() => {
		const rupees = Math.floor(netAmount);
		const paise = Math.round((netAmount - rupees) * 100);
		let words = 'Rupees ' + numberToWords(rupees);
		if (paise > 0) {
			words += ' And ' + numberToWords(paise) + ' Paise';
		}
		words += ' Only .';
		return words;
	})();

	// Format currency
	const formatCurrency = (amount) => {
		return new Intl.NumberFormat('en-IN', {
			style: 'currency',
			currency: 'INR',
			minimumFractionDigits: 2,
		}).format(amount || 0);
	};

	// Save invoice
	const saveInvoice = async () => {
		if (!formData.client_name) {
			alert('Client name is required');
			return;
		}

		setSaving(true);
		try {
			const totals = calculateTotals();
			const taxRate =
				formData.gst_type === 'cgst_sgst'
					? (parseFloat(formData.cgst_rate) || 0) +
						(parseFloat(formData.sgst_rate) || 0)
					: parseFloat(formData.igst_rate) || 0;

			const res = await fetch('/api/admin/invoices', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...formData,
					gross_amount: totals.grossAmount,
					subtotal: totals.grossAmount,
					tax_rate: taxRate,
					tax_amount: totals.totalGst,
					total: totals.netAmount,
					net_amount: totals.netAmount,
					balance_due: totals.netAmount,
					amount_in_words: amountInWords,
				}),
			});

			const data = await res.json();
			if (data.success) {
				router.push('/admin/invoice');
			} else {
				alert(data.message || 'Failed to create invoice');
			}
		} catch (error) {
			console.error('Error saving invoice:', error);
			alert('Failed to create invoice');
		} finally {
			setSaving(false);
		}
	};

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
		<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
			<Sidebar />
			<div className="flex-1 flex flex-col">
				<Navbar />

				<main className="flex-1 px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 overflow-auto w-full">
					{/* Header */}
					<div className="flex items-center justify-between mb-6">
						<div className="flex items-center gap-4">
							<button
								onClick={() => router.push('/admin/invoice')}
								className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
							>
								<ArrowLeftIcon className="h-5 w-5 text-gray-600" />
							</button>
							<div>
								<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
									<DocumentCurrencyDollarIcon className="h-7 w-7 text-purple-600" />
									Create Invoice
								</h1>
								<p className="text-sm text-gray-500 mt-1">
									{formData.invoice_number || 'Generating number...'}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<button
								onClick={() => router.push('/admin/invoice')}
								className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={saveInvoice}
								disabled={saving}
								className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-2"
							>
								{saving ? (
									<>
										<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
										Saving...
									</>
								) : (
									<>
										<CheckIcon className="h-5 w-5" />
										Save Invoice
									</>
								)}
							</button>
						</div>
					</div>

					{/* Invoice Form */}
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
						{/* Company Header */}
						<div className="bg-purple-600 text-white p-4 text-center">
							<h2 className="text-xl font-bold">
								Accent Techno Solutions Private Limited
							</h2>
							<p className="text-sm text-purple-100 mt-1">
								Engineering & Consultancy Services
							</p>
						</div>

						<div className="p-6 space-y-6">
							{/* Top Section - Client Info & Invoice Details */}
							<div className="border border-gray-300">
								<div className="flex flex-col md:flex-row">
									{/* Left - To Section */}
									<div className="flex-[3] border-r border-gray-300 p-4">
										<label className="block text-sm font-semibold text-gray-700 mb-2">
											To,
										</label>
										<div className="relative mb-2">
											<input
												type="text"
												name="client_name"
												value={formData.client_name}
												onChange={(e) => {
													handleChange(e);
													setShowSuggestions(true);
												}}
												onFocus={() => setShowSuggestions(true)}
												onBlur={() =>
													setTimeout(() => setShowSuggestions(false), 200)
												}
												placeholder="Client Name"
												className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
												autoComplete="off"
											/>
											{showSuggestions && (
												<div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
													{companies.filter((c) =>
														(c.company_name || '')
															.toLowerCase()
															.includes(
																(formData.client_name || '').toLowerCase()
															)
													).length > 0 ? (
														companies
															.filter((c) =>
																(c.company_name || '')
																	.toLowerCase()
																	.includes(
																		(formData.client_name || '').toLowerCase()
																	)
															)
															.map((company) => (
																<button
																	key={company.id}
																	type="button"
																	onClick={() => handleSelectCompany(company)}
																	className="w-full text-left px-4 py-2 hover:bg-purple-50 text-sm text-gray-700 font-medium transition-colors"
																>
																	<div className="font-semibold text-gray-900">
																		{company.company_name}
																	</div>
																	<div className="text-xs text-gray-500">
																		{company.city ? `${company.city}, ` : ''}
																		{company.state || ''}
																	</div>
																</button>
															))
													) : (
														<div className="px-4 py-2 text-sm text-gray-500 italic">
															No matching company found. Keep typing to enter
															manually.
														</div>
													)}
												</div>
											)}
										</div>
										<textarea
											name="client_address"
											value={formData.client_address}
											onChange={handleChange}
											placeholder="Client Address"
											rows={3}
											className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
										/>
									</div>

									{/* Right - Invoice Details */}
									<div className="flex-[2]">
										<div className="flex border-b border-gray-300">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												Invoice No.
											</div>
											<div className="w-1/2 p-2">
												<input
													type="text"
													name="invoice_number_display"
													value={formData.invoice_number}
													readOnly
													className="w-full px-2 py-1 text-sm border border-gray-200 rounded bg-gray-50 text-gray-600"
												/>
											</div>
										</div>
										<div className="flex border-b border-gray-300">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												Date of Invoice
											</div>
											<div className="w-1/2 p-2">
												<input
													type="date"
													name="invoice_date"
													value={formData.invoice_date}
													onChange={handleChange}
													className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
												/>
											</div>
										</div>
										<div className="flex border-b border-gray-300">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												PO Number
											</div>
											<div className="w-1/2 p-2">
												<input
													type="text"
													name="po_number"
													value={formData.po_number}
													onChange={handleChange}
													className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
													placeholder="PO No."
												/>
											</div>
										</div>
										<div className="flex">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												PO Date
											</div>
											<div className="w-1/2 p-2">
												<input
													type="date"
													name="po_date"
													value={formData.po_date}
													onChange={handleChange}
													className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
												/>
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* PAN / GSTIN / State | Original & Balance PO Value */}
							<div className="border border-gray-300">
								<div className="flex flex-col md:flex-row">
									<div className="flex-1 border-r border-gray-300 p-4 space-y-2">
										<div className="flex items-center gap-2">
											<label className="text-sm font-semibold text-gray-700 w-24">
												PAN No.
											</label>
											<input
												type="text"
												name="client_pan"
												value={formData.client_pan}
												onChange={handleChange}
												placeholder="Client PAN"
												className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
										<div className="flex items-center gap-2">
											<label className="text-sm font-semibold text-gray-700 w-24">
												GSTIN
											</label>
											<input
												type="text"
												name="client_gstin"
												value={formData.client_gstin}
												onChange={handleChange}
												placeholder="Client GSTIN"
												className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
										<div className="flex items-center gap-2">
											<label className="text-sm font-semibold text-gray-700 w-24">
												State
											</label>
											<input
												type="text"
												name="client_state"
												value={formData.client_state}
												onChange={handleChange}
												placeholder="Maharashtra"
												className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
										<div className="flex items-center gap-2">
											<label className="text-sm font-semibold text-gray-700 w-24">
												State Code
											</label>
											<input
												type="text"
												name="client_state_code"
												value={formData.client_state_code}
												onChange={handleChange}
												placeholder="27"
												className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
									</div>
									<div className="flex-1 p-4 space-y-3">
										<div>
											<label className="block text-sm font-semibold text-gray-700 mb-1">
												Original PO Value (₹)
											</label>
											<input
												type="number"
												name="original_po_value"
												value={formData.original_po_value}
												onChange={handleChange}
												placeholder="0.00"
												className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
										<div>
											<label className="block text-sm font-semibold text-gray-700 mb-1">
												Balance PO Value (₹)
											</label>
											<input
												type="number"
												name="balance_po_value"
												value={formData.balance_po_value}
												onChange={handleChange}
												placeholder="0.00"
												className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
										<div>
											<label className="block text-sm font-semibold text-gray-700 mb-1">
												Kind Attn.
											</label>
											<input
												type="text"
												name="kind_attn"
												value={formData.kind_attn}
												onChange={handleChange}
												placeholder="Contact Person Name"
												className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
									</div>
								</div>
							</div>

							{/* Line Items Table */}
							<div className="border border-gray-300">
								<table className="w-full">
									<thead>
										<tr className="bg-gray-50">
											<th className="w-12 p-3 text-left text-sm font-semibold border-r border-b border-gray-300">
												Sr. No.
											</th>
											<th className="p-3 text-left text-sm font-semibold border-r border-b border-gray-300">
												Description
											</th>
											<th className="w-24 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">
												Unit
											</th>
											<th className="w-28 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">
												Charges
											</th>
											<th className="w-32 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">
												Amount
											</th>
											<th className="w-10 p-3 border-b border-gray-300"></th>
										</tr>
									</thead>
									<tbody>
										{formData.line_items.map((item, index) => (
											<tr key={index}>
												<td className="p-2 border-r border-b border-gray-300 text-center text-sm">
													{item.sr_no || index + 1}
												</td>
												<td className="p-2 border-r border-b border-gray-300">
													<textarea
														value={item.description}
														onChange={(e) =>
															handleItemChange(
																index,
																'description',
																e.target.value
															)
														}
														placeholder="Description of service"
														rows={2}
														className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
													/>
												</td>
												<td className="p-2 border-r border-b border-gray-300">
													<input
														type="text"
														value={item.unit}
														onChange={(e) =>
															handleItemChange(index, 'unit', e.target.value)
														}
														placeholder="-"
														className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
													/>
												</td>
												<td className="p-2 border-r border-b border-gray-300">
													<input
														type="text"
														value={item.charges}
														onChange={(e) =>
															handleItemChange(index, 'charges', e.target.value)
														}
														placeholder="-"
														className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
													/>
												</td>
												<td className="p-2 border-r border-b border-gray-300">
													<input
														type="number"
														value={item.amount}
														onChange={(e) =>
															handleItemChange(index, 'amount', e.target.value)
														}
														min="0"
														placeholder="0.00"
														className="w-full px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
													/>
												</td>
												<td className="p-2 border-b border-gray-300 text-center">
													{formData.line_items.length > 1 && (
														<button
															onClick={() => removeItem(index)}
															className="p-1 text-red-500 hover:bg-red-50 rounded"
														>
															<TrashIcon className="h-4 w-4" />
														</button>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
								<div className="p-2 border-t border-gray-300">
									<button
										onClick={addItem}
										className="flex items-center gap-1 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
									>
										<PlusIcon className="h-4 w-4" />
										Add Item
									</button>
								</div>
							</div>

							{/* GST Type + Totals Section */}
							<div className="flex flex-col md:flex-row gap-4">
								{/* GST Type & Rates */}
								<div className="flex-1 border border-gray-300">
									<div className="p-3 bg-gray-50 font-semibold text-sm border-b border-gray-300">
										GST Configuration
									</div>
									<div className="p-3 space-y-3">
										<div className="flex items-center gap-4">
											<label className="text-sm font-medium text-gray-700 w-20">
												GST Type
											</label>
											<select
												name="gst_type"
												value={formData.gst_type}
												onChange={handleChange}
												className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
											>
												<option value="cgst_sgst">CGST + SGST</option>
												<option value="igst">IGST</option>
											</select>
										</div>
										{formData.gst_type === 'cgst_sgst' ? (
											<div className="grid grid-cols-2 gap-3">
												<div className="flex items-center gap-2">
													<label className="text-sm text-gray-600 w-16">
														CGST %
													</label>
													<input
														type="number"
														name="cgst_rate"
														value={formData.cgst_rate}
														onChange={handleChange}
														step="0.5"
														className="flex-1 px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
													/>
												</div>
												<div className="flex items-center gap-2">
													<label className="text-sm text-gray-600 w-16">
														SGST %
													</label>
													<input
														type="number"
														name="sgst_rate"
														value={formData.sgst_rate}
														onChange={handleChange}
														step="0.5"
														className="flex-1 px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
													/>
												</div>
											</div>
										) : (
											<div className="flex items-center gap-2">
												<label className="text-sm text-gray-600 w-16">
													IGST %
												</label>
												<input
													type="number"
													name="igst_rate"
													value={formData.igst_rate}
													onChange={handleChange}
													step="0.5"
													className="flex-1 px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
												/>
											</div>
										)}
									</div>
								</div>

								{/* Totals */}
								<div className="flex-1 border border-gray-300">
									<div className="flex border-b border-gray-300">
										<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm text-right">
											Total Amount Before Tax &gt;&gt;
										</div>
										<div className="w-32 p-2 text-right font-medium">
											{formatCurrency(grossAmount)}
										</div>
									</div>
									{formData.gst_type === 'cgst_sgst' ? (
										<>
											<div className="flex border-b border-gray-300">
												<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50/30 text-xs text-gray-500 text-right">
													Add : CGST @ {formData.cgst_rate}% &gt;&gt;
												</div>
												<div className="w-32 p-2 text-right text-xs text-gray-600 font-medium">
													{formatCurrency(cgstAmount)}
												</div>
											</div>
											<div className="flex border-b border-gray-300">
												<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50/30 text-xs text-gray-500 text-right">
													Add : SGST @ {formData.sgst_rate}% &gt;&gt;
												</div>
												<div className="w-32 p-2 text-right text-xs text-gray-600 font-medium">
													{formatCurrency(sgstAmount)}
												</div>
											</div>
										</>
									) : (
										<div className="flex border-b border-gray-300">
											<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50/30 text-xs text-gray-500 text-right">
												Add : IGST @ {formData.igst_rate}% &gt;&gt;
											</div>
											<div className="w-32 p-2 text-right text-xs text-gray-600 font-medium">
												{formatCurrency(igstAmount)}
											</div>
										</div>
									)}
									<div className="flex border-b border-gray-300">
										<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm text-right">
											Total Amount : GST &gt;&gt;
										</div>
										<div className="w-32 p-2 text-right font-medium">
											{formatCurrency(totalGst)}
										</div>
									</div>
									<div className="flex bg-purple-50">
										<div className="flex-1 p-3 border-r border-gray-300 font-bold text-sm text-right text-purple-700">
											Total Amount After Tax &gt;&gt;
										</div>
										<div className="w-32 p-3 text-right font-bold text-purple-700">
											{formatCurrency(netAmount)}
										</div>
									</div>
								</div>
							</div>

							{/* Amount in Words */}
							<div className="border border-gray-300">
								<div className="flex">
									<div className="w-32 p-3 bg-gray-50 font-semibold text-sm border-r border-gray-300">
										Amount in words:
									</div>
									<div className="flex-1 p-3 text-sm italic font-medium">
										{amountInWords}
									</div>
								</div>
							</div>

							{/* Company (ATSPL) Info - GSTIN/PAN/Service/TAN/Bank */}
							<div className="border border-gray-300">
								<div className="p-3 bg-gray-50 font-semibold text-sm border-b border-gray-300">
									Company Details (ATSPL)
								</div>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
									<div className="flex items-center gap-2">
										<label className="text-sm font-semibold text-gray-700 w-32">
											GSTIN
										</label>
										<input
											type="text"
											name="gst_number"
											value={formData.gst_number}
											onChange={handleChange}
											className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
										/>
									</div>
									<div className="flex items-center gap-2">
										<label className="text-sm font-semibold text-gray-700 w-32">
											PAN No.
										</label>
										<input
											type="text"
											name="pan_number"
											value={formData.pan_number}
											onChange={handleChange}
											className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
										/>
									</div>
									<div className="flex items-center gap-2">
										<label className="text-sm font-semibold text-gray-700 w-32">
											TAN No.
										</label>
										<input
											type="text"
											name="tan_number"
											value={formData.tan_number}
											onChange={handleChange}
											className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
										/>
									</div>
									<div className="flex items-center gap-2">
										<label className="text-sm font-semibold text-gray-700 w-32">
											Service Category
										</label>
										<input
											type="text"
											name="service_category"
											value={formData.service_category}
											onChange={handleChange}
											className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
										/>
									</div>
									<div className="md:col-span-2">
										<label className="block text-sm font-semibold text-gray-700 mb-1">
											Bank Address
										</label>
										<textarea
											name="bank_address"
											value={formData.bank_address}
											onChange={handleChange}
											rows={2}
											className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
										/>
									</div>
								</div>
							</div>

							{/* Due Date & Status */}
							<div className="border border-gray-300">
								<div className="flex flex-wrap">
									<div className="flex-1 border-r border-gray-300">
										<div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">
											Due Date
										</div>
										<div className="p-2">
											<input
												type="date"
												name="due_date"
												value={formData.due_date}
												onChange={handleChange}
												className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
											/>
										</div>
									</div>
									<div className="flex-1">
										<div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">
											Invoice Status
										</div>
										<div className="p-2">
											<select
												name="status"
												value={formData.status}
												onChange={handleChange}
												className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
											>
												<option value="draft">Draft</option>
												<option value="sent">Sent</option>
												<option value="paid">Paid</option>
												<option value="overdue">Overdue</option>
												<option value="cancelled">Cancelled</option>
											</select>
										</div>
									</div>
								</div>
							</div>

							{/* Notes & Terms */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<label className="block text-sm font-semibold text-gray-700 mb-1">
										Notes
									</label>
									<textarea
										name="notes"
										value={formData.notes}
										onChange={handleChange}
										rows={4}
										placeholder="Additional notes for the client..."
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
									/>
								</div>
								<div>
									<label className="block text-sm font-semibold text-gray-700 mb-1">
										Terms & Conditions
									</label>
									<textarea
										name="terms"
										value={formData.terms}
										onChange={handleChange}
										rows={4}
										placeholder="Enter payment terms and conditions..."
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
									/>
								</div>
							</div>

							{/* Footer */}
							<div className="border border-gray-300">
								<div className="flex">
									<div className="flex-1 p-4 border-r border-gray-300">
										<p className="text-sm text-gray-600">
											Receiver&apos;s Signature with Company Seal.
										</p>
										<div className="h-20"></div>
									</div>
									<div className="flex-1 p-4">
										<p className="text-sm font-semibold">
											For{' '}
											<span className="text-purple-700">
												Accent Techno Solutions Private Limited
											</span>
										</p>
										<div className="h-12"></div>
										<p className="text-sm font-semibold">
											Varsha Vasant Mestry
										</p>
										<p className="text-sm text-gray-600">Managing Director</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</main>
			</div>
		</div>
	);
}
