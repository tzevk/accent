import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/dashboard' }));

vi.mock('next/navigation', () => ({
	usePathname: () => route.pathname,
}));
// The tracker reads its signed-in User from the Session context. The close
// beacon's listener registers on mount whether or not there is a User — a
// signed-out page's beacon is simply refused by the close endpoint — while the
// activity tracking the hook also starts needs a User id, so mock one.
vi.mock('@/context/SessionContext', () => ({
	useSession: () => ({ user: { id: 7 } }),
}));

import ActivityTracker from '@/components/ActivityTracker';

// jsdom has no `navigator.sendBeacon`, so the Work Session close beacon is
// only observable through this stub.
const beaconMock = vi.fn();

beforeEach(() => {
	route.pathname = '/dashboard';
	beaconMock.mockReset();
	beaconMock.mockReturnValue(true);
	Object.defineProperty(window.navigator, 'sendBeacon', {
		configurable: true,
		writable: true,
		value: beaconMock,
	});
});

describe('ActivityTracker Work Session close beacon', () => {
	it('beacons the close to the Work Session endpoint when the page goes away', async () => {
		render(<ActivityTracker />);

		// Nothing is sent while the page is still up.
		expect(beaconMock).not.toHaveBeenCalled();

		fireEvent(window, new Event('pagehide'));

		expect(beaconMock).toHaveBeenCalledTimes(1);
		const [endpoint, body] = beaconMock.mock.calls[0];
		expect(endpoint).toBe('/api/work-sessions/close');
		expect(body).toBeInstanceOf(Blob);
		expect(body.type).toBe('application/json');
		const payload = JSON.parse(await body.text());
		// The endpoint stamps the time the browser reports, as an ISO 8601
		// timestamp (an unreadable one is stamped by the database instead).
		expect(typeof payload.closedAt).toBe('string');
		expect(Number.isNaN(Date.parse(payload.closedAt))).toBe(false);
	});

	it('keeps the Work Session open across in-app client navigation', () => {
		const { rerender } = render(<ActivityTracker />);

		// An in-app route change is not a page unload, so a User who moves
		// around the app keeps their Work Session.
		route.pathname = '/employees';
		rerender(<ActivityTracker />);

		expect(beaconMock).not.toHaveBeenCalled();
	});
});
