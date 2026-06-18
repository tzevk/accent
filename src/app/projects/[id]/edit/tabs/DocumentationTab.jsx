import { DocumentIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function DocumentationTab({
	newInputDocument,
	setNewInputDocument,
	handleInputDocumentKeyPress,
	addInputDocument,
	handleInputDocumentFileUpload,
	inputDocumentsList = [],
	removeInputDocument,
}) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm">
			<div className="px-6 py-4 border-b border-gray-200">
				<h2 className="text-sm font-semibold text-black">
					Input Documentation
				</h2>
				<p className="text-xs text-gray-600 mt-1">
					Manage all project-related documents and specifications
				</p>
			</div>
			<div className="px-6 py-5 space-y-4">
				<div>
					<label className="block text-xs font-medium text-black mb-1">
						Input Documents
					</label>

					{/* Add new document input */}
					<div className="flex gap-2 mb-3">
						<input
							type="text"
							value={newInputDocument}
							onChange={(e) => setNewInputDocument(e.target.value)}
							onKeyPress={handleInputDocumentKeyPress}
							placeholder="Enter document name (e.g., Technical Specification Rev 3.0)..."
							className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
						/>
						<button
							type="button"
							onClick={addInputDocument}
							className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
						>
							<PlusIcon className="h-4 w-4" />
							Add
						</button>
						<label className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-500 cursor-pointer transition-colors flex items-center gap-1">
							<PlusIcon className="h-4 w-4" />
							Upload
							<input
								type="file"
								accept="image/*,.svg"
								multiple
								onChange={handleInputDocumentFileUpload}
								className="hidden"
							/>
						</label>
					</div>

					{/* List of added documents */}
					{inputDocumentsList.length > 0 && (
						<div className="space-y-2 mb-3">
							{inputDocumentsList.map((doc) => (
								<div
									key={doc.id}
									className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg group hover:bg-blue-100 transition-colors"
								>
									<div className="flex items-center gap-3">
										<DocumentIcon className="h-4 w-4 text-blue-600 flex-shrink-0" />
										{doc.fileUrl ? (
											<a
												href={doc.fileUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="text-sm text-blue-700 hover:underline"
												title="Open document"
											>
												{doc.name || doc.text}
											</a>
										) : (
											<span className="text-sm text-gray-900">
												{doc.name || doc.text}
											</span>
										)}
										{doc.thumbUrl && (
											<div
												className="h-8 w-8 rounded border border-blue-200 bg-blue-50 flex items-center justify-center"
												style={{
													backgroundImage: `url(${doc.thumbUrl})`,
													backgroundSize: 'cover',
													backgroundPosition: 'center',
												}}
												title={doc.name || 'Document thumbnail'}
											>
												{!doc.thumbUrl && (
													<DocumentIcon className="h-4 w-4 text-blue-600" />
												)}
											</div>
										)}
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[10px] text-gray-500 hidden md:inline">
											{new Date(doc.addedAt).toLocaleDateString()}
										</span>
										<button
											type="button"
											onClick={() => removeInputDocument(doc.id)}
											className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
											title="Remove document"
										>
											<XMarkIcon className="h-4 w-4" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}

					{!inputDocumentsList.length && (
						<div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
							<DocumentIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
							<p>No documents added yet</p>
							<p className="text-xs mt-1">
								Use the input above to add documents to the list
							</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
