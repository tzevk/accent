import { Fragment } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

export default function ActivitiesTab({
	projectActivities = [],
	functions = [],
	openSubActivityDropdowns = {},
	setOpenSubActivityDropdowns,
	subActivitySearch = {},
	setSubActivitySearch,
	toggleProjectActivity,
	setProjectActivities,
}) {
	return (
		<section className="bg-white border border-gray-200 rounded-lg shadow-sm">
			<div className="px-6 py-4 border-b border-gray-200">
				<h2 className="text-sm font-semibold text-black">
					Project Activities from Master
				</h2>
				<p className="text-xs text-gray-500">
					Select activities and choose sub-activities using the dropdown text
					box
				</p>
			</div>
			<div className="px-6 py-5">
				<div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
					<p className="text-xs font-semibold text-blue-900">
						Selected Activities: {projectActivities.length}
					</p>
				</div>

				{/* Table View with Dropdown Sub-activities */}
				<div className="overflow-x-auto">
					{functions.length === 0 ? (
						<div className="text-center py-8 text-gray-500">
							<p className="text-sm">
								No disciplines/functions found in Activity Master.
							</p>
							<p className="text-xs mt-2">
								Please add functions and activities in the Activity Master.
							</p>
						</div>
					) : (
						<table className="w-full text-xs border-collapse">
							<thead>
								<tr className="bg-gray-100 border-b-2 border-gray-300">
									<th
										className="text-left py-3 px-4 font-semibold"
										style={{ width: '20%' }}
									>
										Discipline
									</th>
									<th
										className="text-left py-3 px-4 font-semibold"
										style={{ width: '25%' }}
									>
										Activity
									</th>
									<th
										className="text-left py-3 px-4 font-semibold"
										style={{ width: '30%' }}
									>
										Description
									</th>
									<th
										className="text-left py-3 px-4 font-semibold"
										style={{ width: '25%' }}
									>
										Sub-Activity
									</th>
								</tr>
							</thead>
							<tbody>
								{functions.map((func) => {
									const funcActivities = func.activities || [];

									if (funcActivities.length === 0) {
										return (
											<tr key={func.id} className="border-b border-gray-200">
												<td className="py-3 px-4">
													<span className="font-semibold text-[#7F2487]">
														{func.function_name}
													</span>
												</td>
												<td
													className="py-3 px-4 text-gray-400 italic"
													colSpan="3"
												>
													No activities defined
												</td>
											</tr>
										);
									}

									return funcActivities.map((activity, actIdx) => {
										const activityKey = `${func.id}-${activity.id}`;
										const activitySubActivities = activity.subActivities || [];
										const hasSubActivities = activitySubActivities.length > 0;
										const isActivitySelected = projectActivities.some(
											(pa) => pa.id === activity.id && pa.type === 'activity'
										);
										const open = !!openSubActivityDropdowns[activityKey];
										const query = subActivitySearch[activityKey] || '';
										const filteredSubActivities = query
											? activitySubActivities.filter((sa) =>
													sa.name.toLowerCase().includes(query.toLowerCase())
												)
											: activitySubActivities;
										const selectedSubActivities = projectActivities.filter(
											(pa) =>
												pa.type === 'subactivity' &&
												pa.activity_id === activity.id
										);

										return (
											<Fragment key={activityKey}>
												{/* Main Activity Row */}
												<tr className="border-b border-gray-200 hover:bg-gray-50">
													<td className="py-3 px-4">
														{actIdx === 0 && (
															<span className="font-semibold text-[#7F2487]">
																{func.function_name}
															</span>
														)}
													</td>
													<td className="py-3 px-4">
														<div className="flex items-center space-x-2">
															{/* Activity Checkbox */}
															<label className="flex items-center space-x-2 cursor-pointer flex-1">
																<input
																	type="checkbox"
																	checked={isActivitySelected}
																	onChange={() =>
																		toggleProjectActivity(
																			activity.id,
																			'activity'
																		)
																	}
																	className="w-4 h-4 text-[#7F2487] rounded focus:ring-[#7F2487]"
																/>
																<span className="text-sm text-black font-medium">
																	{activity.activity_name}
																</span>
															</label>
														</div>
													</td>
													<td className="py-3 px-4">
														{isActivitySelected ? (
															<input
																type="text"
																value={
																	projectActivities.find(
																		(pa) =>
																			pa.id === activity.id &&
																			pa.type === 'activity'
																	)?.description || ''
																}
																onChange={(e) => {
																	setProjectActivities((prev) =>
																		prev.map((pa) =>
																			pa.id === activity.id &&
																			pa.type === 'activity'
																				? {
																						...pa,
																						description: e.target.value,
																					}
																				: pa
																		)
																	);
																}}
																placeholder="Enter description..."
																className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
															/>
														) : (
															<span className="text-gray-400 text-xs">—</span>
														)}
													</td>
													<td className="py-3 px-4">
														{hasSubActivities ? (
															<div className="relative">
																{/* Trigger input-like button */}
																<button
																	type="button"
																	onClick={() =>
																		setOpenSubActivityDropdowns((prev) => ({
																			...prev,
																			[activityKey]: !prev[activityKey],
																		}))
																	}
																	className="w-full text-left px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:ring-2 focus:ring-[#7F2487]"
																>
																	{selectedSubActivities.length > 0
																		? `${selectedSubActivities.length} selected`
																		: 'Select sub-activities'}
																</button>

																{/* Dropdown Panel */}
																{open && (
																	<div className="absolute z-10 mt-1 w-72 max-w-[80vw] bg-white border border-gray-200 rounded-md shadow-lg p-2">
																		<div className="flex items-center gap-2 mb-2">
																			<input
																				type="text"
																				value={query}
																				onChange={(e) =>
																					setSubActivitySearch((prev) => ({
																						...prev,
																						[activityKey]: e.target.value,
																					}))
																				}
																				placeholder="Search…"
																				className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
																			/>
																			<button
																				type="button"
																				onClick={() =>
																					setOpenSubActivityDropdowns(
																						(prev) => ({
																							...prev,
																							[activityKey]: false,
																						})
																					)
																				}
																				className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
																			>
																				Done
																			</button>
																		</div>
																		<div className="max-h-48 overflow-auto pr-1">
																			{filteredSubActivities.length === 0 ? (
																				<div className="text-xs text-gray-500 p-2">
																					No matching sub-activities
																				</div>
																			) : (
																				filteredSubActivities.map(
																					(subActivity) => {
																						const isSubActivitySelected =
																							projectActivities.some(
																								(pa) =>
																									pa.id === subActivity.id &&
																									pa.type === 'subactivity'
																							);
																						return (
																							<label
																								key={subActivity.id}
																								className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
																							>
																								<input
																									type="checkbox"
																									checked={
																										isSubActivitySelected
																									}
																									onChange={() =>
																										toggleProjectActivity(
																											subActivity.id,
																											'subactivity'
																										)
																									}
																									className="w-3.5 h-3.5 text-[#7F2487] rounded focus:ring-[#7F2487]"
																								/>
																								<span className="text-xs text-gray-700">
																									{subActivity.name}
																								</span>
																							</label>
																						);
																					}
																				)
																			)}
																		</div>
																		{selectedSubActivities.length > 0 && (
																			<div className="mt-2 flex items-center justify-between gap-2">
																				<div className="flex flex-wrap gap-1">
																					{selectedSubActivities
																						.slice(0, 3)
																						.map((sa) => (
																							<span
																								key={sa.id}
																								className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded"
																							>
																								{sa.name}
																							</span>
																						))}
																					{selectedSubActivities.length > 3 && (
																						<span className="text-[10px] text-gray-500">
																							+
																							{selectedSubActivities.length - 3}{' '}
																							more
																						</span>
																					)}
																				</div>
																				<button
																					type="button"
																					onClick={() =>
																						setProjectActivities(
																							projectActivities.filter(
																								(pa) =>
																									!(
																										pa.type === 'subactivity' &&
																										pa.activity_id ===
																											activity.id
																									)
																							)
																						)
																					}
																					className="text-[10px] text-red-700 hover:underline"
																				>
																					Clear
																				</button>
																			</div>
																		)}
																	</div>
																)}
															</div>
														) : (
															<span className="text-gray-400">—</span>
														)}
													</td>
												</tr>
											</Fragment>
										);
									});
								})}
							</tbody>
						</table>
					)}
				</div>

				{/* Selected Activities Summary */}
				{projectActivities.length > 0 && (
					<div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-md">
						<h4 className="text-sm font-semibold text-green-900 mb-2">
							Selected for this Project:
						</h4>
						<div className="grid grid-cols-2 md:grid-cols-3 gap-2">
							{projectActivities.map((pa, idx) => (
								<div
									key={idx}
									className="text-xs text-green-800 flex items-center"
								>
									<CheckCircleIcon className="h-4 w-4 mr-2 flex-shrink-0" />
									<span className="truncate">{pa.name}</span>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
