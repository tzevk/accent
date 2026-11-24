import { DocumentIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export default function TeamTab({
	addActivityTeamMember,
	totalManhours = 0,
	totalCost = 0,
	teamMembers = [],
	updateActivityTeamMember,
	getProjectTeamForDropdown,
	functions = [],
	projectActivities = [],
	removeActivityTeamMember,
}) {
	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
			<div className="flex items-center justify-between border-b border-border bg-muted/60 px-6 py-4">
				<div className="flex items-center gap-3">
					<div className="rounded-xl border border-border bg-accent p-2">
						<DocumentIcon className="h-4 w-4 text-primary" />
					</div>
					<div>
						<h2 className="text-base font-bold tracking-tight text-foreground">
							Project Team
						</h2>
						<p className="text-xs font-medium text-muted-foreground">
							Assign employees to activities with hours and costs
						</p>
					</div>
				</div>
				<button
					type="button"
					onClick={addActivityTeamMember}
					className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold tracking-[0.01em] text-primary-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
				>
					<PlusIcon className="h-4 w-4" />
					Add Team Member
				</button>
			</div>
			<div className="px-6 py-6">
				{/* Enhanced Summary Cards */}
				<div className="mb-6 grid grid-cols-2 gap-4">
					<div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
						<p className="mb-1 text-xs font-bold text-muted-foreground">
							Total Manhours
						</p>
						<p className="text-xl font-bold text-blue-600">
							{totalManhours.toFixed(2)}
						</p>
					</div>
					<div className="rounded-xl border border-green-200 bg-green-50/60 p-4">
						<p className="mb-1 text-xs font-bold text-muted-foreground">
							Total Cost
						</p>
						<p className="text-xl font-bold text-green-600">
							{new Intl.NumberFormat('en-IN', {
								style: 'currency',
								currency: 'INR',
							}).format(totalCost)}
						</p>
					</div>
				</div>

				{teamMembers.length === 0 ? (
					<div className="px-4 py-16 text-center">
						<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full border border-border bg-accent">
							<DocumentIcon className="size-8 text-primary" />
						</div>
						<p className="mb-2 text-sm font-semibold text-foreground">
							No Team Members Yet
						</p>
						<p className="text-xs text-muted-foreground">
							Click &quot;Add Team Member&quot; to start building your project
							team
						</p>
					</div>
				) : (
					<div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
						<table className="w-full border-collapse text-xs">
							<thead>
								<tr className="border-b border-border bg-muted/60">
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Name
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Discipline
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Activity
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Sub-Activity
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Required Hours
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Actual Hours
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Start Date
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										End Date
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Actual Date
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Manhours
									</th>
									<th className="px-4 py-3 text-left font-bold tracking-[0.01em] text-foreground">
										Cost
									</th>
									<th className="px-4 py-3 text-center font-bold tracking-[0.01em] text-foreground">
										Actions
									</th>
								</tr>
							</thead>
							<tbody>
								{teamMembers.map((member) => (
									<tr
										key={member.id}
										className="border-b border-border transition-colors duration-200 hover:bg-muted/50"
									>
										<td className="py-3 px-4">
											<select
												value={member.employee_id}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'employee_id',
														e.target.value
													)
												}
												className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-medium text-foreground transition-all duration-300 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
											>
												<option value="">Select Team Member</option>
												{getProjectTeamForDropdown().map((emp) => (
													<option key={emp.id} value={emp.id}>
														{emp.name}{' '}
														{emp.project_role && `(${emp.project_role})`}
													</option>
												))}
											</select>
										</td>
										<td className="py-2 px-3">
											<select
												value={member.discipline || ''}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'discipline',
														e.target.value
													)
												}
												className="w-full px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											>
												<option value="">Select Discipline</option>
												{functions.map((f) => (
													<option key={f.id} value={f.id}>
														{f.function_name}
													</option>
												))}
											</select>
										</td>
										<td className="py-2 px-3">
											<select
												value={member.activity_id}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'activity_id',
														e.target.value
													)
												}
												className="w-full px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											>
												<option value="">Select Activity</option>
												{projectActivities
													.filter(
														(pa) =>
															pa.type === 'activity' &&
															(!member.discipline ||
																String(pa.function_id) ===
																	String(member.discipline))
													)
													.map((pa) => (
														<option key={`${pa.id}-${pa.type}`} value={pa.id}>
															{pa.name}
														</option>
													))}
											</select>
										</td>
										<td className="py-2 px-3">
											<select
												value={member.sub_activity || ''}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'sub_activity',
														e.target.value
													)
												}
												className="w-full px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											>
												<option value="">Select Sub-Activity</option>
												{projectActivities
													.filter(
														(pa) =>
															pa.type === 'subactivity' &&
															String(pa.activity_id) ===
																String(member.activity_id)
													)
													.map((pa) => (
														<option key={`${pa.id}-${pa.type}`} value={pa.id}>
															{pa.name}
														</option>
													))}
											</select>
										</td>
										<td className="py-2 px-3">
											<input
												type="number"
												value={member.required_hours}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'required_hours',
														e.target.value
													)
												}
												min="0"
												step="0.1"
												className="w-20 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-2 px-3">
											<input
												type="number"
												value={member.actual_hours}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'actual_hours',
														e.target.value
													)
												}
												min="0"
												step="0.1"
												className="w-20 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-2 px-3">
											<input
												type="date"
												value={member.planned_start_date || ''}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'planned_start_date',
														e.target.value
													)
												}
												className="w-32 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-2 px-3">
											<input
												type="date"
												value={member.planned_end_date}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'planned_end_date',
														e.target.value
													)
												}
												className="w-32 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-2 px-3">
											<input
												type="date"
												value={member.actual_completion_date}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'actual_completion_date',
														e.target.value
													)
												}
												className="w-32 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-2 px-3">
											<input
												type="number"
												value={member.manhours}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'manhours',
														e.target.value
													)
												}
												className="w-20 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-2 px-3">
											<input
												type="number"
												value={member.cost}
												onChange={(e) =>
													updateActivityTeamMember(
														member.id,
														'cost',
														e.target.value
													)
												}
												min="0"
												step="0.01"
												className="w-24 px-2 py-1 text-xs border border-input bg-background text-foreground rounded focus:ring-1 focus:ring-ring"
											/>
										</td>
										<td className="py-3 px-4 text-center">
											<button
												type="button"
												onClick={() => removeActivityTeamMember(member.id)}
												className="inline-flex items-center gap-1 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive transition-all duration-300 hover:scale-105 hover:bg-destructive/15 hover:shadow-sm"
											>
												<TrashIcon className="h-3.5 w-3.5" />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</section>
	);
}
