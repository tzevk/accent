'use client';

import { useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import { apiGet } from '@/lib/api-client';
import type { ApiListResponse } from '@/types/admin';

interface IssuedDocRow {
	id: number;
	document_name: string;
	document_number: string;
	discipline: string;
	category: string;
	description: string;
	revision_number: string;
	status: string;
	planned_date: string;
	actual_date: string;
	prepared_by: string;
	checked_by: string;
	approved_by: string;
	client_approval: string;
	remarks: string;
}

type SignatureField =
	| 'prepared_by'
	| 'checked_by'
	| 'approved_by'
	| 'client_approval';

type SignaturePermissions = Record<SignatureField, 'hidden' | 'view' | 'edit'>;

interface DocumentsIssuedTabProps {
	newIssuedDescRef: RefObject<HTMLInputElement | null>;
	newIssuedDoc: Omit<IssuedDocRow, 'id'>;
	setNewIssuedDoc: Dispatch<SetStateAction<Omit<IssuedDocRow, 'id'>>>;
	canEditProjectContent: boolean;
	addIssuedDocument: () => void;
	documentsIssued: IssuedDocRow[];
	updateIssuedDocument: (
		id: number,
		field: keyof IssuedDocRow,
		value: string
	) => void;
	removeIssuedDocument: (id: number) => void;
	sessionUserName: string;
	signaturePermissions: SignaturePermissions;
}

const STATUS_OPTIONS = ['IFI', 'IFR', 'IFD', 'IFC'];

interface SelectOption {
	value: string;
	label: string;
	id?: string | number;
}

const withKeepValue = (
	options: SelectOption[],
	current: string
): SelectOption[] =>
	current && !options.some((o) => o.value === current)
		? [{ value: current, label: current }, ...options]
		: options;

export default function DocumentsIssuedTab({
	newIssuedDescRef,
	newIssuedDoc,
	setNewIssuedDoc,
	canEditProjectContent,
	addIssuedDocument,
	documentsIssued,
	updateIssuedDocument,
	removeIssuedDocument,
	sessionUserName,
	signaturePermissions,
}: DocumentsIssuedTabProps) {
	const [editingId, setEditingId] = useState<number | null>(null);

	const canSign = (field: SignatureField) =>
		signaturePermissions[field] === 'edit';

	const { data: categoryOptionsData } = useQuery<ApiListResponse>({
		queryKey: ['deliverable-categories'],
		queryFn: () => apiGet('/api/masters/deliverable-categories'),
	});

	const categoryOptions: SelectOption[] = (
		(categoryOptionsData?.data ?? []) as Array<{
			id: number;
			category_name: string;
		}>
	).map((c) => ({
		value: c.category_name,
		label: c.category_name,
		id: c.id,
	}));

	const handleStatusChange = (d: IssuedDocRow, value: string) => {
		updateIssuedDocument(d.id, 'status', value);
		if (
			(value === 'IFI' || value === 'IFR') &&
			!d.checked_by &&
			canSign('checked_by')
		) {
			updateIssuedDocument(d.id, 'checked_by', sessionUserName);
		}
		if (
			(value === 'IFC' || value === 'IFD') &&
			!d.approved_by &&
			canSign('approved_by')
		) {
			updateIssuedDocument(d.id, 'approved_by', sessionUserName);
		}
	};

	const updateNewIssued = (
		field: keyof Omit<IssuedDocRow, 'id'>,
		value: string
	) => setNewIssuedDoc((prev) => ({ ...prev, [field]: value }));

	const addRowInputClass =
		'w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]';
	const rowInputClass =
		'w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]';

	const renderAddStatusSelect = () => (
		<select
			value={newIssuedDoc.status}
			onChange={(e) => updateNewIssued('status', e.target.value)}
			className={`${addRowInputClass} bg-white`}
			disabled={!canEditProjectContent}
		>
			<option value="">Select Status</option>
			{STATUS_OPTIONS.map((s) => (
				<option key={s} value={s}>
					{s}
				</option>
			))}
		</select>
	);

	const renderEditStatusSelect = (d: IssuedDocRow) => (
		<select
			value={d.status || ''}
			onChange={(e) => handleStatusChange(d, e.target.value)}
			className={`${rowInputClass} bg-white`}
			disabled={!canEditProjectContent}
		>
			<option value="">Select Status</option>
			{d.status && !STATUS_OPTIONS.includes(d.status) && (
				<option value={d.status}>{d.status}</option>
			)}
			{STATUS_OPTIONS.map((s) => (
				<option key={s} value={s}>
					{s}
				</option>
			))}
		</select>
	);

	const signatureDisabled = (field: SignatureField) =>
		!canEditProjectContent || !canSign(field);

	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
			<div className="px-6 py-3 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
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
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
					<h2 className="text-sm font-bold text-gray-900">
						List of Deliverables
					</h2>
				</div>
				<p className="text-xs text-gray-600 mt-0.5">
					Track deliverables issued to client
				</p>
			</div>

			<div className="px-4 py-4 sm:px-6 sm:py-5">
				<div className="mb-3 flex items-center gap-2 sm:hidden">
					<p className="text-xs text-gray-500">
						Swipe horizontally to view all deliverable fields.
					</p>
				</div>
				<div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-gray-200">
					<div className="w-max min-w-full">
						<table className="w-[1448px] min-w-full table-fixed border-collapse text-xs">
							<caption className="sr-only">
								Deliverables issued to client
							</caption>
							<colgroup>
								<col className="w-[42px]" />
								<col className="w-[88px]" />
								<col className="w-[92px]" />
								<col className="w-[82px]" />
								<col className="w-[120px]" />
								<col className="w-[140px]" />
								<col className="w-[60px]" />
								<col className="w-[80px]" />
								<col className="w-[100px]" />
								<col className="w-[100px]" />
								<col className="w-[90px]" />
								<col className="w-[90px]" />
								<col className="w-[90px]" />
								<col className="w-[90px]" />
								<col className="w-[120px]" />
								<col className="w-[64px]" />
							</colgroup>
							<thead className="bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
								<tr>
									<th className="text-center py-2 px-2 font-semibold text-gray-700">
										Sr No
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Document No
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Discipline
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Category
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Deliverable Name
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Description
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Revision
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Status
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Planned Date
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Actual Date
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Prepared By
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Checked By
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Approved By
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Client Approval
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Remarks
									</th>
									<th className="text-center py-2 px-2 font-semibold text-gray-700">
										Action
									</th>
								</tr>
							</thead>
							<tbody>
								<tr className="bg-purple-50/30 border-b-2 border-purple-100">
									<td className="py-2 px-2 text-center text-gray-400 font-semibold">
										+
									</td>
									<td className="py-2 px-2">
										<input
											ref={newIssuedDescRef}
											type="text"
											value={newIssuedDoc.document_number}
											onChange={(e) =>
												updateNewIssued('document_number', e.target.value)
											}
											placeholder="Document No"
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.discipline}
											onChange={(e) =>
												updateNewIssued('discipline', e.target.value)
											}
											placeholder="Discipline"
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<SearchableSelect
											options={categoryOptions}
											value={newIssuedDoc.category}
											onChange={(val) => updateNewIssued('category', val)}
											placeholder="Select Category"
											className="w-full"
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.document_name}
											onChange={(e) =>
												updateNewIssued('document_name', e.target.value)
											}
											placeholder="Deliverable Name"
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.description}
											onChange={(e) =>
												updateNewIssued('description', e.target.value)
											}
											placeholder="Description"
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.revision_number}
											onChange={(e) =>
												updateNewIssued('revision_number', e.target.value)
											}
											placeholder="Revision"
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">{renderAddStatusSelect()}</td>
									<td className="py-2 px-2">
										<input
											type="date"
											value={newIssuedDoc.planned_date}
											onChange={(e) =>
												updateNewIssued('planned_date', e.target.value)
											}
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="date"
											value={newIssuedDoc.actual_date}
											onChange={(e) =>
												updateNewIssued('actual_date', e.target.value)
											}
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.prepared_by}
											onChange={(e) =>
												updateNewIssued('prepared_by', e.target.value)
											}
											placeholder="Prepared By"
											className={addRowInputClass}
											disabled={signatureDisabled('prepared_by')}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.checked_by}
											onChange={(e) =>
												updateNewIssued('checked_by', e.target.value)
											}
											placeholder="Checked By"
											className={addRowInputClass}
											disabled={signatureDisabled('checked_by')}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.approved_by}
											onChange={(e) =>
												updateNewIssued('approved_by', e.target.value)
											}
											placeholder="Approved By"
											className={addRowInputClass}
											disabled={signatureDisabled('approved_by')}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.client_approval}
											onChange={(e) =>
												updateNewIssued('client_approval', e.target.value)
											}
											placeholder="Client Approval"
											className={addRowInputClass}
											disabled={signatureDisabled('client_approval')}
										/>
									</td>
									<td className="py-2 px-2">
										<input
											type="text"
											value={newIssuedDoc.remarks}
											onChange={(e) =>
												updateNewIssued('remarks', e.target.value)
											}
											placeholder="Remarks"
											className={addRowInputClass}
											disabled={!canEditProjectContent}
										/>
									</td>
									<td className="py-2 px-2 text-center">
										<button
											type="button"
											onClick={addIssuedDocument}
											disabled={
												!(
													newIssuedDoc.document_name &&
													newIssuedDoc.document_name.trim()
												)
											}
											className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newIssuedDoc.document_name && newIssuedDoc.document_name.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
											title="Add document"
										>
											Add
										</button>
									</td>
								</tr>
								{documentsIssued.map((d, index) => (
									<tr
										key={d.id}
										className="hover:bg-gray-50 transition-colors align-top"
									>
										<td className="py-2 px-2 text-center text-gray-900">
											{index + 1}
										</td>
										{editingId === d.id ? (
											<>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.document_number || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'document_number',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.discipline || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'discipline',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<SearchableSelect
														options={withKeepValue(categoryOptions, d.category)}
														value={d.category || ''}
														onChange={(val) =>
															updateIssuedDocument(d.id, 'category', val)
														}
														placeholder="Select Category"
														className="w-full"
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.document_name || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'document_name',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.description || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'description',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.revision_number || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'revision_number',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													{renderEditStatusSelect(d)}
												</td>
												<td className="py-2 px-2">
													<input
														type="date"
														value={d.planned_date || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'planned_date',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="date"
														value={d.actual_date || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'actual_date',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.prepared_by || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'prepared_by',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={signatureDisabled('prepared_by')}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.checked_by || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'checked_by',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={signatureDisabled('checked_by')}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.approved_by || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'approved_by',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={signatureDisabled('approved_by')}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.client_approval || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'client_approval',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={signatureDisabled('client_approval')}
													/>
												</td>
												<td className="py-2 px-2">
													<input
														type="text"
														value={d.remarks || ''}
														onChange={(e) =>
															updateIssuedDocument(
																d.id,
																'remarks',
																e.target.value
															)
														}
														className={rowInputClass}
														disabled={!canEditProjectContent}
													/>
												</td>
											</>
										) : (
											<>
												<td className="py-2 px-2 text-gray-900">
													{d.document_number || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.discipline || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.category || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.document_name || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.description || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.revision_number || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.status || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.planned_date || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.actual_date || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.prepared_by || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.checked_by || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.approved_by || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.client_approval || '—'}
												</td>
												<td className="py-2 px-2 text-gray-900">
													{d.remarks || '—'}
												</td>
											</>
										)}
										<td className="py-2 px-2 text-center">
											<div className="inline-flex items-center gap-1">
												{editingId === d.id ? (
													<button
														type="button"
														onClick={() => setEditingId(null)}
														className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
														title="Done editing"
														disabled={!canEditProjectContent}
													>
														<CheckIcon className="h-4 w-4" />
													</button>
												) : (
													<button
														type="button"
														onClick={() => setEditingId(d.id)}
														className="p-1 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
														title="Edit document"
														disabled={!canEditProjectContent}
													>
														<PencilIcon className="h-4 w-4" />
													</button>
												)}
												<button
													type="button"
													onClick={() => removeIssuedDocument(d.id)}
													className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
													title="Remove document"
													disabled={!canEditProjectContent}
												>
													<XMarkIcon className="h-4 w-4" />
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</section>
	);
}
