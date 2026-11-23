// Theme state and the light/dark circular View Transition reveal.
//
// `:root[data-theme]` is an explicit override only: light or dark. When the
// attribute is absent the document follows the OS via CSS media queries, so
// System mode keeps working with JavaScript unavailable. The stored value is
// the same explicit override; it is removed when a toggle lands back on the
// theme the OS is already showing.

const STORAGE_KEY = 'accent-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const TRANSITION_ATTRIBUTE = 'data-theme-transition';
const SNAPSHOT_ATTRIBUTE = 'data-theme-snapshot';

type Theme = 'light' | 'dark';
type Point = { x: number; y: number };

/**
 * Parser-blocking bootstrap for the root layout's <head>. Runs before paint,
 * restores an explicit override, and keeps the color-scheme meta in sync with
 * it. Storage access is best-effort: a blocked localStorage must not stop the
 * rest of the document from rendering.
 */
export const themeBootstrapScript = `(function(){try{var value=null;try{value=window.localStorage.getItem(${JSON.stringify(
	STORAGE_KEY
)})}catch(error){}if(value==='light'||value==='dark'){document.documentElement.setAttribute('data-theme',value);var meta=document.querySelector('meta[name="color-scheme"]');if(meta){meta.setAttribute('content',value)}}}catch(error){}})();`;

let mediaQuery: MediaQueryList | null = null;
let mediaQueryResolved = false;
let environmentListenersInstalled = false;
const listeners = new Set<() => void>();

let activeTransition: ViewTransition | null = null;
let pendingTheme: Theme | null = null;

