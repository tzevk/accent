'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { formatNumber } from '@/lib/format.js';

/** Names wider than the axis label gutter are cut to this, with an ellipsis. */
const MAX_NAME_LENGTH = 22;

/**
 * The YAxis tick: the project name links to the project itself. Recharts hands
 * a custom tick `payload.index` — the datum's own index in the categorical
 * domain — so the link reads the row by index rather than by name, because two
 * projects can share a name.
 */
function ProjectNameTick({ x, y, payload, projects }) {
	const project = projects[payload.index];
	if (!project) return null;

	const fullName = project.name || 'Untitled project';
	const label =
		fullName.length > MAX_NAME_LENGTH
			? `${fullName.slice(0, MAX_NAME_LENGTH - 1)}…`
			: fullName;

	return (
		<Link
			href={project.href}
			aria-label={fullName}
			className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
		>
			<text
				x={x}
				y={y}
				dy={4}
				textAnchor="end"
				className="fill-gray-700"
				fontSize={12}
			>
				{label}
			</text>
		</Link>
	);
}

/**
 * Top ten projects by Logged Hours: a horizontal bar chart whose category
 * labels are links to each project. Presentation only — the rows arrive as
 * props, so this never fetches.
 */
export default function ProjectsChart({ projects = [], loading = false }) {
	const data = useMemo(
		() =>
			projects.map((project) => ({
				name: project.name,
				logged: project.logged,
				href: `/projects/${project.id}`,
			})),
		[projects]
	);

	if (loading) {
		return (
			<div
				data-testid="projects-chart-loading"
				className="rounded-xl border border-purple-200 bg-white p-6"
			>
				<div className="mb-4 space-y-2">
					<div
						data-motion
						className="h-5 w-48 animate-pulse rounded bg-gray-100"
					/>
					<div
						data-motion
						className="h-4 w-64 animate-pulse rounded bg-gray-100"
					/>
				</div>
				<div
					data-motion
					className="h-80 animate-pulse rounded-lg bg-gray-100"
				/>
			</div>
		);
	}

	return (
		<div
			data-testid="projects-chart"
			className="rounded-xl border border-purple-200 bg-white p-6"
		>
			<div className="mb-4">
				<h3 className="text-lg font-semibold text-gray-900">
					Top Projects by Logged Hours
				</h3>
				<p className="mt-1 text-sm text-gray-500">
					The ten projects with the most hours logged.
				</p>
			</div>

			<div className="h-80 overflow-hidden">
				{data.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center text-center">
						<p className="font-medium text-gray-700">
							No project hours in this window
						</p>
						<p className="mt-1 text-sm text-gray-500">
							Bars appear once timesheets are approved against projects.
						</p>
					</div>
				) : (
					<ResponsiveContainer width="100%" height="100%">
						<BarChart
							data={data}
							layout="vertical"
							margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
						>
							<CartesianGrid strokeDasharray="3 3" horizontal={false} />
							<XAxis
								type="number"
								dataKey="logged"
								tick={{ fontSize: 12 }}
								tickFormatter={(value) => formatNumber(Number(value))}
							/>
							<YAxis
								type="category"
								dataKey="name"
								width={168}
								interval={0}
								tick={<ProjectNameTick projects={data} />}
							/>
							<Tooltip
								formatter={(value) => [
									`${formatNumber(Number(value))} h`,
									'Logged Hours',
								]}
							/>
							<Bar
								dataKey="logged"
								name="Logged Hours"
								fill="var(--chart-logged)"
								radius={[0, 4, 4, 0]}
								maxBarSize={28}
								isAnimationActive={false}
							/>
						</BarChart>
					</ResponsiveContainer>
				)}
			</div>
		</div>
	);
}
