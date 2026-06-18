import {
	UserIcon,
	PlusIcon,
	ChevronDownIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';

export default function ProjectTeamTab({
	toggleSection,
	openSections,
	teamMemberSearch,
	setTeamMemberSearch,
	usersLoading,
	availableUsers,
	allUsers,
	addTeamMember,
	projectTeamMembers,
	updateTeamMemberRole,
	removeTeamMember,
}) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
			<div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
				<div className="flex items-center gap-2">
					<UserIcon className="h-4 w-4 text-[#7F2487]" />
					<h2 className="text-sm font-bold text-gray-900">Project Team</h2>
				</div>
				<p className="text-xs text-gray-500 mt-0.5">
					Select team members from user master for this project
				</p>
			</div>

			<div className="px-6 py-5 space-y-4">
				{/* Add Team Member Section - Collapsible */}
				<div className="border border-purple-100 rounded-lg overflow-hidden">
					<button
						type="button"
						onClick={() => toggleSection('teamMemberAdd')}
						className="w-full bg-gradient-to-br from-purple-25 via-white to-purple-25 px-4 py-3 flex items-center justify-between hover:bg-purple-50 transition-colors"
					>
						<div className="flex items-center gap-2">
							<PlusIcon className="h-4 w-4 text-[#7F2487]" />
							<h4 className="text-sm font-semibold text-gray-700">
								Add Team Member
							</h4>
						</div>
						<ChevronDownIcon
							className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${openSections.teamMemberAdd ? 'transform rotate-180' : ''}`}
						/>
					</button>

					{openSections.teamMemberAdd && (
						<div className="p-4 border-t border-purple-100">
							{/* Search Box */}
							<div className="mb-3">
								<input
									type="text"
									value={teamMemberSearch}
									onChange={(e) => setTeamMemberSearch(e.target.value)}
									placeholder="Search users by name, email, or department..."
									className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
								/>
							</div>

							{/* Available Users List */}
							{usersLoading ? (
								<div className="text-center py-8 text-gray-500">
									<div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
									<p className="text-sm">Loading users...</p>
								</div>
							) : availableUsers.length > 0 ? (
								<div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
									<table className="w-full text-xs">
										<thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
											<tr>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Employee ID
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Name
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Email
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Role
												</th>
												<th className="px-3 py-2 text-center font-semibold text-gray-700">
													Action
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-100">
											{availableUsers.map((user) => (
												<tr
													key={user.id}
													className="hover:bg-purple-50 transition-colors"
												>
													<td className="px-3 py-2 text-gray-900 font-mono text-xs">
														{user.employee_code || user.employee_id || user.id}
													</td>
													<td className="px-3 py-2 text-gray-900 font-medium">
														{user.full_name || user.username}
													</td>
													<td className="px-3 py-2 text-gray-600">
														{user.email || '-'}
													</td>
													<td className="px-3 py-2 text-gray-600">
														{user.role_name || '-'}
													</td>
													<td className="px-3 py-2 text-center">
														<button
															type="button"
															onClick={() => addTeamMember(user)}
															className="px-3 py-1 bg-[#7F2487] text-white rounded-md text-xs font-medium hover:bg-[#6a1e73] transition-colors"
														>
															Add
														</button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<div className="text-center py-6 text-gray-500">
									<UserIcon className="h-10 w-10 mx-auto text-gray-300 mb-2" />
									<p className="text-sm">
										{teamMemberSearch
											? 'No users found matching your search'
											: allUsers.length === 0
												? 'No users loaded. Please refresh the page.'
												: 'All users have been added to the team'}
									</p>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Current Team Members - Collapsible */}
				<div className="border border-gray-200 rounded-lg overflow-hidden">
					<button
						type="button"
						onClick={() => toggleSection('currentTeam')}
						className="w-full bg-gray-50 px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors"
					>
						<div className="flex items-center gap-2">
							<UserIcon className="h-4 w-4 text-[#7F2487]" />
							<h4 className="text-sm font-semibold text-gray-700">
								Current Team Members ({projectTeamMembers.length})
							</h4>
						</div>
						<ChevronDownIcon
							className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${openSections.currentTeam ? 'transform rotate-180' : ''}`}
						/>
					</button>

					{openSections.currentTeam && (
						<div>
							{projectTeamMembers.length > 0 ? (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead className="bg-gray-50 border-b border-gray-200">
											<tr>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													#
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Employee ID
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Name
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Email
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Department
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Position
												</th>
												<th className="px-3 py-2 text-left font-semibold text-gray-700">
													Project Role
												</th>
												<th className="px-3 py-2 text-center font-semibold text-gray-700">
													Actions
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-100">
											{projectTeamMembers.map((member, index) => (
												<tr
													key={member.id}
													className="hover:bg-gray-50 transition-colors"
												>
													<td className="px-3 py-2 text-gray-600">
														{index + 1}
													</td>
													<td className="px-3 py-2 text-gray-900 font-mono text-xs">
														{member.employee_id}
													</td>
													<td className="px-3 py-2 text-gray-900 font-medium">
														{member.name}
													</td>
													<td className="px-3 py-2 text-gray-600 text-xs">
														{member.email}
													</td>
													<td className="px-3 py-2 text-gray-600">
														{member.department || '-'}
													</td>
													<td className="px-3 py-2 text-gray-600">
														{member.position || '-'}
													</td>
													<td className="px-3 py-2">
														<select
															value={member.role}
															onChange={(e) =>
																updateTeamMemberRole(member.id, e.target.value)
															}
															className="w-full px-2 py-1 border border-gray-300 rounded text-xs bg-white hover:border-blue-400 focus:border-blue-500 focus:outline-none cursor-pointer"
														>
															<option value="Team Member">Team Member</option>
															<option value="Project Lead">Project Lead</option>
															<option value="Designer">Designer</option>
															<option value="Engineer">Engineer</option>
															<option value="Drafter">Drafter</option>
															<option value="Coordinator">Coordinator</option>
															<option value="QA/QC">QA/QC</option>
															<option value="Site Supervisor">
																Site Supervisor
															</option>
														</select>
													</td>
													<td className="px-3 py-2 text-center">
														<button
															type="button"
															onClick={() => removeTeamMember(member.id)}
															className="text-red-500 hover:text-red-700 p-1"
															title="Remove from team"
														>
															<TrashIcon className="h-4 w-4" />
														</button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<div className="text-center py-12 text-gray-500">
									<UserIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
									<p className="text-sm font-medium">
										No team members added yet
									</p>
									<p className="text-xs mt-1">
										Add team members from the user list above
									</p>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Team Summary */}
				{projectTeamMembers.length > 0 && (
					<div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-100">
						<div className="flex items-center justify-between">
							<div>
								<h4 className="text-sm font-semibold text-gray-700">
									Team Summary
								</h4>
								<p className="text-xs text-gray-600 mt-0.5">
									Total members assigned to this project
								</p>
							</div>
							<div className="text-right">
								<div className="text-2xl font-bold text-[#7F2487]">
									{projectTeamMembers.length}
								</div>
								<div className="text-xs text-gray-600">Team Members</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
