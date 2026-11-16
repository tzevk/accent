'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Only one mounted editor owns the sentinel. StrictMode replays effects and
 * page transitions can briefly overlap two editor instances; the token keeps a
 * stale cleanup from traversing the history of the instance that replaced it.
 */
let currentGuardToken: symbol | null = null;

const GUARD_STATE_KEY = '__salaryProfileUnsavedGuard';

function isSentinelState(state: unknown): boolean {
	return (
		Boolean(state) &&
		typeof state === 'object' &&
		(state as Record<string, unknown>)[GUARD_STATE_KEY] === true
	);
}

export interface UnsavedNavigationGuard {
	promptOpen: boolean;
	stay: () => void;
	discard: () => void;
	leaveFor: (href: string) => void;
}

/**
 * Keeps an unsaved draft on screen when the operator uses the browser Back
 * gesture.
 *
 * A sentinel history entry with the same URL sits above the editor entry, so
 * stepping back onto the editor URL keeps the route mounted. The popstate
 * handler then re-arms the sentinel before any route change can commit and
 * opens an in-app decision. Answering "Stay" leaves that sentinel in place;
 * "Discard" traverses past both the sentinel and the editor entry in one step,
 * so the operator lands on the previous page instead of bouncing back into the
 * editor.
 *
 * The sentinel is tracked by position rather than by its state payload: the
 * App Router may rewrite that payload when it restores the shared URL, so
 * removal never depends on the marker. The entry is removed when the draft
 * stops being dirty, when the editor unmounts while the sentinel is current,
 * and when the route changes.
 */
export function useUnsavedNavigationGuard(
	dirty: boolean,
	fallbackHref: string
): UnsavedNavigationGuard {
	const pathname = usePathname();
	const router = useRouter();
	const routerRef = useRef(router);
	const [promptOpen, setPromptOpen] = useState(false);
	const releasedRef = useRef(false);
	const armedRef = useRef(false);
	const listeningRef = useRef(false);
	const pendingLeaveRef = useRef<string | null>(null);
	const cleanupTimerRef = useRef<number | null>(null);

	useEffect(() => {
		routerRef.current = router;
	}, [router]);

	useEffect(() => {
		if (!dirty) {
			setPromptOpen(false);
			return;
		}

		releasedRef.current = false;
		const token = Symbol('salary-profile-unsaved-guard');
		currentGuardToken = token;
		const armedPathname = window.location.pathname;

		if (cleanupTimerRef.current !== null) {
			window.clearTimeout(cleanupTimerRef.current);
			cleanupTimerRef.current = null;
		}

		// The App Router stores its own routing state in the current history
		// entry; carry it onto the sentinel so restoring either entry stays
		// inside the SPA router.
		const pushSentinel = () => {
			const currentState = window.history.state;
			window.history.pushState(
				{
					...(currentState && typeof currentState === 'object'
						? currentState
						: {}),
					[GUARD_STATE_KEY]: true,
				},
				'',
				window.location.href
			);
			armedRef.current = true;
		};
		if (!armedRef.current) pushSentinel();

		const handlePopState = () => {
			if (releasedRef.current) {
				const pendingHref = pendingLeaveRef.current;
				if (pendingHref) {
					pendingLeaveRef.current = null;
					routerRef.current.push(pendingHref);
				}
				return;
			}
			// A traversal that escaped the sentinel has already moved the route;
			// re-arming it would desynchronise the App Router.
			if (window.location.pathname !== armedPathname) return;
			pushSentinel();
			setPromptOpen(true);
		};

		window.addEventListener('popstate', handlePopState);
		listeningRef.current = true;
		return () => {
			window.removeEventListener('popstate', handlePopState);
			listeningRef.current = false;
			if (currentGuardToken === token) currentGuardToken = null;

			// Defer the removal so StrictMode's immediate effect replay, and a
			// draft that becomes dirty again in the same tick, keep the sentinel.
			cleanupTimerRef.current = window.setTimeout(() => {
				cleanupTimerRef.current = null;
				if (currentGuardToken !== null) return;
				const wasArmed = armedRef.current;
				armedRef.current = false;
				if (
					wasArmed &&
					isSentinelState(window.history.state) &&
					window.location.pathname === armedPathname
				) {
					window.history.back();
				}
			}, 0);
		};
	}, [dirty, pathname]);

	const stay = useCallback(() => {
		setPromptOpen(false);
	}, []);

	const leaveFor = useCallback((href: string) => {
		if (releasedRef.current) return;
		if (
			!armedRef.current ||
			!listeningRef.current ||
			!isSentinelState(window.history.state)
		) {
			routerRef.current.push(href);
			return;
		}
		armedRef.current = false;
		releasedRef.current = true;
		pendingLeaveRef.current = href;
		// Consume only the guard's sentinel, then continue to the requested page.
		window.history.back();
	}, []);

	const discard = useCallback(() => {
		if (releasedRef.current) return;
		releasedRef.current = true;
		setPromptOpen(false);
		currentGuardToken = null;
		const wasArmed = armedRef.current;
		armedRef.current = false;
		if (!wasArmed) {
			routerRef.current.push(fallbackHref);
			return;
		}
		if (window.history.length <= 2) {
			// A new tab or a deep link has nothing behind the editor. Consume the
			// sentinel, then leave for the workspace instead of keeping a
			// discarded draft on screen.
			pendingLeaveRef.current = fallbackHref;
			window.history.back();
			return;
		}
		// One sentinel re-arm plus the editor entry sit above the previous page.
		window.history.go(-2);
	}, [fallbackHref]);

	return { promptOpen, stay, discard, leaveFor };
}
