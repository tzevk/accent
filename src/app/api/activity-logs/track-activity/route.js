import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	logActivity,
	updateScreenTime,
	updateUserPresence,
} from '@/utils/activity-logger';

/**
 * POST - Track detailed user activity (screen time, interactions, etc.)
 * This endpoint receives client-side activity data
 *
 * Auth: ANY logged-in user may report their own activity. The user id always
 * comes from the session (getCurrentUser), never from the client payload, so
 * users can only ever write rows for themselves. A permission gate here is
 * wrong: users with limited roles (e.g. empty permission arrays) would 403
 * and their presence/heartbeats would silently never arrive.
 */
export async function POST(request) {
	try {
		const currentUser = await getCurrentUser(request);
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Parse request body with error handling
		let data;
		try {
			const text = await request.text();
			if (!text || text.trim() === '') {
				return NextResponse.json({ success: true }); // Silently ignore empty requests
			}
			data = JSON.parse(text);
		} catch (parseError) {
			console.warn('Activity tracking: Invalid JSON body', parseError.message);
			return NextResponse.json({ success: true }); // Silently ignore invalid JSON
		}

		// Handle batched activities
		if (data.batch && data.activities) {
			for (const activity of data.activities) {
				await processActivity(currentUser.id, activity, request);
			}
			return NextResponse.json({ success: true });
		}

		// Handle single activity
		await processActivity(currentUser.id, data, request);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error tracking activity:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to track activity',
			},
			{ status: 500 }
		);
	}
}

async function processActivity(userId, data, request) {
	const { actionType, resourceType, description, details, timestamp } = data;

	// Validate required fields
	if (!actionType || !resourceType) {
		return;
	}

	// Log the activity
	await logActivity({
		userId,
		actionType,
		resourceType,
		description: description || `${actionType} on ${resourceType}`,
		details: {
			...details,
			clientTimestamp: timestamp,
			userAgent: request.headers.get('user-agent'),
			referer: request.headers.get('referer'),
		},
		request,
		status: 'success',
	});

	// Update screen time for heartbeat events
	if (resourceType === 'heartbeat' && details) {
		await updateScreenTime(userId, {
			activeDeltaMs: details.activeDeltaMs || 0,
			idleDeltaMs: details.idleDeltaMs || 0,
			activeTimeMs: details.activeTime || 0,
			idleTimeMs: details.idleTime || 0,
			sessionDurationMs: details.sessionDurationMs || 0,
		});
	}

	// Update presence: any event refreshes last_seen; heartbeats carry the
	// authoritative idle state, status_change marks idle/active transitions,
	// view_page reports the current page.
	const presence = { isIdle: null, currentPage: null };
	if (resourceType === 'heartbeat' && details) {
		presence.isIdle = details.isIdle === true;
		presence.currentPage = details.currentPage || null;
	} else if (actionType === 'status_change' && details) {
		if (details.status === 'idle') presence.isIdle = true;
		else if (details.status === 'active') presence.isIdle = false;
	} else if (actionType === 'view_page' && details) {
		// `to` is the page the user navigated to (presence should reflect
		// where they are NOW); `page` is the page they left.
		presence.currentPage = details.to || details.page || null;
	}
	await updateUserPresence(userId, presence);
}
