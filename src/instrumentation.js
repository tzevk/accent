/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to initialize database schema so API routes don't need inline DDL.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the server (Node.js runtime), not on Edge
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { ensureSchema } = await import('@/utils/schema-init');
      await ensureSchema();
      console.log('[Instrumentation] Database schema initialized on server start');
    } catch (err) {
      // Non-fatal: API routes have inline DDL as fallback (gated to first call)
      console.warn('[Instrumentation] Schema init failed (will retry per-route):', err?.message || err);
    }
  }
}
