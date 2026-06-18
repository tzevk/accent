import { XMarkIcon } from '@heroicons/react/24/outline';

export default function QueryLogTab({
	newQueryDescRef,
	newQuery,
	setNewQuery,
	addQueryRow,
	queryLog,
	updateQueryRow,
	removeQueryRow,
}) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
			<div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
				<div className="flex items-center gap-2">
					<svg
						className="h-4 w-4 text-[#7F2487]"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<h2 className="text-sm font-bold text-gray-900">Query Log</h2>
				</div>
				<p className="text-xs text-gray-500 mt-0.5">
					Log project queries and responses
				</p>
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
									Query Description
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Issued Date
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Reply from Client
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Reply Received
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Updated By
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Resolved
								</th>
								<th className="text-left py-2 px-2 font-semibold text-gray-700">
									Remark
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
										ref={newQueryDescRef}
										type="text"
										value={newQuery.query_description}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												query_description: e.target.value,
											}))
										}
										placeholder="Query Description"
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<input
										type="date"
										value={newQuery.query_issued_date}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												query_issued_date: e.target.value,
											}))
										}
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<input
										type="text"
										value={newQuery.reply_from_client}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												reply_from_client: e.target.value,
											}))
										}
										placeholder="Reply from Client"
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<input
										type="date"
										value={newQuery.reply_received_date}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												reply_received_date: e.target.value,
											}))
										}
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<input
										type="text"
										value={newQuery.query_updated_by}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												query_updated_by: e.target.value,
											}))
										}
										placeholder="Updated By"
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2">
									<select
										value={newQuery.query_resolved}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												query_resolved: e.target.value,
											}))
										}
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									>
										<option value="">Select</option>
										<option value="Yes">Yes</option>
										<option value="No">No</option>
										<option value="Pending">Pending</option>
									</select>
								</td>
								<td className="py-2 px-2">
									<input
										type="text"
										value={newQuery.remark}
										onChange={(e) =>
											setNewQuery((prev) => ({
												...prev,
												remark: e.target.value,
											}))
										}
										placeholder="Remark"
										className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
									/>
								</td>
								<td className="py-2 px-2 text-center">
									<button
										type="button"
										onClick={addQueryRow}
										disabled={
											!(
												newQuery.query_description &&
												newQuery.query_description.trim()
											)
										}
										className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newQuery.query_description && newQuery.query_description.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
										title="Add query"
									>
										Add
									</button>
								</td>
							</tr>
							{queryLog.map((q, index) => (
								<tr
									key={q.id}
									className="hover:bg-gray-50 transition-colors align-top"
								>
									<td className="py-2 px-2 text-center">{index + 1}</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={q.query_description || ''}
											onChange={(e) =>
												updateQueryRow(
													q.id,
													'query_description',
													e.target.value
												)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="date"
											value={q.query_issued_date || ''}
											onChange={(e) =>
												updateQueryRow(
													q.id,
													'query_issued_date',
													e.target.value
												)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={q.reply_from_client || ''}
											onChange={(e) =>
												updateQueryRow(
													q.id,
													'reply_from_client',
													e.target.value
												)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="date"
											value={q.reply_received_date || ''}
											onChange={(e) =>
												updateQueryRow(
													q.id,
													'reply_received_date',
													e.target.value
												)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={q.query_updated_by || ''}
											onChange={(e) =>
												updateQueryRow(q.id, 'query_updated_by', e.target.value)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2">
										<select
											value={q.query_resolved || ''}
											onChange={(e) =>
												updateQueryRow(q.id, 'query_resolved', e.target.value)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										>
											<option value="">Select</option>
											<option value="Yes">Yes</option>
											<option value="No">No</option>
											<option value="Pending">Pending</option>
										</select>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={q.remark || ''}
											onChange={(e) =>
												updateQueryRow(q.id, 'remark', e.target.value)
											}
											className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
										/>
									</td>
									<td className="py-2 px-2 text-center">
										<button
											type="button"
											onClick={() => removeQueryRow(q.id)}
											className="text-red-500 hover:text-red-700 p-1"
											title="Remove query"
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
