const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_TERMS_OPTIONS = ['Net 30', 'Net 45', 'Net 60', 'Advance'];
const INVOICING_STATUS_OPTIONS = [
	'Uninvoiced',
	'Partially Invoiced',
	'Invoiced',
	'Paid',
];

export default function CommercialTab({ form, handleChange }) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm">
			<div className="px-6 py-4 border-b border-gray-200">
				<h2 className="text-sm font-semibold text-black">Commercial Details</h2>
			</div>
			<div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Project Value
					</label>
					<input
						type="number"
						name="project_value"
						value={form.project_value}
						onChange={handleChange}
						step="0.01"
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Currency
					</label>
					<select
						name="currency"
						value={form.currency}
						onChange={handleChange}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					>
						{CURRENCY_OPTIONS.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Payment Terms
					</label>
					<select
						name="payment_terms"
						value={form.payment_terms}
						onChange={handleChange}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					>
						<option value="">Select Terms</option>
						{PAYMENT_TERMS_OPTIONS.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Invoicing Status
					</label>
					<select
						name="invoicing_status"
						value={form.invoicing_status}
						onChange={handleChange}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					>
						<option value="">Select Status</option>
						{INVOICING_STATUS_OPTIONS.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Cost to Company
					</label>
					<input
						type="number"
						name="cost_to_company"
						value={form.cost_to_company}
						onChange={handleChange}
						step="0.01"
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Profitability Estimate (%)
					</label>
					<input
						type="number"
						name="profitability_estimate"
						value={form.profitability_estimate}
						onChange={handleChange}
						step="0.01"
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Budget
					</label>
					<input
						type="number"
						name="budget"
						value={form.budget}
						onChange={handleChange}
						step="0.01"
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div className="md:col-span-2">
					<label className="block text-xs font-medium text-black mb-1">
						Subcontractors / Vendors
					</label>
					<textarea
						name="subcontractors_vendors"
						value={form.subcontractors_vendors}
						onChange={handleChange}
						rows={3}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
			</div>
		</section>
	);
}
