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
		<div className="space-y-20">
			<section
				className="rounded-2xl overflow-hidden"
				style={{
					background:
						'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
					border: '1.5px solid rgba(139, 92, 246, 0.1)',
					boxShadow:
						'0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
				}}
			>
				<div
					className="px-6 py-4"
					style={{
						background:
							'linear-gradient(135deg, rgba(139, 92, 246, 0.03) 0%, rgba(124, 58, 237, 0.02) 100%)',
						borderBottom: '1.5px solid rgba(139, 92, 246, 0.08)',
					}}
				>
					<div className="flex items-center gap-3">
						<div
							className="p-2 rounded-xl"
							style={{
								background:
									'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
								border: '1px solid rgba(139, 92, 246, 0.2)',
							}}
						>
							<DocumentIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />
						</div>
						<div>
							<h2
								className="text-base font-bold"
								style={{
									color: '#0f172a',
									letterSpacing: '-0.01em',
								}}
							>
								General Project Information
							</h2>
							<p className="text-xs font-medium" style={{ color: '#64748b' }}>
								Core project details and metadata
							</p>
						</div>
					</div>
				</div>
				<div className="px-6 py-6 space-y-5">
					{/* Enhanced Basic Details Section */}
					<div
						className="rounded-xl overflow-hidden"
						style={{
							background:
								'linear-gradient(135deg, rgba(139, 92, 246, 0.02) 0%, rgba(255, 255, 255, 0.5) 100%)',
							border: '1.5px solid rgba(139, 92, 246, 0.1)',
							boxShadow: '0 2px 8px rgba(15, 23, 42, 0.02)',
						}}
					>
						<button
							type="button"
							onClick={() => toggleSection('basic')}
							className="w-full flex items-center justify-between px-4 py-3 transition-all duration-300 group"
							onMouseEnter={(e) => {
								e.currentTarget.style.background = 'rgba(139, 92, 246, 0.04)';
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.background = 'transparent';
							}}
						>
							<div className="flex items-center gap-3">
								<div
									className="p-1.5 rounded-lg transition-all duration-300"
									style={{
										background:
											'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
										border: '1px solid rgba(139, 92, 246, 0.15)',
										transform: openSections.basic
											? 'rotate(180deg)'
											: 'rotate(0deg)',
									}}
								>
									<ChevronDownIcon
										className="h-4 w-4"
										style={{ color: '#8b5cf6' }}
									/>
								</div>
								<h3 className="text-sm font-bold" style={{ color: '#0f172a' }}>
									Basic Details
								</h3>
							</div>
							<span
								className="text-xs font-bold px-2 py-1 rounded-md"
								style={{
									background: openSections.basic
										? 'rgba(139, 92, 246, 0.1)'
										: 'rgba(100, 116, 139, 0.06)',
									color: openSections.basic ? '#8b5cf6' : '#64748b',
								}}
							>
								{openSections.basic ? 'Collapse' : 'Expand'}
							</span>
						</button>

						{openSections.basic && (
							<div
								className="px-4 pb-4 pt-3 space-y-6"
								style={{
									borderTop: '1.5px solid rgba(139, 92, 246, 0.08)',
								}}
							>
								<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
									<div className="space-y-2">
										<label
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Code
										</label>
										<input
											type="text"
											name="project_code"
											value={form.project_code}
											onChange={handleChange}
											placeholder="Enter project code"
											className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 hover:border-violet-300"
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
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Name <span style={{ color: '#ef4444' }}>*</span>
										</label>
										<input
											type="text"
											name="name"
											value={form.name}
											onChange={handleChange}
											placeholder="Enter project name"
											className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 hover:border-violet-300"
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
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Client Name <span style={{ color: '#ef4444' }}>*</span>
										</label>
										<input
											type="text"
											name="client_name"
											value={form.client_name}
											onChange={handleChange}
											placeholder="Enter client name"
											className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 hover:border-violet-300"
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
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Start Date
										</label>
										<input
											type="date"
											name="start_date"
											value={form.start_date}
											onChange={handleChange}
											className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 hover:border-violet-300"
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
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project End Date
										</label>
										<input
											type="date"
											name="end_date"
											value={form.end_date}
											onChange={handleChange}
											className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 hover:border-violet-300"
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
											className="block text-xs font-bold"
											style={{
												color: '#475569',
												letterSpacing: '0.01em',
											}}
										>
											Project Type
										</label>
										<select
											name="contract_type"
											value={form.contract_type}
											onChange={handleChange}
											className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
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
										<label className="block text-sm font-semibold text-gray-700">
											Estimated Manhours
										</label>
										<input
											type="number"
											name="estimated_manhours"
											value={form.estimated_manhours}
											onChange={handleChange}
											step="0.1"
											placeholder="0.0"
											className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
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
					<div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
						<button
							type="button"
							onClick={() => toggleSection('deliverables')}
							className="w-full flex items-center justify-between group hover:bg-white/50 rounded-md px-2 py-1.5 transition-colors"
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
									<label className="block text-sm font-semibold text-gray-700">
										List of Deliverables
									</label>
									<textarea
										name="list_of_deliverables"
										value={form.list_of_deliverables}
										onChange={handleChange}
										rows={4}
										placeholder="List the key deliverables for this project..."
										className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-y focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
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
