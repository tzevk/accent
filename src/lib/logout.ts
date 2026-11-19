import { apiPost } from '@/lib/api-client';

/**
 * The client half of signing out.
 *
 * Both halves are ordered here on purpose: the revocation request completes
 * before the document is replaced. A soft `router.push` keeps the signed-out
 * SPA mounted while the next page renders, so its in-flight polls can receive
 * a post-revocation 401 and log it, and a session response that was authorized
 * before the revocation can repopulate the old provider. A hard replace tears
 * the document down and starts the next page with a fresh SessionProvider.
 *
 * A failed POST is reported to the caller — it is never treated as success.
 */
const SIGNIN_PATH = '/signin';

export type LogoutOutcome =
	| { status: 'signed-out' }
	| { status: 'failed'; message: string };

type LogoutOptions = {
	/** Test seam; production always uses the browser's hard navigation. */
	redirect?: (path: string) => void;
};

type LogoutResponse = {
	success?: boolean;
	error?: string;
	message?: string;
};

let inFlight: Promise<LogoutOutcome> | null = null;

async function performLogout(
	redirect: (path: string) => void
): Promise<LogoutOutcome> {
	let data: LogoutResponse | null = null;

	try {
		data = await apiPost<LogoutResponse>('/api/logout');
	} catch (error) {
		return {
			status: 'failed',
			message:
				error instanceof Error ? error.message : 'Could not reach the server.',
		};
	}

	// The client navigates only after the endpoint confirms sign-out.
	if (data?.success !== true) {
		return {
			status: 'failed',
			message:
				data?.error || data?.message || 'The server did not confirm sign out.',
		};
	}

	redirect(SIGNIN_PATH);
	return { status: 'signed-out' };
}

/**
 * Revoke the session, then replace the current document with /signin.
 * Concurrent calls share one POST and one replacement, so a double click
 * cannot revoke twice or navigate twice.
 */
export function logout(options: LogoutOptions = {}): Promise<LogoutOutcome> {
	if (!inFlight) {
		const redirect =
			options.redirect ?? ((path: string) => window.location.replace(path));
		inFlight = performLogout(redirect).finally(() => {
			inFlight = null;
		});
	}

	return inFlight;
}
