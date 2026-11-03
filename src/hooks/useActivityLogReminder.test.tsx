import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivityLogReminder } from './useActivityLogReminder';

const START = new Date(2026, 10, 2, 9, 0, 0);
const MINUTE = 60_000;
const TWO_HOURS_MS = 7_200_000;

interface ReminderProps {
	userId: string | number | undefined;
	enabled: boolean;
	lastActivityLoggedAt: number | null;
}

function storageKey(userId: string | number, at: number): string {
	const d = new Date(at);
	const yyyy = String(d.getFullYear());
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `activity-log-reminder:${String(userId)}:${yyyy}-${mm}-${dd}`;
}

function renderReminder(props: ReminderProps) {
	return renderHook(
		({ userId, enabled, lastActivityLoggedAt }: ReminderProps) =>
			useActivityLogReminder({ userId, enabled, lastActivityLoggedAt }),
		{ initialProps: props }
	);
}

function advance(ms: number): void {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

function emitSaved(userId: string | number, savedAt: number): void {
	act(() => {
		window.dispatchEvent(
			new CustomEvent('activity-log-saved', { detail: { userId, savedAt } })
		);
	});
}

function createTestStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length(): number {
			return store.size;
		},
		clear(): void {
			store.clear();
		},
		getItem(key: string): string | null {
			const k = String(key);
			return store.has(k) ? (store.get(k) as string) : null;
		},
		setItem(key: string, value: string): void {
			store.set(String(key), String(value));
		},
		removeItem(key: string): void {
			store.delete(String(key));
		},
		key(index: number): string | null {
			const keys = Array.from(store.keys());
			return keys[index] ?? null;
		},
	};
}

beforeEach(() => {
	const storage = createTestStorage();
	vi.stubGlobal('localStorage', storage);
	try {
		if (typeof window !== 'undefined' && window.localStorage !== storage) {
			Object.defineProperty(window, 'localStorage', {
				configurable: true,
				enumerable: true,
				writable: true,
				value: storage,
			});
		}
	} catch {
		// window.localStorage not configurable; global stub is sufficient.
	}
	vi.useFakeTimers();
	vi.setSystemTime(START);
});

