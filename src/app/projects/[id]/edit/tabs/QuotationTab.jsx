export default function QuotationTab({
	form,
	canEditQuotations,
	quotationData = {},
}) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm">
			<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
				<div>
					<h2 className="text-sm font-semibold text-black">
						Quotation Details
					</h2>
					<p className="text-xs text-gray-600 mt-1">
						Quotation generated from proposal
						{form.proposal_id ? ` (${form.proposal_id})` : ''}
					</p>
				</div>
				{canEditQuotations && form.proposal_id && (
					<button
						type="button"
						onClick={() =>
							window.open(
								`/admin/quotation/${form.proposal_id}/edit?source=proposal`,
								'_blank'
							)
						}
						className="px-4 py-2 bg-[#7F2487] text-white text-xs font-medium rounded-md hover:bg-[#6a1f72] flex items-center gap-2"
					>
						Edit & Download Quotation
					</button>
				)}
			</div>
			<div className="p-6">
				{!form.proposal_id ? (
					<p className="text-sm text-gray-500 text-center py-8">
						No proposal linked to this project. Quotation data is generated from
						the proposal.
					</p>
				) : (
					<>
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Quotation Number
								</label>
								<p className="text-sm text-gray-900">
									{quotationData.quotation_number || '—'}
								</p>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Quotation Date
								</label>
								<p className="text-sm text-gray-900">
									{quotationData.quotation_date
										? new Date(quotationData.quotation_date).toLocaleDateString(
												'en-IN'
											)
										: '—'}
								</p>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Client Name
								</label>
								<p className="text-sm text-gray-900">
									{quotationData.client_name || '—'}
								</p>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Enquiry Number
								</label>
								<p className="text-sm text-gray-900">
									{quotationData.enquiry_number || '—'}
								</p>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Gross Amount
								</label>
								<p className="text-sm text-gray-900">
									{quotationData.gross_amount
										? `₹ ${parseFloat(quotationData.gross_amount).toLocaleString('en-IN')}`
										: '—'}
								</p>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									GST ({quotationData.gst_percentage || '18'}%)
								</label>
								<p className="text-sm text-gray-900">
									{quotationData.gst_amount
										? `₹ ${parseFloat(quotationData.gst_amount).toLocaleString('en-IN')}`
										: '—'}
								</p>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Net Amount
								</label>
								<p className="text-sm text-gray-900 font-semibold">
									{quotationData.net_amount
										? `₹ ${parseFloat(quotationData.net_amount).toLocaleString('en-IN')}`
										: '—'}
								</p>
							</div>
							{quotationData.amount_in_words && (
								<div className="md:col-span-2">
									<label className="block text-xs font-medium text-gray-500 mb-1">
										Amount in Words
									</label>
									<p className="text-sm text-gray-900">
										{quotationData.amount_in_words}
									</p>
								</div>
							)}
						</div>
						{/* Scope Items Table */}
						{quotationData.scope_items &&
							quotationData.scope_items.length > 0 &&
							quotationData.scope_items[0]?.description && (
								<div className="mt-6">
									<label className="block text-xs font-medium text-gray-500 mb-2">
										Scope Items
									</label>
									<div className="border border-gray-200 rounded-lg overflow-hidden">
										<table className="w-full text-sm">
											<thead className="bg-gray-50">
												<tr>
													<th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
														Sr.
													</th>
													<th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
														Description
													</th>
													<th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
														Qty
													</th>
													<th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
														Rate
													</th>
													<th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
														Amount
													</th>
												</tr>
											</thead>
											<tbody>
												{quotationData.scope_items.map((item, idx) => (
													<tr key={idx} className="border-t border-gray-100">
														<td className="px-4 py-2 text-gray-600">
															{item.sr_no || idx + 1}
														</td>
														<td className="px-4 py-2 text-gray-900">
															{item.description || '—'}
														</td>
														<td className="px-4 py-2 text-right text-gray-600">
															{item.qty || '—'}
														</td>
														<td className="px-4 py-2 text-right text-gray-600">
															{item.rate
																? `₹ ${parseFloat(item.rate).toLocaleString('en-IN')}`
																: '—'}
														</td>
														<td className="px-4 py-2 text-right text-gray-900 font-medium">
															{item.amount
																? `₹ ${parseFloat(item.amount).toLocaleString('en-IN')}`
																: '—'}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
						{quotationData.scope_of_work && (
							<div className="mt-6">
								<label className="block text-xs font-medium text-gray-500 mb-1">
									Scope of Work
								</label>
								<p className="text-sm text-gray-900 whitespace-pre-wrap">
									{quotationData.scope_of_work}
								</p>
							</div>
						)}
					</>
				)}
			</div>
		</section>
	);
}
