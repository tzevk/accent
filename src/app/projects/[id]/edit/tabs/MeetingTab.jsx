import {
	PlusIcon,
	XMarkIcon,
	PaperClipIcon,
	ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';

export default function MeetingTab({
	newKickoffMeetingTitle,
	setNewKickoffMeetingTitle,
	addKickoffMeeting,
	kickoffMeetings,
	updateKickoffMeeting,
	handlePointsBlur,
	removeMomDocument,
	handleMomUpload,
	removeKickoffMeeting,
	newInternalMeetingTitle,
	setNewInternalMeetingTitle,
	addInternalMeeting,
	internalMeetings,
	updateInternalMeeting,
	removeInternalMeeting,
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
							d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
						/>
					</svg>
					<h2 className="text-sm font-bold text-gray-900">Project Meetings</h2>
				</div>
				<p className="text-xs text-gray-500 mt-0.5">
					Kickoff meeting and Internal project meetings
				</p>
			</div>

			<div className="px-6 py-5 space-y-4">
				{/* Kickoff Meetings Table */}
				<div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
					<div className="flex items-center justify-between mb-3">
						<h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
							<PlusIcon className="h-4 w-4 text-[#7F2487]" />
							Project Kickoff Meetings
						</h4>
						<div className="flex items-center gap-2">
							<input
								type="text"
								placeholder="Meeting title"
								value={newKickoffMeetingTitle}
								onChange={(e) => setNewKickoffMeetingTitle(e.target.value)}
								className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
							/>
							<button
								type="button"
								onClick={addKickoffMeeting}
								className="px-3 py-1.5 bg-[#7F2487] text-white text-sm font-semibold rounded hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
							>
								<PlusIcon className="h-3.5 w-3.5" />
								Add
							</button>
						</div>
					</div>

					<div className="overflow-x-auto">
						<table className="w-full text-xs border-collapse">
							<thead>
								<tr className="bg-gray-50 border-b border-gray-200">
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										No
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Date
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Title
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Organizer
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Client Rep
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Location
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Points
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Participants
									</th>
									<th className="text-center py-2 px-2 font-semibold text-gray-700">
										MOM
									</th>
									<th className="text-center py-2 px-2 font-semibold text-gray-700">
										Action
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{kickoffMeetings.length === 0 ? (
									<tr>
										<td
											colSpan={10}
											className="text-center py-4 text-gray-500 text-sm"
										>
											No kickoff meetings added
										</td>
									</tr>
								) : (
									kickoffMeetings.map((m, index) => (
										<tr
											key={m.id}
											className="hover:bg-gray-50 transition-colors align-top"
										>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.meeting_no || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'meeting_no',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="date"
													value={m.meeting_date || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'meeting_date',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.meeting_title || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'meeting_title',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.organizer || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'organizer',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.client_representative || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'client_representative',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.meeting_location || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'meeting_location',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<textarea
													value={m.points_discussed || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'points_discussed',
															e.target.value
														)
													}
													onBlur={(e) =>
														handlePointsBlur(
															m.id,
															e.target.value,
															updateKickoffMeeting
														)
													}
													rows={3}
													placeholder="Enter points (press Enter for new bullet)&#10;Project timeline&#10;Budget discussion&#10;Next steps"
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded resize-y min-h-[60px] font-mono focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<textarea
													value={m.persons_involved || ''}
													onChange={(e) =>
														updateKickoffMeeting(
															m.id,
															'persons_involved',
															e.target.value
														)
													}
													onBlur={(e) =>
														handlePointsBlur(
															m.id,
															e.target.value,
															updateKickoffMeeting,
															'persons_involved'
														)
													}
													rows={3}
													placeholder="Enter participants (press Enter for new bullet)&#10;John Doe&#10;Jane Smith&#10;Bob Johnson"
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded resize-y min-h-[60px] font-mono focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2 text-center">
												{m.mom_document ? (
													<div className="flex flex-col items-center gap-1">
														<a
															href={m.mom_document.file_url}
															target="_blank"
															rel="noopener noreferrer"
															className="text-[#7F2487] hover:text-[#6a1e73] flex items-center gap-1 text-xs font-medium"
															title={m.mom_document.original_name}
														>
															<PaperClipIcon className="h-3.5 w-3.5" />
															<span className="max-w-[80px] truncate">
																{m.mom_document.original_name}
															</span>
														</a>
														<button
															type="button"
															onClick={() => removeMomDocument(m.id, 'kickoff')}
															className="text-red-400 hover:text-red-600 text-[10px]"
															title="Remove MOM"
														>
															Remove
														</button>
													</div>
												) : (
													<label className="cursor-pointer inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#7F2487] border border-purple-200 rounded hover:bg-purple-50 transition-colors">
														<ArrowUpTrayIcon className="h-3.5 w-3.5" />
														Upload
														<input
															type="file"
															className="hidden"
															accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt"
															onChange={(e) =>
																handleMomUpload(e, m.id, 'kickoff')
															}
														/>
													</label>
												)}
											</td>
											<td className="py-2 px-2 text-center">
												<button
													type="button"
													onClick={() => removeKickoffMeeting(m.id)}
													className="text-red-500 hover:text-red-700 p-1"
													title="Remove meeting"
												>
													<XMarkIcon className="h-4 w-4" />
												</button>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>

				{/* Internal Meetings Section */}
				<div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
					<div className="flex items-center justify-between mb-3">
						<h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
							<PlusIcon className="h-4 w-4 text-[#7F2487]" />
							Internal Project Meetings
						</h4>
						<div className="flex items-center gap-2">
							<input
								type="text"
								placeholder="Meeting title"
								value={newInternalMeetingTitle}
								onChange={(e) => setNewInternalMeetingTitle(e.target.value)}
								className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
							/>
							<button
								type="button"
								onClick={addInternalMeeting}
								className="px-3 py-1.5 bg-[#7F2487] text-white text-sm font-semibold rounded hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
							>
								<PlusIcon className="h-3.5 w-3.5" />
								Add
							</button>
						</div>
					</div>

					<div className="overflow-x-auto">
						<table className="w-full text-xs border-collapse">
							<thead>
								<tr className="bg-gray-50 border-b border-gray-200">
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										No
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Date
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Title
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Organizer
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Client Rep
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Location
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Points
									</th>
									<th className="text-left py-2 px-2 font-semibold text-gray-700">
										Participants
									</th>
									<th className="text-center py-2 px-2 font-semibold text-gray-700">
										MOM
									</th>
									<th className="text-center py-2 px-2 font-semibold text-gray-700">
										Action
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{internalMeetings.length === 0 ? (
									<tr>
										<td
											colSpan={10}
											className="text-center py-4 text-gray-500 text-sm"
										>
											No internal meetings added
										</td>
									</tr>
								) : (
									internalMeetings.map((m) => (
										<tr
											key={m.id}
											className="hover:bg-gray-50 transition-colors align-top"
										>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.meeting_no || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'meeting_no',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="date"
													value={m.meeting_date || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'meeting_date',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.meeting_title || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'meeting_title',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.organizer || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'organizer',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.client_representative || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'client_representative',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<input
													type="text"
													value={m.meeting_location || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'meeting_location',
															e.target.value
														)
													}
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
												/>
											</td>
											<td className="py-2 px-2">
												<textarea
													value={m.points_discussed || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'points_discussed',
															e.target.value
														)
													}
													onBlur={(e) =>
														handlePointsBlur(
															m.id,
															e.target.value,
															updateInternalMeeting
														)
													}
													rows={3}
													placeholder="Enter points (press Enter for new bullet)&#10;Project timeline&#10;Budget discussion&#10;Next steps"
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] resize-y min-h-[60px] font-mono"
												/>
											</td>
											<td className="py-2 px-2">
												<textarea
													value={m.persons_involved || ''}
													onChange={(e) =>
														updateInternalMeeting(
															m.id,
															'persons_involved',
															e.target.value
														)
													}
													onBlur={(e) =>
														handlePointsBlur(
															m.id,
															e.target.value,
															updateInternalMeeting,
															'persons_involved'
														)
													}
													rows={3}
													placeholder="Enter participants (press Enter for new bullet)&#10;John Doe&#10;Jane Smith&#10;Bob Johnson"
													className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] resize-y min-h-[60px] font-mono"
												/>
											</td>
											<td className="py-2 px-2 text-center">
												{m.mom_document ? (
													<div className="flex flex-col items-center gap-1">
														<a
															href={m.mom_document.file_url}
															target="_blank"
															rel="noopener noreferrer"
															className="text-[#7F2487] hover:text-[#6a1e73] flex items-center gap-1 text-xs font-medium"
															title={m.mom_document.original_name}
														>
															<PaperClipIcon className="h-3.5 w-3.5" />
															<span className="max-w-[80px] truncate">
																{m.mom_document.original_name}
															</span>
														</a>
														<button
															type="button"
															onClick={() =>
																removeMomDocument(m.id, 'internal')
															}
															className="text-red-400 hover:text-red-600 text-[10px]"
															title="Remove MOM"
														>
															Remove
														</button>
													</div>
												) : (
													<label className="cursor-pointer inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#7F2487] border border-purple-200 rounded hover:bg-purple-50 transition-colors">
														<ArrowUpTrayIcon className="h-3.5 w-3.5" />
														Upload
														<input
															type="file"
															className="hidden"
															accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt"
															onChange={(e) =>
																handleMomUpload(e, m.id, 'internal')
															}
														/>
													</label>
												)}
											</td>
											<td className="py-2 px-2 text-center">
												<button
													type="button"
													onClick={() => removeInternalMeeting(m.id)}
													className="text-red-500 hover:text-red-700 p-1"
													title="Remove meeting"
												>
													<XMarkIcon className="h-4 w-4" />
												</button>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</section>
	);
}
