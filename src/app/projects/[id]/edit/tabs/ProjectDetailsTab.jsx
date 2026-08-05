import { DocumentIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

export default function ProjectDetailsTab({
	form,
	handleChange,
	toggleSection,
	openSections,
	TYPE_OPTIONS,
	docMaster,
	newInputDocument,
	setNewInputDocument,
	addInputDocument,
}) {
	return (
		<div className="space-y-6">
			<section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
				<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
					<div className="flex items-center gap-3">
						<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
							<DocumentIcon
								className="h-4 w-4 text-purple-600"
								aria-hidden="true"
							/>
						</div>
						<div>
							<h2 className="text-base font-semibold tracking-tight text-gray-900">
								General Project Information
							</h2>
							<p className="text-xs text-gray-500">
								Core project details and metadata
							</p>
						</div>
					</div>
				</div>
				<div className="px-6 py-6 space-y-5">
					{/* Enhanced Basic Details Section */}
					<div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/40">
						<button
							type="button"
							onClick={() => toggleSection('basic')}
							aria-expanded={openSections.basic}
							className="group flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-purple-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500"
						>
							<div className="flex items-center gap-3">
								<div
									className={`rounded-lg bg-white p-1.5 ring-1 ring-inset ring-gray-200 transition-transform duration-200 ${openSections.basic ? 'rotate-180' : ''}`}
								>
									<ChevronDownIcon
										className="h-4 w-4 text-purple-600"
										aria-hidden="true"
									/>
								</div>
								<h3 className="text-sm font-semibold text-gray-900">
									Basic Details
								</h3>
							</div>
							<span
								className={`rounded-md px-2 py-1 text-xs font-semibold ${openSections.basic ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'}`}
							>
								{openSections.basic ? 'Collapse' : 'Expand'}
							</span>
						</button>

						{openSections.basic && (
							<div className="space-y-6 border-t border-gray-200 px-4 pb-4 pt-4">
								<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
									<div className="space-y-2">
										<label
											htmlFor="project-code"
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Code
										</label>
										<input
											id="project-code"
											type="text"
											name="project_code"
											value={form.project_code}
											onChange={handleChange}
											placeholder="Enter project code"
											className="w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 hover:border-purple-300"
											style={{
												background: 'rgba(255, 255, 255, 0.95)',
												border: '1.5px solid rgba(139, 92, 246, 0.15)',
												color: '#1e293b',
												boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)',
											}}
										/>
										<p className="text-[10px] text-gray-500">
											Human-readable project code. Can be edited.
										</p>
									</div>
									<div className="space-y-2">
										<label
											htmlFor="project-name"
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Name <span style={{ color: '#ef4444' }}>*</span>
										</label>
										<input
											id="project-name"
											type="text"
											name="name"
											value={form.name}
											onChange={handleChange}
											placeholder="Enter project name"
											className="w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 hover:border-purple-300"
											style={{
												background: 'rgba(255, 255, 255, 0.95)',
												border: '1.5px solid rgba(139, 92, 246, 0.15)',
												color: '#1e293b',
												boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)',
											}}
										/>
									</div>
									<div className="space-y-2">
										<label
											htmlFor="client-name"
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Client Name <span style={{ color: '#ef4444' }}>*</span>
										</label>
										<input
											id="client-name"
											type="text"
											name="client_name"
											value={form.client_name}
											onChange={handleChange}
											placeholder="Enter client name"
											className="w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 hover:border-purple-300"
											style={{
												background: 'rgba(255, 255, 255, 0.95)',
												border: '1.5px solid rgba(139, 92, 246, 0.15)',
												color: '#1e293b',
												boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)',
											}}
										/>
									</div>
									<div className="space-y-2">
										<label
											htmlFor="project-start-date"
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Start Date
										</label>
										<input
											id="project-start-date"
											type="date"
											name="start_date"
											value={form.start_date}
											onChange={handleChange}
											className="w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 hover:border-purple-300"
											style={{
												background: 'rgba(255, 255, 255, 0.95)',
												border: '1.5px solid rgba(139, 92, 246, 0.15)',
												color: '#1e293b',
												boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)',
											}}
										/>
									</div>
									<div className="space-y-2">
										<label
											htmlFor="project-end-date"
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project End Date
										</label>
										<input
											id="project-end-date"
											type="date"
											name="end_date"
											value={form.end_date}
											onChange={handleChange}
											className="w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-[border-color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 hover:border-purple-300"
											style={{
												background: 'rgba(255, 255, 255, 0.95)',
												border: '1.5px solid rgba(139, 92, 246, 0.15)',
												color: '#1e293b',
												boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)',
											}}
										/>
									</div>
									<div className="space-y-2">
										<label
											htmlFor="project-type"
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Type
										</label>
										<select
											id="project-type"
											name="contract_type"
											value={form.contract_type}
											onChange={handleChange}
											className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
										>
											<option value="">Select Type</option>
											{TYPE_OPTIONS.map((type) => (
												<option key={type} value={type}>
													{type}
												</option>
											))}
										</select>
									</div>
									<div className="space-y-2">
										<label
											htmlFor="estimated-manhours"
											className="block text-sm font-semibold text-gray-700"
										>
											Estimated Manhours
										</label>
										<input
											id="estimated-manhours"
											type="number"
											name="estimated_manhours"
											value={form.estimated_manhours}
											onChange={handleChange}
											step="0.1"
											placeholder="0.0"
											className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
										/>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Suggestions from Document Master */}
					{docMaster && docMaster.length > 0 && (
						<div className="mb-3 flex flex-wrap gap-2">
							{docMaster
								.filter(
									(d) =>
										!newInputDocument ||
										(typeof newInputDocument === 'string' &&
											(d.name
												?.toLowerCase()
												.includes(newInputDocument.toLowerCase()) ||
												d.doc_key
													?.toLowerCase()
													.includes(newInputDocument.toLowerCase()))) ||
										(typeof newInputDocument === 'object' &&
											newInputDocument.description &&
											(d.name
												?.toLowerCase()
												.includes(newInputDocument.description.toLowerCase()) ||
												d.doc_key
													?.toLowerCase()
													.includes(
														newInputDocument.description.toLowerCase()
													)))
								)
								.slice(0, 8)
								.map((d) => (
									<button
										key={d.id}
										type="button"
										onClick={() => {
											if (typeof newInputDocument === 'object') {
												setNewInputDocument((prev) => ({
													...prev,
													description: d.name,
												}));
											} else {
												setNewInputDocument(d.name);
											}
											addInputDocument();
										}}
										className="px-2 py-1 text-xs rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
										title={d.description || ''}
									>
										{d.name}
									</button>
								))}
						</div>
					)}

					{/* Enhanced Deliverables Section */}
					<div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4 shadow-sm">
						<button
							aria-expanded={openSections.deliverables}
							type="button"
							onClick={() => toggleSection('deliverables')}
							className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500"
						>
							<div className="flex items-center gap-2">
								<ChevronDownIcon
									className={`h-3.5 w-3.5 text-purple-600 transition-transform ${openSections.deliverables ? 'rotate-180' : ''}`}
								/>
								<h3 className="text-sm font-semibold text-gray-700">
									Project Deliverables
								</h3>
							</div>
							<span className="text-xs text-purple-600">
								{openSections.deliverables ? '−' : '+'}
							</span>
						</button>

						{openSections.deliverables && (
							<div className="mt-4 space-y-4 pt-3 border-t border-purple-100">
								<div className="space-y-3">
									<label
										htmlFor="project-deliverables"
										className="block text-sm font-semibold text-gray-700"
									>
										List of Deliverables
									</label>
									<textarea
										id="project-deliverables"
										name="list_of_deliverables"
										value={form.list_of_deliverables}
										onChange={handleChange}
										rows={4}
										placeholder="List the key deliverables for this project..."
										className="w-full resize-y rounded-lg border border-gray-300 px-4 py-3 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}
