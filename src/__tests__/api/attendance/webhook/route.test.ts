import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DB BEFORE dynamic import (Vitest hoists mocks).
const mockExecute = vi.fn();
vi.mock('@/utils/database', () => ({
	withDb: vi.fn((fn) => fn({ execute: mockExecute })),
	query: vi.fn(),
	dbConnect: vi.fn(),
}));

const { POST } = await import('@/app/api/attendance/webhook/route');

const SECRET = 'test-webhook-secret';

function post(body: unknown, auth = `Bearer ${SECRET}`): Promise<Response> {
	return POST(
		new Request('http://localhost/api/attendance/webhook', {
			method: 'POST',
			headers: auth ? { authorization: auth } : {},
			body: typeof body === 'string' ? body : JSON.stringify(body),
		})
	);
}

function mockLookup(rows: Array<{ id: number; smartoffice_code: string }>) {
	// db.execute resolves [rows, fields]; rows is the array of row objects.
	mockExecute.mockResolvedValueOnce([rows, undefined]);
}

function mockInsert(affectedRows = 1, insertId = 15) {
	mockExecute.mockResolvedValueOnce([{ affectedRows, insertId }, undefined]);
}

describe('attendance webhook auth', () => {
	beforeEach(() => {
		vi.stubEnv('SMARTOFFICE_WEBHOOK_SECRET', SECRET);
		mockExecute.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects requests without an Authorization header', async () => {
		const res = await post({ employeeCode: '114' }, '');
		expect(res.status).toBe(401);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('rejects requests with a wrong secret', async () => {
		const res = await post({ employeeCode: '114' }, 'Bearer wrong-secret');
		expect(res.status).toBe(401);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('rejects when the secret is not configured server-side', async () => {
		vi.stubEnv('SMARTOFFICE_WEBHOOK_SECRET', '');
		const res = await post({ employeeCode: '114' });
		expect(res.status).toBe(500);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('attendance webhook ingestion', () => {
	beforeEach(() => {
		vi.stubEnv('SMARTOFFICE_WEBHOOK_SECRET', SECRET);
		mockExecute.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('stores a single-object payload and maps the employee', async () => {
		mockLookup([{ id: 26, smartoffice_code: '114' }]);
		mockInsert(1);

		const res = await post({
			employeeCode: '114',
			logDate: '2026-08-12 09:15:29',
			serialNumber: '84E0F42938231501',
			direction: ' ',
			deviceId: 'some-device',
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({ success: true, inserted: 1, skipped: 0 });
		expect(json.unmatchedCodes).toEqual([]);

		// Lookup query first, then the insert.
		const [sql, params] = mockExecute.mock.calls[1];
		expect(sql).toContain('INSERT INTO attendance_logs');
		expect(params).toEqual([
			'114',
			'2026-08-12 09:15:29',
			'84E0F42938231501',
			null, // blank direction normalized via resolveDirection
			JSON.stringify({
				employeeCode: '114',
				logDate: '2026-08-12 09:15:29',
				serialNumber: '84E0F42938231501',
				direction: ' ',
				deviceId: 'some-device',
			}),
			26,
		]);
	});

	it('stores every punch in an array body', async () => {
		mockLookup([
			{ id: 26, smartoffice_code: '114' },
			{ id: 27, smartoffice_code: '102' },
		]);
		mockInsert(1);
		mockInsert(1);

		const res = await post([
			{
				employeeCode: '114',
				logDate: '2026-08-12 08:48:05',
				serialNumber: '84E0F42938231501',
			},
			{
				employeeCode: '102',
				logDate: '2026-08-12 09:15:29',
				serialNumber: '84E0F42938231501',
			},
		]);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({ success: true, inserted: 2, skipped: 0 });
		expect(mockExecute).toHaveBeenCalledTimes(3); // 1 lookup + 2 inserts
	});

	it('keeps punches with an unknown employeeCode as unmapped', async () => {
		mockLookup([]); // no employee has smartoffice_code '168324'
		mockInsert(1);

		const res = await post({
			employeeCode: '168324',
			logDate: '2026-08-12 10:05:00',
			serialNumber: 'AA00000000000002',
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.inserted).toBe(1);
		expect(json.unmatchedCodes).toEqual(['168324']);

		const [sql, params] = mockExecute.mock.calls[1];
		expect(sql).toContain('INSERT INTO attendance_logs');
		expect(params[5]).toBeNull(); // employee_id stays NULL
	});

	it('is idempotent for a duplicate punch (no-op on conflict)', async () => {
		const body = {
			employeeCode: '114',
			logDate: '2026-08-12 09:15:29',
			serialNumber: '84E0F42938231501',
		};
		mockLookup([{ id: 26, smartoffice_code: '114' }]);
		mockInsert(1); // first push inserts
		const first = await post(body);
		expect((await first.json()).inserted).toBe(1);

		mockLookup([{ id: 26, smartoffice_code: '114' }]);
		mockInsert(1, 0); // MariaDB: unchanged duplicate = affectedRows 1, insertId 0
		const second = await post(body);
		const json = await second.json();
		expect(json.success).toBe(true);
		expect(json.inserted).toBe(0);
	});

	it('normalizes a device-provided direction for storage', async () => {
		mockLookup([{ id: 26, smartoffice_code: '114' }]);
		mockInsert(1);

		await post({
			employeeCode: '114',
			logDate: '2026-08-12 17:30:00',
			serialNumber: '84E0F42938231501',
			direction: 'Out',
		});
		const [sql, params] = mockExecute.mock.calls[1];
		expect(sql).toContain('INSERT INTO attendance_logs');
		expect(params[3]).toBe('out');
	});
});

describe('attendance webhook defensive parsing', () => {
	beforeEach(() => {
		vi.stubEnv('SMARTOFFICE_WEBHOOK_SECRET', SECRET);
		mockExecute.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns a fast 200 for a malformed JSON body without DB work', async () => {
		const res = await post('this is not json');
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({ success: false, error: 'Invalid JSON body' });
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns a fast 200 for an empty body', async () => {
		const res = await post('');
		expect(res.status).toBe(200);
		expect((await res.json()).success).toBe(false);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('skips records missing required fields and stores the rest', async () => {
		mockLookup([{ id: 26, smartoffice_code: '114' }]);
		mockInsert(1);

		const res = await post([
			{
				employeeCode: '114',
				logDate: '2026-08-12 09:15:29',
				serialNumber: '84E0F42938231501',
			},
			{ employeeCode: '114' }, // missing logDate + serialNumber
			'garbage',
		]);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({ success: true, inserted: 1, skipped: 2 });
		expect(mockExecute).toHaveBeenCalledTimes(2); // 1 lookup + 1 insert
	});

	it('skips everything when no record is valid', async () => {
		const res = await post({ employeeCode: '114' });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({ success: true, inserted: 0, skipped: 1 });
		expect(mockExecute).not.toHaveBeenCalled();
	});
});
