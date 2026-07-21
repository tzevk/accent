import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export async function PUT(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { id } = await params;
		const body = await request.json();
		const rawProjectKey =
			body.projectId !== undefined ? body.projectId : body.project_id;
		const projectKey =
			rawProjectKey === null || rawProjectKey === '' ? null : rawProjectKey;

		if (
			projectKey !== null &&
			!['string', 'number'].includes(typeof projectKey)
		) {
			return NextResponse.json(
				{ success: false, error: 'Invalid project ID' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		let projectId = null;

		if (projectKey !== null) {
			const [projects] = await connection.execute(
				'SELECT project_id, name FROM projects WHERE project_id = ? LIMIT 1',
				[projectKey]
			);

			if (projects.length === 0) {
				return NextResponse.json(
					{ success: false, error: 'Project not found' },
					{ status: 404 }
				);
			}

			projectId = projects[0].project_id;
		}

		const [result] = await connection.execute(
			`UPDATE quotations SET project_id = ?, updated_at = NOW() WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			[projectId, id]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Quotation not found' },
				{ status: 404 }
			);
		}

		let project_name = null;
		if (projectId !== null) {
			const [projects] = await connection.execute(
				'SELECT name FROM projects WHERE project_id = ? LIMIT 1',
				[projectId]
			);
			project_name = projects[0]?.name || null;
		}

		return NextResponse.json({
			success: true,
			data: {
				id: Number(id),
				project_id: projectId,
				project_name,
			},
		});
	} catch (error) {
		console.error('Error updating quotation project:', error);
		return NextResponse.json(
			{
				success: false,
				error: error.message || 'Failed to update quotation project',
			},
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