function canUseDom() {
	return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getMediaQuery() {
	if (!canUseDom() || typeof window.matchMedia !== 'function') return null;
	if (!mediaQueryResolved) {
		mediaQueryResolved = true;
		try {
			mediaQuery = window.matchMedia(DARK_QUERY);
		} catch {
			mediaQuery = null;
		}
	}
	return mediaQuery;
}

function setStoredTheme(theme: Theme | null) {
	if (!canUseDom()) return;
	try {
		if (theme) window.localStorage.setItem(STORAGE_KEY, theme);
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Private mode / blocked storage: the current document still changes.
	}
}

function syncColorSchemeMeta(theme: Theme | null) {
	const meta = document.querySelector('meta[name="color-scheme"]');
	if (meta) meta.setAttribute('content', theme ?? 'light dark');
}

function notifyThemeListeners() {
	for (const listener of Array.from(listeners)) listener();
}

function applyTheme(target: Theme) {
	if (!canUseDom()) return;
	const root = document.documentElement;
	const isSystemTheme =
		target === (getMediaQuery()?.matches ? 'dark' : 'light');

	// An override that merely restates the OS theme is System mode. Removing it
	// means a later OS change is allowed to flow through.
	if (isSystemTheme) root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', target);

	setStoredTheme(isSystemTheme ? null : target);
	syncColorSchemeMeta(isSystemTheme ? null : target);
	notifyThemeListeners();
}

function applyExternalTheme(theme: Theme | null) {
	if (!canUseDom()) return;
	const root = document.documentElement;
	if (theme) root.setAttribute('data-theme', theme);
	else root.removeAttribute('data-theme');
	syncColorSchemeMeta(theme);
	notifyThemeListeners();
}

function handleSystemThemeChange() {
	const explicit = document.documentElement.getAttribute('data-theme');
	if (explicit === 'light' || explicit === 'dark') return;
	notifyThemeListeners();
}

function handleStorageChange(event: StorageEvent) {
	// A clear() broadcasts key === null; both cases are reconciled here.
	if (event.key !== null && event.key !== STORAGE_KEY) return;
	const next =
		event.newValue === 'light' || event.newValue === 'dark'
			? event.newValue
			: null;
	applyExternalTheme(next);
}

function ensureEnvironmentListeners() {
	if (environmentListenersInstalled || !canUseDom()) return;
	environmentListenersInstalled = true;
	getMediaQuery()?.addEventListener('change', handleSystemThemeChange);
	window.addEventListener('storage', handleStorageChange);
}

function getRevealGeometry(point: Point) {
	const width = Math.max(
		document.documentElement.clientWidth || 0,
		window.innerWidth
	);
	const height = Math.max(
		document.documentElement.clientHeight || 0,
		window.innerHeight
	);
	const x = Math.min(Math.max(point.x, 0), width);
	const y = Math.min(Math.max(point.y, 0), height);

	return {
		x,
		y,
		// Distance to the farthest viewport corner; the whole viewport is
		// covered by the end of the reveal in every direction.
		radius: Math.hypot(Math.max(x, width - x), Math.max(y, height - y)),
	};
}

function startThemeTransition(target: Theme, point: Point | undefined) {
	if (!canUseDom()) return;

	const reduceMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const transitionDocument = document as Document & {
		startViewTransition?: Document['startViewTransition'];
	};
	const geometry =
		!reduceMotion &&
		point &&
		Number.isFinite(point.x) &&
		Number.isFinite(point.y)
			? getRevealGeometry(point)
			: null;
	const canAnimate =
		geometry !== null &&
		typeof transitionDocument.startViewTransition === 'function';

	// Pointer activation only, in a browser with same-document View
	// Transitions, and only when the visitor has not asked for reduced motion.
	// Every other path changes the theme without motion.
	if (!canAnimate) {
		applyTheme(target);
		return;
	}

	const root = document.documentElement;
	root.style.setProperty('--theme-reveal-x', `${geometry.x}px`);
	root.style.setProperty('--theme-reveal-y', `${geometry.y}px`);
	root.style.setProperty('--theme-reveal-radius', `${geometry.radius}px`);
	root.setAttribute(TRANSITION_ATTRIBUTE, 'reveal');
	root.setAttribute(SNAPSHOT_ATTRIBUTE, '');

	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		root.removeAttribute(TRANSITION_ATTRIBUTE);
		root.removeAttribute(SNAPSHOT_ATTRIBUTE);
		root.style.removeProperty('--theme-reveal-x');
		root.style.removeProperty('--theme-reveal-y');
		root.style.removeProperty('--theme-reveal-radius');
		activeTransition = null;

		// A click that arrived mid-reveal is applied without stacking a second
		// transition; the latest intent wins and motion stays rate-limited.
		const queuedTheme = pendingTheme;
		pendingTheme = null;
		if (queuedTheme) applyTheme(queuedTheme);
	};

	let transition: ViewTransition;
	try {
		transition = transitionDocument.startViewTransition(() => {
			applyTheme(target);
		});
	} catch {
		cleanup();
		applyTheme(target);
		return;
	}

	activeTransition = transition;

	transition.ready.then(
		() => root.removeAttribute(SNAPSHOT_ATTRIBUTE),
		() => root.removeAttribute(SNAPSHOT_ATTRIBUTE)
	);
	transition.finished.then(cleanup, cleanup);
}

export function subscribeTheme(listener: () => void): () => void {
	if (!canUseDom()) return () => {};
	ensureEnvironmentListeners();
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

export function getDarkTheme(): boolean {
	if (!canUseDom()) return false;
	const explicit = document.documentElement.getAttribute('data-theme');
	if (explicit === 'dark') return true;
	if (explicit === 'light') return false;
	return Boolean(getMediaQuery()?.matches);
}

export function toggleTheme(point?: { x: number; y: number }): void {
	if (!canUseDom()) return;
	ensureEnvironmentListeners();

	if (activeTransition) {
		// Resolve each activation against the most recently requested theme, so
		// two rapid clicks still mean "back to where I was".
		const base = pendingTheme ?? (getDarkTheme() ? 'dark' : 'light');
		pendingTheme = base === 'dark' ? 'light' : 'dark';
		return;
	}

	// Two states only: flip what is rendered. Landing back on the OS theme
	// removes the override; any other choice stays pinned in storage.
	const target: Theme = getDarkTheme() ? 'light' : 'dark';
	startThemeTransition(target, point);
}
