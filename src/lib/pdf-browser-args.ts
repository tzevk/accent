/**
 * Chrome flags for local/CI PDF rendering (workstream D follow-up).
 *
 * Ubuntu 23.10+ disables unprivileged user namespaces via AppArmor, so
 * Chrome's sandbox cannot start there ("No usable sandbox!"). The GitHub
 * runner shows exactly that and aborts with SIGABRT, which broke the three
 * PDF assertions in CI.
 *
 * The Vercel branch of the quotation download route is separate: it launches
 * `@sparticuz/chromium.args` through `puppeteer.defaultArgs` with
 * `headless: 'shell'` (the documented serverless usage) and Chromium's
 * graphics mode disabled — so this helper covers local and CI launches only.
 * Windows/macOS keep Chrome's default sandbox.
 */
export function localPdfBrowserArgs(): string[] {
	// Containers have a small /dev/shm; Chrome needs this everywhere headless.
	const args = ['--disable-dev-shm-usage'];
	if (process.platform === 'linux') {
		args.push('--no-sandbox', '--disable-setuid-sandbox');
	}
	return args;
}
