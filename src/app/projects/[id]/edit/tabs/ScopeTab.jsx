import {
	DocumentIcon,
	CheckCircleIcon,
	PlusIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';

// Helper to safely render HTML content
function HtmlContent({ html, className = '' }) {
	if (!html) return null;
	// Check if content looks like HTML
	const hasHtmlTags = /<[^>]+>/.test(html);
	if (hasHtmlTags) {
		return (
			<div
				className={`text-sm text-gray-700 leading-relaxed rich-text-content ${className}`}
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		);
	}
	// Fallback for plain text (preserving line breaks)
	return (
		<p
			className={`text-sm text-gray-700 whitespace-pre-wrap leading-relaxed ${className}`}
		>
			{html}
		</p>
	);
}

export default function ScopeTab({ form, setForm }) {
	return (
		<section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="p-2 bg-purple-100 rounded-lg">
							<DocumentIcon className="h-5 w-5 text-[#7F2487]" />
						</div>
						<div>
							<h2 className="text-lg font-bold text-gray-900">Scope of Work</h2>
							<p className="text-xs text-gray-500">
								Define and manage project scope details
							</p>
						</div>
					</div>
					{/* Scope Summary Badge */}
					<div className="flex items-center gap-2">
						<span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
							{form.scope_of_work
								? 'Original Scope Defined'
								: 'No Original Scope'}
						</span>
						{form.additional_scope && (
							<span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
								Additional Scope Added
							</span>
						)}
					</div>
				</div>
			</div>

			<div className="px-6 py-6 space-y-6">
				{/* Original Scope Section */}
				<div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-5 border border-gray-200">
					<div className="flex items-center gap-2 mb-3">
						<span className="inline-flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
							1
						</span>
						<label className="text-sm font-bold text-gray-800">
							Original Project Scope
						</label>
						<span className="text-xs text-gray-400 ml-2">(from Proposal)</span>
					</div>
					<div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm min-h-[120px]">
						{form.scope_of_work || form.description ? (
							<HtmlContent html={form.scope_of_work || form.description} />
						) : (
							<div className="flex flex-col items-center justify-center py-6 text-gray-400">
								<DocumentIcon className="h-8 w-8 mb-2" />
								<p className="text-sm">No original scope defined yet</p>
								<p className="text-xs">
									Scope will be fetched from linked proposal
								</p>
							</div>
						)}
					</div>
					<p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
						<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
							<path
								fillRule="evenodd"
								d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
								clipRule="evenodd"
							></path>
						</svg>
						Original scope is linked to the proposal and can be edited in
						Project Details tab.
					</p>
				</div>

				{/* Additional Scope Section - Bullet Points */}
				<div className="bg-gradient-to-br from-amber-50/50 to-orange-50/30 rounded-xl p-5 border border-amber-200">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<span className="inline-flex items-center justify-center w-6 h-6 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
								2
							</span>
							<label className="text-sm font-bold text-gray-800">
								Additional Scope Items
							</label>
							<span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
								Change Orders / Variations
							</span>
						</div>
						{(() => {
							const items = (form.additional_scope || '')
								.split('\n')
								.filter((item) => item.trim());
							return (
								items.length > 0 && (
									<span className="text-xs text-green-600 flex items-center gap-1">
										<CheckCircleIcon className="w-4 h-4" />
										{items.length} item
										{items.length > 1 ? 's' : ''}
									</span>
								)
							);
						})()}
					</div>

					{/* Add New Item - Right below heading */}
					<div className="flex gap-2 mb-4">
						<div className="flex-1 relative">
							<span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500">
								•
							</span>
							<input
								type="text"
								id="additional-scope-input"
								placeholder="Type new scope item and press Enter or click Add..."
								className="w-full pl-7 pr-4 py-2.5 text-sm border border-amber-200 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487] bg-white placeholder:text-gray-400"
								onKeyDown={(e) => {
									if (e.key === 'Enter' && e.target.value.trim()) {
										e.preventDefault();
										const newItem = e.target.value.trim();
										const currentItems = (form.additional_scope || '')
											.split('\n')
											.filter((item) => item.trim());
										const updatedScope = [...currentItems, newItem].join('\n');
										setForm((prev) => ({
											...prev,
											additional_scope: updatedScope,
										}));
										e.target.value = '';
									}
								}}
							/>
						</div>
						<button
							type="button"
							onClick={() => {
								const input = document.getElementById('additional-scope-input');
								if (input && input.value.trim()) {
									const newItem = input.value.trim();
									const currentItems = (form.additional_scope || '')
										.split('\n')
										.filter((item) => item.trim());
									const updatedScope = [...currentItems, newItem].join('\n');
									setForm((prev) => ({
										...prev,
										additional_scope: updatedScope,
									}));
									input.value = '';
									input.focus();
								}
							}}
							className="px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium flex items-center gap-1"
						>
							<PlusIcon className="w-4 h-4" />
							Add
						</button>
					</div>

					{/* Existing Items List */}
					<div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
						{(() => {
							const items = (form.additional_scope || '')
								.split('\n')
								.filter((item) => item.trim());
							if (items.length === 0) {
								return (
									<div className="p-6 text-center text-gray-400">
										<DocumentIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
										<p className="text-sm">
											No additional scope items added yet
										</p>
										<p className="text-xs mt-1">
											Use the field above to add items
										</p>
									</div>
								);
							}
							return (
								<ul className="divide-y divide-amber-100">
									{items.map((item, idx) => (
										<li
											key={idx}
											className="flex items-start gap-3 px-4 py-3 hover:bg-amber-50/50 group"
										>
											<span className="flex-shrink-0 w-5 h-5 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
												{idx + 1}
											</span>
											<span className="flex-1 text-sm text-gray-700">
												{item.replace(/^[•\-\*]\s*/, '')}
											</span>
											<button
												type="button"
												onClick={() => {
													const newItems = items.filter((_, i) => i !== idx);
													setForm((prev) => ({
														...prev,
														additional_scope: newItems.join('\n'),
													}));
												}}
												className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
												title="Remove item"
											>
												<XMarkIcon className="w-4 h-4" />
											</button>
										</li>
									))}
								</ul>
							);
						})()}
					</div>

					<p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
						<svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
							<path
								fillRule="evenodd"
								d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
								clipRule="evenodd"
							></path>
						</svg>
						Press Enter or click Add to add scope items. Document changes,
						amendments, or additional work.
					</p>
				</div>

				{/* Combined Scope Preview */}
				{(form.scope_of_work || form.description || form.additional_scope) && (
					<div className="bg-gradient-to-br from-purple-50/50 to-blue-50/30 rounded-xl p-5 border border-purple-200">
						<div className="flex items-center gap-2 mb-3">
							<span className="inline-flex items-center justify-center w-6 h-6 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">
								📋
							</span>
							<label className="text-sm font-bold text-gray-800">
								Complete Scope Overview
							</label>
						</div>
						<div className="bg-white rounded-lg p-4 border border-purple-100 shadow-sm space-y-4">
							{(form.scope_of_work || form.description) && (
								<div>
									<p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">
										Original Scope
									</p>
									<HtmlContent html={form.scope_of_work || form.description} />
								</div>
							)}
							{form.additional_scope && (
								<div
									className={
										form.scope_of_work || form.description
											? 'pt-3 border-t border-gray-200'
											: ''
									}
								>
									<p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
										Additional Scope Items
									</p>
									<ul className="space-y-1.5">
										{form.additional_scope
											.split('\n')
											.filter((item) => item.trim())
											.map((item, idx) => (
												<li
													key={idx}
													className="flex items-start gap-2 text-sm text-gray-700"
												>
													<span className="text-amber-500 mt-0.5">•</span>
													<span>{item.replace(/^[•\-\*]\s*/, '')}</span>
												</li>
											))}
									</ul>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Quick Tips */}
				<div className="bg-blue-50/50 rounded-lg p-4 border border-blue-100">
					<p className="text-xs font-semibold text-blue-800 mb-2">
						💡 Scope Management Tips
					</p>
					<ul className="text-xs text-blue-700 space-y-1">
						<li>
							• Document all scope changes with dates and approval references
						</li>
						<li>
							• Link additional scope items to change orders or client emails
						</li>
						<li>• Track impact on timeline and budget in Commercial tab</li>
						<li>• Update Project Activities tab when scope changes</li>
					</ul>
				</div>
			</div>
		</section>
	);
}