afterEach(() => {
	cleanup();
	try {
		globalThis.localStorage?.clear();
	} catch {
		// Storage unavailable or denied; nothing to clear.
	}
	vi.clearAllMocks();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('useActivityLogReminder', () => {
	it('stays silent before two hours and warns at exactly two hours', () => {
		const { result, unmount } = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		expect(result.current.showReminder).toBe(false);

		advance(119 * MINUTE);
		expect(result.current.showReminder).toBe(false);

		advance(MINUTE);
		expect(result.current.showReminder).toBe(true);
		expect(result.current.secondsSinceLastLog).toBe(7200);
		unmount();
	});

	it('does not let mouse or keyboard activity defer the warning', () => {
		const { result, unmount } = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});

		advance(60 * MINUTE);
		act(() => {
			window.dispatchEvent(new MouseEvent('mousemove'));
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
		});

		advance(59 * MINUTE);
		expect(result.current.showReminder).toBe(false);

		act(() => {
			window.dispatchEvent(new MouseEvent('mousemove'));
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		});
		advance(MINUTE);
		expect(result.current.showReminder).toBe(true);
		unmount();
	});

	it('matching saved event closes the warning and restarts the two-hour window', () => {
		const { result, unmount } = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		advance(TWO_HOURS_MS);
		expect(result.current.showReminder).toBe(true);

		emitSaved('42', Date.now());
		expect(result.current.showReminder).toBe(false);
		expect(result.current.secondsSinceLastLog).toBe(0);

		advance(119 * MINUTE);
		expect(result.current.showReminder).toBe(false);
		advance(MINUTE);
		expect(result.current.showReminder).toBe(true);
		unmount();
	});

	it('ignores saved events for other users', () => {
		const { result, unmount } = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		advance(60 * MINUTE);

		emitSaved(99, Date.now());
		expect(result.current.showReminder).toBe(false);
		expect(result.current.secondsSinceLastLog).toBe(3600);

		advance(60 * MINUTE);
		expect(result.current.showReminder).toBe(true);

		emitSaved(99, Date.now());
		expect(result.current.showReminder).toBe(true);
		unmount();
	});

	it('dismiss snoozes the warning for two hours', () => {
		const { result, unmount } = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		advance(TWO_HOURS_MS);
		expect(result.current.showReminder).toBe(true);

		act(() => {
			result.current.dismiss();
		});
		expect(result.current.showReminder).toBe(false);

		advance(119 * MINUTE);
		expect(result.current.showReminder).toBe(false);
		advance(MINUTE);
		expect(result.current.showReminder).toBe(true);
		unmount();
	});

	it('remount honors persisted baseline and dismissal', () => {
		const props: ReminderProps = {
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		};
		const first = renderReminder(props);
		advance(60 * MINUTE);
		expect(first.result.current.showReminder).toBe(false);
		first.unmount();

		const second = renderReminder(props);
		expect(second.result.current.showReminder).toBe(false);
		expect(second.result.current.secondsSinceLastLog).toBe(3600);
		advance(59 * MINUTE);
		expect(second.result.current.showReminder).toBe(false);
		advance(MINUTE);
		expect(second.result.current.showReminder).toBe(true);

		act(() => {
			second.result.current.dismiss();
		});
		expect(second.result.current.showReminder).toBe(false);
		second.unmount();

		const third = renderReminder(props);
		expect(third.result.current.showReminder).toBe(false);
		advance(119 * MINUTE);
		expect(third.result.current.showReminder).toBe(false);
		advance(MINUTE);
		expect(third.result.current.showReminder).toBe(true);
		third.unmount();
	});

	it('honors recent and stale server saves from today', () => {
		const recent = START.getTime() - 30 * MINUTE;
		const first = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: recent,
		});
		expect(first.result.current.showReminder).toBe(false);
		expect(first.result.current.secondsSinceLastLog).toBe(1800);
		advance(89 * MINUTE);
		expect(first.result.current.showReminder).toBe(false);
		advance(MINUTE);
		expect(first.result.current.showReminder).toBe(true);
		first.unmount();

		const stale = Date.now() - 3 * 60 * MINUTE;
		const second = renderReminder({
			userId: 99,
			enabled: true,
			lastActivityLoggedAt: stale,
		});
		expect(second.result.current.showReminder).toBe(true);
		expect(second.result.current.secondsSinceLastLog).toBe(10800);
		second.unmount();
	});

	it('never warns when disabled or user is missing', () => {
		const disabled = renderReminder({
			userId: 42,
			enabled: false,
			lastActivityLoggedAt: null,
		});
		advance(3 * 60 * MINUTE);
		expect(disabled.result.current.showReminder).toBe(false);
		disabled.unmount();

		const missing = renderReminder({
			userId: undefined,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		advance(3 * 60 * MINUTE);
		expect(missing.result.current.showReminder).toBe(false);
		missing.unmount();
	});

	it('does not bleed the previous user warning on user switch', () => {
		const { result, rerender, unmount } = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		advance(TWO_HOURS_MS);
		expect(result.current.showReminder).toBe(true);

		rerender({ userId: 99, enabled: true, lastActivityLoggedAt: null });
		expect(result.current.showReminder).toBe(false);
		expect(result.current.secondsSinceLastLog).toBe(0);

		advance(119 * MINUTE);
		expect(result.current.showReminder).toBe(false);
		advance(MINUTE);
		expect(result.current.showReminder).toBe(true);
		unmount();
	});

	it('survives denied or malformed storage without crashing', () => {
		localStorage.setItem(storageKey(42, Date.now()), 'not-json{');
		const malformed = renderReminder({
			userId: 42,
			enabled: true,
			lastActivityLoggedAt: null,
		});
		expect(malformed.result.current.showReminder).toBe(false);
		advance(TWO_HOURS_MS);
		expect(malformed.result.current.showReminder).toBe(true);
		malformed.unmount();
		localStorage.clear();

		const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		try {
			const { result, unmount } = renderReminder({
				userId: 99,
				enabled: true,
				lastActivityLoggedAt: null,
			});
			expect(result.current.showReminder).toBe(false);
			advance(119 * MINUTE);
			expect(result.current.showReminder).toBe(false);
			advance(MINUTE);
			expect(result.current.showReminder).toBe(true);

			act(() => {
				result.current.dismiss();
			});
			expect(result.current.showReminder).toBe(false);

			emitSaved(99, Date.now());
			expect(result.current.showReminder).toBe(false);
			advance(TWO_HOURS_MS);
			expect(result.current.showReminder).toBe(true);
			unmount();
		} finally {
			getSpy.mockRestore();
			setSpy.mockRestore();
		}
	});
});
