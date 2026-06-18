import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function SoftwareTab({
	selectedSoftwareCategory,
	setSelectedSoftwareCategory,
	selectedSoftware,
	setSelectedSoftware,
	selectedSoftwareVersion,
	setSelectedSoftwareVersion,
	softwareCategories,
	availableSoftware,
	availableVersions,
	softwareItems,
	addSoftwareItem,
	removeSoftwareItem,
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
							d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
						/>
					</svg>
					<h2 className="text-sm font-bold text-gray-900">Project Software</h2>
				</div>
				<p className="text-xs text-gray-500 mt-0.5">
					Manage software and tools used in this project
				</p>
			</div>

			<div className="px-6 py-5 space-y-4">
				{/* Add Software Form */}
				<div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
					<h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
						<PlusIcon className="h-4 w-4 text-[#7F2487]" />
						Add Software
					</h4>
					<div className="space-y-3">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
							<div>
								<label className="block text-xs font-medium text-gray-600 mb-1">
									Category *
								</label>
								<select
									value={selectedSoftwareCategory}
									onChange={(e) => {
										setSelectedSoftwareCategory(e.target.value);
										setSelectedSoftware('');
										setSelectedSoftwareVersion('');
									}}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
								>
									<option value="">Select Category</option>
									{softwareCategories.map((cat) => (
										<option key={cat.id} value={cat.id}>
											{cat.name}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-600 mb-1">
									Software *
								</label>
								<select
									value={selectedSoftware}
									onChange={(e) => {
										setSelectedSoftware(e.target.value);
										setSelectedSoftwareVersion('');
									}}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
								>
									<option value="">Select Software</option>
									{availableSoftware.map((sw) => (
										<option key={sw.id} value={sw.id}>
											{sw.name}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-600 mb-1">
									Version *
								</label>
								<select
									value={selectedSoftwareVersion}
									onChange={(e) => setSelectedSoftwareVersion(e.target.value)}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
								>
									<option value="">Select Version</option>
									{availableVersions.map((ver) => (
										<option key={ver.id} value={ver.id}>
											{ver.name}
										</option>
									))}
								</select>
							</div>
						</div>
						<div className="flex justify-end">
							<button
								type="button"
								onClick={addSoftwareItem}
								disabled={
									!selectedSoftwareCategory ||
									!selectedSoftware ||
									!selectedSoftwareVersion
								}
								className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
									selectedSoftwareCategory &&
									selectedSoftware &&
									selectedSoftwareVersion
										? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]'
										: 'bg-gray-100 text-gray-400 cursor-not-allowed'
								}`}
							>
								<PlusIcon className="h-3.5 w-3.5" />
								Add Software
							</button>
						</div>
					</div>
				</div>

				{/* Software List */}
				{softwareItems.length > 0 ? (
					<div className="overflow-x-auto border border-gray-200 rounded-lg">
						<table className="w-full text-xs">
							<thead className="bg-gray-50 border-b border-gray-200">
								<tr>
									<th className="px-3 py-2 text-left font-semibold text-gray-700 w-12">
										Sr. No.
									</th>
									<th className="px-3 py-2 text-left font-semibold text-gray-700">
										Category
									</th>
									<th className="px-3 py-2 text-left font-semibold text-gray-700">
										Software
									</th>
									<th className="px-3 py-2 text-left font-semibold text-gray-700">
										Provider
									</th>
									<th className="px-3 py-2 text-left font-semibold text-gray-700">
										Version
									</th>
									<th className="px-3 py-2 text-left font-semibold text-gray-700">
										Release Date
									</th>
									<th className="px-3 py-2 text-left font-semibold text-gray-700">
										Notes
									</th>
									<th className="px-3 py-2 text-center font-semibold text-gray-700">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{softwareItems.map((item, index) => (
									<tr
										key={item.id}
										className="hover:bg-gray-50 transition-colors"
									>
										<td className="px-3 py-2 text-gray-500 font-medium">
											{index + 1}
										</td>
										<td className="px-3 py-2 text-gray-900 font-medium">
											{item.category_name}
										</td>
										<td className="px-3 py-2 text-gray-900 font-medium">
											{item.software_name}
										</td>
										<td className="px-3 py-2 text-gray-600">
											{item.provider || '-'}
										</td>
										<td className="px-3 py-2 text-gray-600">
											{item.version_name}
										</td>
										<td className="px-3 py-2 text-gray-600">
											{item.release_date || '-'}
										</td>
										<td className="px-3 py-2 text-gray-600">
											{item.notes || '-'}
										</td>
										<td className="px-3 py-2 text-center">
											<button
												type="button"
												onClick={() => removeSoftwareItem(item.id)}
												className="text-red-500 hover:text-red-700 p-1"
												title="Remove software"
											>
												<XMarkIcon className="h-4 w-4" />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="text-center py-12 text-gray-500">
						<svg
							className="h-12 w-12 mx-auto text-gray-300 mb-3"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
							/>
						</svg>
						<p className="text-sm font-medium">No software added yet</p>
						<p className="text-xs mt-1">
							Select category, software, and version to add to the project
						</p>
					</div>
				)}
			</div>
		</section>
	);
}
