# The unauthenticated surface is an exact-match allowlist of five endpoints

`src/proxy.ts`'s `publicPaths` matched by prefix (`pathname === p || pathname.startsWith(p + '/')`), including `/api/auth` — so any future route under `api/auth/` would silently become public, and the unused legacy `/api/auth/login/route.js` was already a standalone credential oracle outside the session model. Separately, `/api/health` (not on the list, so probe-able with any `session` value) returned DB pool stats, and the twelve handlers found unguarded by the gap sweep showed the list had never been treated as a security boundary.

We decided the unauthenticated surface is exactly these five endpoints, matched exactly:

- `/api/login` — establishes the session.
- `/api/logout` — revokes the current session; no identity required.
- `/api/session` — reports whether the caller has a valid session (the client's bootstrap probe).
- `/api/attendance/webhook` — machine caller; its real boundary is the Bearer secret check inside the handler (`route.ts:52-55,111-122`).
- `/api/health` — uptime probe; payload reduced to `{ status: 'ok' }`, no pool stats, versions, or internals.

Plus static asset paths (`/_next`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/accent-logo.png`, `/public`, `/uploads`) which serve no data. `/api/auth/login` and the `/api/auth` prefix entry are deleted. Prefix matching is removed: every entry is an exact path. Adding an endpoint to the list requires a line in this ADR's consequences (or a superseding ADR) stating who calls it and why it cannot carry a session — the CI route guard's allowlist file mirrors this list.

Considered: (a) keep the prefix rule for future auth sub-routes — rejected, the only reason it existed was the legacy login twin being deleted; (b) require a session for `/api/health` — rejected, uptime probes cannot authenticate and the minimal payload leaks nothing; (c) delete `/api/health` — rejected, it is the only liveness probe; (d) move the allowlist into a config file — rejected, `src/proxy.ts` is the single reader and a config indirection adds a second source of truth.

Consequences: `/api/health` answers without a session, so it must never gain data-bearing fields; the webhook's Bearer check becomes load-bearing for an unauthenticated route and must keep its constant-time comparison; PRs that add an `api/auth/*` route now fail the route guard instead of shipping public; the CI allowlist (`scripts/route-auth-allowlist.json`) and `src/proxy.ts` must be updated together.
