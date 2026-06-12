'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
	ArrowLeftIcon,
	DocumentTextIcon,
	PrinterIcon,
} from '@heroicons/react/24/outline';

export default function ViewQuotationPage() {
	const params = useParams();
	const router = useRouter();
	const { user, loading: authLoading } = useSessionRBAC();
	const id = params?.id;
	const source =
		typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).get('source') || 'project'
			: 'project';

	const [loading, setLoading] = useState(true);
	const [quotation, setQuotation] = useState({
		quotation_number: '',
		quotation_date: '',
		enquiry_number: '',
		enquiry_date: '',
		client_name: '',
		client_address: '',
		kind_attn: '',
		scope_items: [],
		amount_in_words: '',
		gst_number: '',
		pan_number: '',
		tan_number: '',
		terms_and_conditions: '',
		gross_amount: 0,
		gst_percentage: 18,
		gst_amount: 0,
		net_amount: 0,
		annexure_scope_of_work: '',
		annexure_input_document: '',
		annexure_deliverables: '',
		annexure_software: '',
		annexure_duration: '',
		annexure_site_visit: '',
		annexure_quotation_validity: '',
		annexure_mode_of_delivery: '',
		annexure_revision: '',
		annexure_exclusions: '',
		annexure_billing_payment_terms: '',
		annexure_confidentiality: '',
		annexure_codes_standards: '',
		annexure_dispute_resolution: '',
	});

	// Fetch quotation data
	const fetchQuotation = useCallback(async () => {
		if (!id) return;
		setLoading(true);
		try {
			const fetchUrl =
				source === 'quotations'
					? `/api/admin/standalone-quotations/${id}`
					: `/api/admin/quotations/${id}?source=${source}`;
			const res = await fetch(fetchUrl);
			const data = await res.json();

			if (data.success && data.data) {
				const q = data.data;
				let scopeItems = [];
				if (q.scope_items) {
					try {
						scopeItems =
							typeof q.scope_items === 'string'
								? JSON.parse(q.scope_items)
								: q.scope_items;
					} catch (e) {
						if (q.scope_of_work) {
							scopeItems = [
								{
									sr_no: 1,
									description: q.scope_of_work,
									qty: q.enquiry_quantity || '1',
									rate: q.gross_amount || '',
									amount: q.gross_amount || '',
								},
							];
						}
					}
				} else if (q.scope_of_work) {
					scopeItems = [
						{
							sr_no: 1,
							description: q.scope_of_work,
							qty: q.enquiry_quantity || '1',
							rate: q.gross_amount || '',
							amount: q.gross_amount || '',
						},
					];
				}

				setQuotation({
					quotation_number: q.quotation_number || '',
					quotation_date: q.quotation_date
						? q.quotation_date.split('T')[0]
						: '',
					enquiry_number: q.enquiry_number || '',
					enquiry_date: q.enquiry_date ? q.enquiry_date.split('T')[0] : '',
					client_name: q.client_name || '',
					client_address: q.client_address || '',
					kind_attn: q.kind_attn || '',
					scope_items: scopeItems,
					amount_in_words: q.amount_in_words || '',
					gst_number: q.gst_number || '',
					pan_number: q.pan_number || '',
					tan_number: q.tan_number || '',
					terms_and_conditions: q.terms_and_conditions || '',
					gross_amount: q.gross_amount || 0,
					gst_percentage: q.gst_percentage || 18,
					gst_amount: q.gst_amount || 0,
					net_amount: q.net_amount || 0,
					annexure_scope_of_work:
						q.annexure_scope_of_work || q.scope_of_work || '',
					annexure_input_document:
						q.annexure_input_document ||
						q.input_document ||
						q.input_documents ||
						'',
					annexure_deliverables:
						q.annexure_deliverables ||
						q.deliverables ||
						q.list_of_deliverables ||
						'',
					annexure_software: q.annexure_software || q.software_included || '',
					annexure_duration: q.annexure_duration || q.duration || '',
					annexure_site_visit: q.annexure_site_visit || q.site_visit || '',
					annexure_quotation_validity:
						q.annexure_quotation_validity || q.quotation_validity || '',
					annexure_mode_of_delivery:
						q.annexure_mode_of_delivery || q.mode_of_delivery || '',
					annexure_revision: q.annexure_revision || q.revision || '',
					annexure_exclusions: q.annexure_exclusions || q.exclusion || '',
					annexure_billing_payment_terms:
						q.annexure_billing_payment_terms ||
						q.billing_and_payment_terms ||
						'',
					annexure_confidentiality: q.annexure_confidentiality || '',
					annexure_codes_standards: q.annexure_codes_standards || '',
					annexure_dispute_resolution: q.annexure_dispute_resolution || '',
				});
			}
		} catch (error) {
			console.error('Error fetching quotation:', error);
		} finally {
			setLoading(false);
		}
	}, [id, source]);

	useEffect(() => {
		if (!authLoading && user && id) {
			fetchQuotation();
		}
	}, [authLoading, user, id, fetchQuotation]);

	// Download/Print quotation
	const handleDownload = () => {
		window.open(
			`/api/admin/quotations/download?id=${id}&source=${source}`,
			'_blank'
		);
	};

	// Format currency
	const formatCurrency = (amount) => {
		return new Intl.NumberFormat('en-IN', {
			style: 'currency',
			currency: 'INR',
			minimumFractionDigits: 2,
		}).format(amount || 0);
	};

	if (authLoading || loading) {
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
								onClick={() => router.back()}
								className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
							>
								<ArrowLeftIcon className="h-5 w-5 text-gray-600" />
							</button>
							<div>
								<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
									<DocumentTextIcon className="h-7 w-7 text-purple-600" />
									View Quotation
								</h1>
								<p className="text-sm text-gray-500 mt-1">
									{quotation.quotation_number}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<button
								onClick={handleDownload}
								className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
							>
								<PrinterIcon className="h-5 w-5" />
								Print
							</button>
						</div>
					</div>

					{/* Quotation Form - Read-only */}
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

						<div className="p-6">
							{/* Top Section - Client Info & Quotation Details */}
							<div className="border border-gray-300 mb-4">
								<div className="flex">
									{/* Left - To Section */}
									<div className="flex-1 border-r border-gray-300 p-4">
										<label className="block text-sm font-semibold text-gray-700 mb-2">
											To,
										</label>
										<div className="font-medium text-gray-900 mb-2">
											{quotation.client_name}
										</div>
										<div className="text-sm text-gray-600 whitespace-pre-line">
											{quotation.client_address}
										</div>
									</div>

									{/* Right - Quotation Details */}
									<div className="w-80">
										<div className="flex border-b border-gray-300">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												Quotation No.
											</div>
											<div className="w-1/2 p-2 text-sm">
												{quotation.quotation_number}
											</div>
										</div>
										<div className="flex border-b border-gray-300">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												Date of Quotation
											</div>
											<div className="w-1/2 p-2 text-sm">
												{quotation.quotation_date}
											</div>
										</div>
										<div className="flex border-b border-gray-300">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												Enquiry No.
											</div>
											<div className="w-1/2 p-2 text-sm">
												{quotation.enquiry_number}
											</div>
										</div>
										<div className="flex">
											<div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">
												Date of Enquiry
											</div>
											<div className="w-1/2 p-2 text-sm">
												{quotation.enquiry_date}
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Kind Attn */}
							<div className="border border-gray-300 mb-4">
								<div className="flex items-center">
									<div className="w-24 p-3 bg-gray-50 font-semibold text-sm border-r border-gray-300">
										Kind Attn:
									</div>
									<div className="flex-1 p-2 text-sm">
										{quotation.kind_attn}
									</div>
								</div>
							</div>

							{/* Scope of Work Table */}
							<div className="border border-gray-300 mb-4">
								<table className="w-full">
									<thead>
										<tr className="bg-gray-50">
											<th className="w-16 p-3 text-left text-sm font-semibold border-r border-b border-gray-300">
												Sr. No.
											</th>
											<th className="p-3 text-left text-sm font-semibold border-r border-b border-gray-300">
												Scope of the Work
											</th>
											<th className="w-24 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">
												Qty.
											</th>
											<th className="w-28 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">
												Rate
											</th>
											<th className="w-32 p-3 text-center text-sm font-semibold border-b border-gray-300">
												Amount
											</th>
										</tr>
									</thead>
									<tbody>
										{quotation.scope_items.map((item, index) => (
											<tr key={index}>
												<td className="p-2 border-r border-b border-gray-300 text-center text-sm">
													{item.sr_no}
												</td>
												<td className="p-2 border-r border-b border-gray-300 text-sm whitespace-pre-line">
													{item.description}
												</td>
												<td className="p-2 border-r border-b border-gray-300 text-sm text-center">
													{item.qty}
												</td>
												<td className="p-2 border-r border-b border-gray-300 text-sm text-right">
													{formatCurrency(item.rate)}
												</td>
												<td className="p-2 border-r border-b border-gray-300 text-sm text-right">
													{formatCurrency(item.amount)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* Totals Section */}
							<div className="border border-gray-300 mb-4">
								<div className="flex justify-end">
									<div className="w-80">
										<div className="flex border-b border-gray-300">
											<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm text-right">
												Gross Amount:
											</div>
											<div className="w-32 p-2 text-right font-medium">
												{formatCurrency(quotation.gross_amount)}
											</div>
										</div>
										<div className="flex border-b border-gray-300">
											<div className="flex-1 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm text-right">
												GST @ {quotation.gst_percentage}%:
											</div>
											<div className="w-32 p-2 text-right font-medium">
												{formatCurrency(quotation.gst_amount)}
											</div>
										</div>
										<div className="flex bg-purple-50">
											<div className="flex-1 p-2 border-r border-gray-300 font-bold text-sm text-right">
												Net Amount:
											</div>
											<div className="w-32 p-2 text-right font-bold text-purple-700">
												{formatCurrency(quotation.net_amount)}
											</div>
										</div>
									</div>
								</div>
							</div>

							{/* Amount in Words */}
							<div className="border border-gray-300 mb-4">
								<div className="flex">
									<div className="w-32 p-3 bg-gray-50 font-semibold text-sm border-r border-gray-300">
										Amount in words:
									</div>
									<div className="flex-1 p-3 text-sm italic">
										{quotation.amount_in_words}
									</div>
								</div>
							</div>

							{/* GST/PAN/TAN */}
							<div className="border border-gray-300 mb-4">
								<div className="flex">
									<div className="flex-1 border-r border-gray-300">
										<div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">
											GST Number
										</div>
										<div className="p-2 text-sm text-center">
											{quotation.gst_number}
										</div>
									</div>
									<div className="flex-1 border-r border-gray-300">
										<div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">
											Pan Number
										</div>
										<div className="p-2 text-sm text-center">
											{quotation.pan_number}
										</div>
									</div>
									<div className="flex-1">
										<div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">
											Tan Number
										</div>
										<div className="p-2 text-sm text-center">
											{quotation.tan_number}
										</div>
									</div>
								</div>
							</div>

							{/* Terms and Conditions */}
							<div className="border border-gray-300 mb-4">
								<div className="p-3 bg-gray-50 font-semibold text-sm border-b border-gray-300">
									General Terms and conditions
								</div>
								<div className="p-3 text-sm whitespace-pre-line">
									{quotation.terms_and_conditions}
								</div>
							</div>

							{/* Annexure Section */}
							<div className="border border-gray-300 mb-4">
								<div className="p-3 bg-purple-50 font-semibold text-lg border-b border-gray-300 text-center">
									ANNEXURE – I
								</div>

								{/* Numbered Annexure Fields */}
								<div className="p-4 space-y-4">
									{/* 1. Scope of Work */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											1)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Scope of Work:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_scope_of_work}
											</div>
										</div>
									</div>

									{/* 2. Input Document */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											2)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Input Document:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_input_document}
											</div>
										</div>
									</div>

									{/* 3. Deliverables */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											3)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Deliverables:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_deliverables}
											</div>
										</div>
									</div>

									{/* 4. Software */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											4)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Software:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_software}
											</div>
										</div>
									</div>

									{/* 5. Duration */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											5)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Duration:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_duration}
											</div>
										</div>
									</div>

									{/* 6. Site Visit */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											6)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Site Visit:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_site_visit}
											</div>
										</div>
									</div>

									{/* 7. Quotation Validity */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											7)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Quotation Validity:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_quotation_validity}
											</div>
										</div>
									</div>

									{/* 8. Mode of Delivery */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											8)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Mode of Delivery:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_mode_of_delivery}
											</div>
										</div>
									</div>

									{/* 9. Revision */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											9)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Revision:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_revision}
											</div>
										</div>
									</div>

									{/* 10. Exclusions */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											10)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Exclusions:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_exclusions}
											</div>
										</div>
									</div>

									{/* 11. Billing & Payment Terms */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											11)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Billing & Payment Terms:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_billing_payment_terms}
											</div>
										</div>
									</div>

									{/* 12. Confidentiality */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											12)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Confidentiality:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_confidentiality}
											</div>
										</div>
									</div>

									{/* 13. Codes & Standards */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											13)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Codes & Standards:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_codes_standards}
											</div>
										</div>
									</div>

									{/* 14. Dispute Resolution */}
									<div className="flex items-start gap-3">
										<span className="text-sm font-semibold w-6 shrink-0">
											14)
										</span>
										<div className="flex-1">
											<label className="block text-sm font-semibold mb-1">
												Dispute Resolution:
											</label>
											<div className="text-sm whitespace-pre-line">
												{quotation.annexure_dispute_resolution}
											</div>
										</div>
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
