import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import NotificationsBell from './NotificationsBell';

const { useSessionRBAC } = vi.hoisted(() => ({ useSessionRBAC: vi.fn() }));

vi.mock('@/utils/client-rbac', () => ({ useSessionRBAC }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('polls only while the signed-in user can see the notifications bell', async () => {
	vi.useFakeTimers();
	const user = { id: 42 };
	let canApprove = false;
	useSessionRBAC.mockReturnValue({
		user,
		can: (resource: string, action: string) =>
			canApprove && resource === 'leaves' && action === 'approve',
	});
	let pending = 1;
	const fetchNotifications = vi.fn(async () =>
		Response.json({ success: true, data: { pending_count: pending } })
	);
	vi.stubGlobal('fetch', fetchNotifications);

	const { rerender } = render(<NotificationsBell />);
	await act(() => vi.advanceTimersByTimeAsync(60_000));
	expect(screen.queryByRole('button', { name: /notifications/i })).toBeNull();
	expect(fetchNotifications).not.toHaveBeenCalled();

	canApprove = true;
	await act(async () => {
		rerender(<NotificationsBell />);
	});
	expect(fetchNotifications).toHaveBeenCalledExactlyOnceWith(
		'/api/notifications',
		expect.anything()
	);
	expect(
		screen.getByRole('button', { name: 'Notifications, 1 pending' })
	).toBeVisible();

	pending = 2;
	await act(() => vi.advanceTimersByTimeAsync(60_000));
	expect(
		screen.getByRole('button', { name: 'Notifications, 2 pending' })
	).toBeVisible();

	canApprove = false;
	rerender(<NotificationsBell />);
	await act(() => vi.advanceTimersByTimeAsync(60_000));
	expect(screen.queryByRole('button', { name: /notifications/i })).toBeNull();
	expect(fetchNotifications).toHaveBeenCalledTimes(2);
});
