import { XMarkIcon } from '@heroicons/react/24/outline';

export default function ProjectHandoverTab({
	newHandoverDescRef,
	newHandoverRow,
	setNewHandoverRow,
	addHandoverRow,
	projectHandover,
	updateHandoverRow,
	removeHandoverRow,
}) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
			<div className="px-4 py-7 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
				<h2 className="text-sm font-bold text-gray-900 px-2">
					Progress Measurement & Handover
				</h2>
			</div>

			<div className="px-6 py-5">
				<div className="overflow-x-auto border border-gray-200 rounded-lg">
					<table className="w-full text-xs border-collapse">
						<thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
							<tr>
								<th className="text-center py-2 px-2 font-semibold text-gray-700">
									Sr No
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Output by Accent
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Requirement Accomplished
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Remark
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Hand Over
								</th>
								<th className="text-center py-2 px-2 font-semibold text-gray-700">
									Action
								</th>
							</tr>
						</thead>
						<tbody>
							<tr className="bg-purple-25/30 border-b-2 border-purple-100">
								<td className="py-2 px-2 text-center text-gray-400 font-semibold">
									+
								</td>
								<td className="py-2 px-2">
									<input
										ref={newHandoverDescRef}
										type="text"
										value={newHandoverRow.output_by_accent}
										onChange={(e) =>
											setNewHandoverRow((prev) => ({
												...prev,
												output_by_accent: e.target.value,
											}))
										}
										placeholder="Output by Accent"
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<select
										value={newHandoverRow.requirement_accomplished}
										onChange={(e) =>
											setNewHandoverRow((prev) => ({
												...prev,
												requirement_accomplished: e.target.value,
											}))
										}
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									>
										<option value="">Select</option>
										<option value="Y">Y</option>
										<option value="N">N</option>
									</select>
								</td>
								<td className="py-2 px-2">
									<input
										type="text"
										value={newHandoverRow.remark}
										onChange={(e) =>
											setNewHandoverRow((prev) => ({
												...prev,
												remark: e.target.value,
											}))
										}
										placeholder="Remark"
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<select
										value={newHandoverRow.hand_over}
										onChange={(e) =>
											setNewHandoverRow((prev) => ({
												...prev,
												hand_over: e.target.value,
											}))
										}
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									>
										<option value="">Select</option>
										<option value="Y">Y</option>
										<option value="N">N</option>
									</select>
								</td>
								<td className="py-2 px-2 text-center">
									<button
										type="button"
										onClick={addHandoverRow}
										disabled={
											!(
												newHandoverRow.output_by_accent &&
												newHandoverRow.output_by_accent.trim()
											)
										}
										className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
										title="Add handover item"
									>
										Add
									</button>
								</td>
							</tr>
							{projectHandover.map((r, index) => (
								<tr
									key={r.id}
									className="hover:bg-gray-50 transition-colors align-top"
								>
									<td className="py-2 px-2 text-center">{index + 1}</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={r.output_by_accent || ''}
											onChange={(e) =>
												updateHandoverRow(
													r.id,
													'output_by_accent',
													e.target.value
												)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<select
											value={r.requirement_accomplished || ''}
											onChange={(e) =>
												updateHandoverRow(
													r.id,
													'requirement_accomplished',
													e.target.value
												)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										>
											<option value="">Select</option>
											<option value="Y">Y</option>
											<option value="N">N</option>
										</select>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={r.remark || ''}
											onChange={(e) =>
												updateHandoverRow(r.id, 'remark', e.target.value)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<select
											value={r.hand_over || ''}
											onChange={(e) =>
												updateHandoverRow(r.id, 'hand_over', e.target.value)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										>
											<option value="">Select</option>
											<option value="Y">Y</option>
											<option value="N">N</option>
										</select>
									</td>
									<td className="py-2 px-2 text-center">
										<button
											type="button"
											onClick={() => removeHandoverRow(r.id)}
											className="text-red-500 hover:text-red-700 p-1"
											title="Remove item"
										>
											<XMarkIcon className="h-4 w-4" />
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}
