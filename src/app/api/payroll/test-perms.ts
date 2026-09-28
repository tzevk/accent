import { NextResponse } from 'next/server';

type PermissionMock = { mockImplementation: (impl: unknown) => unknown };

/**
 * Shared fake permission gate mirroring the real `ensurePermission`
 * contract: authorized object when the caller holds `resource:permission`,
 * otherwise a 403 Response. Use per test file as
 * `const grant = grantFor(mocks.mockEnsurePermission);` then
 * `grant('payroll:read')` to pin which resource the route consults.
 */
export const grantFor =
	(mock: PermissionMock) =>
	(...keys: string[]): void => {
		void mock.mockImplementation(
			async (request: Request, resource: string, permission: string) =>
				keys.includes(`${resource}:${permission}`)
					? { authorized: true, response: null }
					: NextResponse.json(
							{ success: false, error: 'Forbidden: missing permission' },
							{ status: 403 }
						)
		);
	};
