import { useCallback, useEffect, useRef, useState } from 'react';

const WARNING_THRESHOLD_MS = 7_200_000;
const CHECK_INTERVAL_MS = 60_000;
const SNOOZE_MS = 7_200_000;

export interface UseActivityLogReminderParams {
	userId: string | number | undefined;
	enabled: boolean;
	lastActivityLoggedAt: number | null;
}

export interface UseActivityLogReminderResult {
	showReminder: boolean;
	secondsSinceLastLog: number;
	dismiss: () => void;
}

interface ReminderRecord {
	baseline: number;
	lastSavedAt: number | null;
	snoozedUntil: number;
}

function toLocalDay(now: number): string {
	const d = new Date(now);
	const m = d.getMonth() + 1;
	const day = d.getDate();
	return `${d.getFullYear()}-${m < 10 ? `0${m}` : m}-${day < 10 ? `0${day}` : day}`;
}

function buildKey(userId: string | number, day: string): string {
	return `activity-log-reminder:${String(userId)}:${day}`;
}

function isMissingUser(userId: string | number | undefined): boolean {
	return userId === undefined || (userId as unknown) === null || userId === '';
}

function isValidToday(ts: unknown, now: number): ts is number {
	if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
	if (ts <= 0 || ts > now) return false;
	return toLocalDay(ts) === toLocalDay(now);
}

function readRecord(key: string): ReminderRecord | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const p = JSON.parse(raw) as Partial<ReminderRecord>;
		if (typeof p.baseline !== 'number' || !Number.isFinite(p.baseline))
			return null;
		if (
			p.lastSavedAt !== null &&
			p.lastSavedAt !== undefined &&
			(typeof p.lastSavedAt !== 'number' || !Number.isFinite(p.lastSavedAt))
		) {
			return null;
		}
		if (typeof p.snoozedUntil !== 'number' || !Number.isFinite(p.snoozedUntil))
			return null;
		return {
			baseline: p.baseline,
			lastSavedAt: p.lastSavedAt ?? null,
			snoozedUntil: p.snoozedUntil,
		};
	} catch {
		return null;
	}
}

function writeRecord(key: string, rec: ReminderRecord): void {
	try {
		localStorage.setItem(key, JSON.stringify(rec));
	} catch {
		// Storage denied: retain in-memory state only.
	}
}

function newestValid(
	cands: ReadonlyArray<unknown>,
	now: number
): number | null {
	let best: number | null = null;
	for (const c of cands) {
		if (isValidToday(c, now) && (best === null || (c as number) > best))
			best = c as number;
	}
	return best;
}

function mergeRecord(
	mem: ReminderRecord | null,
	persisted: ReminderRecord | null,
	serverSave: number | null,
	now: number
): ReminderRecord {
	const best = newestValid(
		[mem?.lastSavedAt, persisted?.lastSavedAt, serverSave],
		now
	);
	if (best !== null) {
		const s1 = mem?.lastSavedAt === best ? mem.snoozedUntil : 0;
		const s2 = persisted?.lastSavedAt === best ? persisted.snoozedUntil : 0;
		return {
			baseline: best,
			lastSavedAt: best,
			snoozedUntil: Math.max(s1, s2),
		};
	}
	const memBase = mem && isValidToday(mem.baseline, now) ? mem.baseline : null;
	const perBase =
		persisted && isValidToday(persisted.baseline, now)
			? persisted.baseline
			: null;
	const snooze = Math.max(mem?.snoozedUntil ?? 0, persisted?.snoozedUntil ?? 0);
	return {
		baseline: memBase ?? perBase ?? now,
		lastSavedAt: null,
		snoozedUntil: Number.isFinite(snooze) ? snooze : 0,
	};
}

