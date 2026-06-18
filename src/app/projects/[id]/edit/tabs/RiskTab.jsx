export default function RiskTab({ form, handleChange }) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm">
			<div className="px-6 py-4 border-b border-gray-200">
				<h2 className="text-sm font-semibold text-black">Risk & Issues</h2>
			</div>
			<div className="px-6 py-5 space-y-4">
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Major Risks
					</label>
					<textarea
						name="major_risks"
						value={form.major_risks}
						onChange={handleChange}
						rows={3}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Mitigation Plans
					</label>
					<textarea
						name="mitigation_plans"
						value={form.mitigation_plans}
						onChange={handleChange}
						rows={3}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Change Orders
					</label>
					<textarea
						name="change_orders"
						value={form.change_orders}
						onChange={handleChange}
						rows={3}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Claims / Disputes
					</label>
					<textarea
						name="claims_disputes"
						value={form.claims_disputes}
						onChange={handleChange}
						rows={3}
						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
					/>
				</div>
			</div>
		</section>
	);
}
