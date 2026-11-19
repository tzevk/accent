import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ apiPost }));

import { logout } from '@/lib/logout';

beforeEach(() => {
	apiPost.mockReset();
});

describe('logout transition', () => {
	it('revokes the session before replacing the document', async () => {
		const steps: string[] = [];
		apiPost.mockImplementation(async () => {
			steps.push('revoke');
			return { success: true };
		});
		const redirect = vi.fn((path: string) => {
			steps.push(`redirect:${path}`);
		});

		const outcome = await logout({ redirect });

		expect(apiPost).toHaveBeenCalledWith('/api/logout');
		expect(outcome).toEqual({ status: 'signed-out' });
		expect(steps).toEqual(['revoke', 'redirect:/signin']);
		expect(redirect).toHaveBeenCalledTimes(1);
	});

	it('reports a server rejection instead of navigating', async () => {
		apiPost.mockResolvedValue({ success: false, error: 'Session not revoked' });
		const redirect = vi.fn();

		const outcome = await logout({ redirect });

		expect(outcome).toEqual({
			status: 'failed',
			message: 'Session not revoked',
		});
		expect(redirect).not.toHaveBeenCalled();
	});

	it('requires an explicit success:true before navigating', async () => {
		apiPost.mockResolvedValue({});
		const redirect = vi.fn();

		const outcome = await logout({ redirect });

		expect(outcome).toEqual({
			status: 'failed',
			message: 'The server did not confirm sign out.',
		});
		expect(redirect).not.toHaveBeenCalled();
	});

	it('reports a network failure instead of navigating', async () => {
		apiPost.mockRejectedValue(new Error('Failed to fetch'));
		const redirect = vi.fn();

		const outcome = await logout({ redirect });

		expect(outcome).toEqual({ status: 'failed', message: 'Failed to fetch' });
		expect(redirect).not.toHaveBeenCalled();
	});

	it('shares one revocation and one replacement between concurrent calls', async () => {
		const { promise, resolve } = Promise.withResolvers<{ success: true }>();
		apiPost.mockReturnValue(promise);
		const firstRedirect = vi.fn();
		const secondRedirect = vi.fn();

		const first = logout({ redirect: firstRedirect });
		const second = logout({ redirect: secondRedirect });
		resolve({ success: true });

		await expect(first).resolves.toEqual({ status: 'signed-out' });
		await expect(second).resolves.toEqual({ status: 'signed-out' });
		expect(apiPost).toHaveBeenCalledTimes(1);
		expect(firstRedirect).toHaveBeenCalledTimes(1);
		expect(firstRedirect).toHaveBeenCalledWith('/signin');
		expect(secondRedirect).not.toHaveBeenCalled();
	});

	it('allows a retry after a failed attempt', async () => {
		apiPost
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce({ success: true });
		const redirect = vi.fn();

		const failed = await logout({ redirect });
		const retried = await logout({ redirect });

		expect(failed.status).toBe('failed');
		expect(retried).toEqual({ status: 'signed-out' });
		expect(apiPost).toHaveBeenCalledTimes(2);
		expect(redirect).toHaveBeenCalledTimes(1);
		expect(redirect).toHaveBeenCalledWith('/signin');
	});
});