export function useActivityLogReminder({
	userId,
	enabled,
	lastActivityLoggedAt,
}: UseActivityLogReminderParams): UseActivityLogReminderResult {
	const recordRef = useRef<ReminderRecord | null>(null);
	const keyRef = useRef<string | null>(null);
	const [snapshot, setSnapshot] = useState<{
		key: string | null;
		showReminder: boolean;
		secondsSinceLastLog: number;
	}>({ key: null, showReminder: false, secondsSinceLastLog: 0 });

	const missing = isMissingUser(userId);
	const userStr = missing ? null : String(userId);
	const currentKey =
		enabled && userStr ? buildKey(userStr, toLocalDay(Date.now())) : null;

	const dismiss = useCallback(() => {
		if (!enabled || userStr === null) return;
		const now = Date.now();
		const key = buildKey(userStr, toLocalDay(now));
		let rec = keyRef.current === key ? recordRef.current : null;
		if (!rec) {
			const persisted = readRecord(key);
			const last =
				persisted && isValidToday(persisted.lastSavedAt, now)
					? (persisted.lastSavedAt as number)
					: null;
			const base =
				last ??
				(persisted && isValidToday(persisted.baseline, now)
					? persisted.baseline
					: now);
			rec = {
				baseline: base,
				lastSavedAt: last,
				snoozedUntil: persisted?.snoozedUntil ?? 0,
			};
			keyRef.current = key;
			recordRef.current = rec;
		}
		const updated: ReminderRecord = { ...rec, snoozedUntil: now + SNOOZE_MS };
		recordRef.current = updated;
		writeRecord(key, updated);
		const elapsed = now - updated.baseline;
		setSnapshot({
			key,
			showReminder: false,
			secondsSinceLastLog: Math.floor(
				(elapsed >= 0 && Number.isFinite(elapsed) ? elapsed : 0) / 1000
			),
		});
	}, [enabled, userStr]);

	useEffect(() => {
		if (!enabled || isMissingUser(userId)) {
			setSnapshot({ key: null, showReminder: false, secondsSinceLastLog: 0 });
			return;
		}
		const uid = String(userId);
		const serverSave = lastActivityLoggedAt;

		const check = (): void => {
			const now = Date.now();
			const key = buildKey(uid, toLocalDay(now));
			const mem = keyRef.current === key ? recordRef.current : null;
			const persisted = readRecord(key);
			const merged = mergeRecord(mem, persisted, serverSave, now);
			keyRef.current = key;
			recordRef.current = merged;
			if (
				!persisted ||
				persisted.baseline !== merged.baseline ||
				persisted.lastSavedAt !== merged.lastSavedAt ||
				persisted.snoozedUntil !== merged.snoozedUntil
			) {
				writeRecord(key, merged);
			}
			const elapsed = now - merged.baseline;
			const valid = elapsed >= 0 && Number.isFinite(elapsed) ? elapsed : 0;
			setSnapshot({
				key,
				showReminder:
					valid >= WARNING_THRESHOLD_MS && now >= merged.snoozedUntil,
				secondsSinceLastLog: Math.floor(valid / 1000),
			});
		};

		check();

		const interval = window.setInterval(check, CHECK_INTERVAL_MS);
		const onFocus = (): void => {
			check();
		};
		const onVisibility = (): void => {
			if (document.visibilityState === 'visible') check();
		};
		const onSaved = (ev: Event): void => {
			const detail = (
				ev as CustomEvent<{ userId?: unknown; savedAt?: unknown }>
			).detail;
			if (!detail || String(detail.userId) !== uid) return;
			const now = Date.now();
			if (!isValidToday(detail.savedAt, now)) return;
			const t = detail.savedAt as number;
			const key = buildKey(uid, toLocalDay(now));
			const rec: ReminderRecord = {
				baseline: t,
				lastSavedAt: t,
				snoozedUntil: 0,
			};
			keyRef.current = key;
			recordRef.current = rec;
			writeRecord(key, rec);
			const elapsed = now - t;
			setSnapshot({
				key,
				showReminder: elapsed >= WARNING_THRESHOLD_MS,
				secondsSinceLastLog: Math.floor((elapsed >= 0 ? elapsed : 0) / 1000),
			});
		};
		const onStorage = (ev: Event): void => {
			const key = (ev as StorageEvent).key;
			if (key == null) return;
			if (key !== buildKey(uid, toLocalDay(Date.now()))) return;
			check();
		};

		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('activity-log-saved', onSaved);
		window.addEventListener('storage', onStorage);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('activity-log-saved', onSaved);
			window.removeEventListener('storage', onStorage);
		};
	}, [enabled, userId, lastActivityLoggedAt]);

	const isolated = snapshot.key === currentKey;
	return {
		showReminder: isolated ? snapshot.showReminder : false,
		secondsSinceLastLog: isolated ? snapshot.secondsSinceLastLog : 0,
		dismiss,
	};
}
