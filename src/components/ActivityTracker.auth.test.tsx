import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ authenticated: false }));
const trackPageView = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
	usePathname: () => '/dashboard',
}));
vi.mock('@/context/SessionContext', () => ({
	useSession: () => session,
}));
vi.mock('@/hooks/useActivityTracker', () => ({
	useActivityTracker: () => ({ trackPageView }),
}));

import ActivityTracker from '@/components/ActivityTracker';

const beaconMock =
	vi.fn<(url: string | URL, data?: BodyInit | null) => boolean>();

beforeEach(() => {
	session.authenticated = false;
	trackPageView.mockReset();
	beaconMock.mockReset();
	beaconMock.mockReturnValue(true);
	Object.defineProperty(window.navigator, 'sendBeacon', {
		configurable: true,
		writable: true,
		value: beaconMock,
	});
});

describe('ActivityTracker authenticated Work Session close beacon', () => {
	it('does not send a close beacon before authentication', () => {
		render(<ActivityTracker />);

		fireEvent(window, new Event('pagehide'));

		expect(beaconMock).not.toHaveBeenCalled();
	});

	it('sends a close beacon on pagehide after authentication', () => {
		const { rerender } = render(<ActivityTracker />);
		session.authenticated = true;
		rerender(<ActivityTracker />);

		fireEvent(window, new Event('pagehide'));

		expect(beaconMock).toHaveBeenCalledTimes(1);
		expect(beaconMock).toHaveBeenCalledWith(
			'/api/work-sessions/close',
			expect.any(Blob)
		);
	});

	it('stops sending close beacons when authentication is lost', () => {
		session.authenticated = true;
		const { rerender } = render(<ActivityTracker />);
		fireEvent(window, new Event('pagehide'));
		expect(beaconMock).toHaveBeenCalledTimes(1);

		session.authenticated = false;
		rerender(<ActivityTracker />);
		fireEvent(window, new Event('pagehide'));

		expect(beaconMock).toHaveBeenCalledTimes(1);
	});
});
