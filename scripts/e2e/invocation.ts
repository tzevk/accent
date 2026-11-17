const LOCAL_RUN_REASON_FLAG = '--local-run-reason';
const REASON_EXAMPLE = `${LOCAL_RUN_REASON_FLAG} "browser-only failure investigation"`;

export class E2EUsageError extends Error {
	constructor(message: string) {
		super(`[e2e] ${message}`);
		this.name = 'E2EUsageError';
	}
}

export interface E2EInvocation {
	playwrightArgs: string[];
	localRunReason: string | null;
}

/**
 * Plans one `npm run test:e2e` invocation without touching the filesystem,
 * database, or process environment. Harness-owned flags are removed before
 * Playwright sees the arguments; every other argument keeps its order.
 *
 * Reason-free runs are authorized only inside GitHub Actions. A local
 * invocation must name an explicit reason, whether or not it opens the
 * Playwright UI.
 */
export function resolveE2EInvocation(
	args: readonly string[],
	env: Readonly<NodeJS.ProcessEnv>
): E2EInvocation {
	const playwrightArgs: string[] = [];
	let localRunReason: string | null = null;
	let reasonFlagSeen = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (
			arg !== LOCAL_RUN_REASON_FLAG &&
			!arg.startsWith(`${LOCAL_RUN_REASON_FLAG}=`)
		) {
			playwrightArgs.push(arg);
			continue;
		}

		if (reasonFlagSeen) {
			throw new E2EUsageError(
				'--local-run-reason may be supplied only once; remove the duplicate.'
			);
		}
		reasonFlagSeen = true;

		let value: string;
		if (arg === LOCAL_RUN_REASON_FLAG) {
			const next = args[index + 1];
			if (next === undefined || next.startsWith('-')) {
				throw new E2EUsageError(
					`--local-run-reason needs a value; use ${REASON_EXAMPLE}.`
				);
			}
			value = next;
			index += 1;
		} else {
			value = arg.slice(LOCAL_RUN_REASON_FLAG.length + 1);
		}

		const reason = value.trim();
		if (reason === '') {
			throw new E2EUsageError(
				`--local-run-reason needs a non-empty reason; use ${REASON_EXAMPLE}.`
			);
		}
		localRunReason = reason;
	}

	if (env.GITHUB_ACTIONS !== 'true' && localRunReason === null) {
		throw new E2EUsageError(
			[
				'Refusing a local E2E run without an explicit reason.',
				'Routine E2E runs in GitHub Actions; use focused Vitest suites for local verification.',
				'Explicitly authorized browser-only debugging may pass a reason:',
				`  npm run test:e2e -- ${REASON_EXAMPLE} --ui`,
			].join('\n')
		);
	}

	return { playwrightArgs, localRunReason };
}
