import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as idGET, DELETE as idDELETE } from '@/app/api/tickets/[id]/route';
import { POST, PUT } from '@/app/api/tickets/route';

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	beginTransaction: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	release: vi.fn(),
	dbConnect: vi.fn(),
	getServerAuth: vi.fn(),
	listTicketDepartments: vi.fn(),
	canHandleTicket: vi.fn(),
	enqueueTicketEmails: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.dbConnect }));
vi.mock('@/utils/server-auth', () => ({
	getServerAuth: mocks.getServerAuth,
}));
vi.mock('@/lib/tickets/departments', () => ({
	listTicketDepartments: mocks.listTicketDepartments,
	canHandleTicket: mocks.canHandleTicket,
}));
vi.mock('@/lib/tickets/email-outbox', () => ({
	enqueueTicketEmails: mocks.enqueueTicketEmails,
}));

type CreateRequestOpts = { url?: string; method?: string; body?: unknown };
type MockRequest = {
	url: string;
	method: string;
	headers: Headers;
	json?: () => Promise<unknown>;
};

function createRequest(opts: CreateRequestOpts = {}) {
	const req: MockRequest = {
		url: opts.url || 'http://localhost/api/tickets/1',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

function authUser(overrides: Record<string, unknown> = {}) {
	mocks.getServerAuth.mockResolvedValue({
		user: {
			id: 1,
			is_super_admin: false,
			full_name: 'Employee',
			username: 'employee',
			...overrides,
		},
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.dbConnect.mockResolvedValue({
		execute: mocks.execute,
		beginTransaction: mocks.beginTransaction,
		commit: mocks.commit,
		rollback: mocks.rollback,
		release: mocks.release,
	});
	mocks.beginTransaction.mockResolvedValue(undefined);
	mocks.commit.mockResolvedValue(undefined);
	mocks.rollback.mockResolvedValue(undefined);
	mocks.listTicketDepartments.mockResolvedValue([
		{
			id: 5,
			name: 'IT',
			role_id: 3,
			role_name: 'IT Support',
			is_active: true,
			handler_count: 2,
		},
	]);
	mocks.canHandleTicket.mockResolvedValue(false);
	mocks.enqueueTicketEmails.mockResolvedValue(undefined);
});

describe('Tickets — ticket routing and access', () => {
	it('rejects a new ticket without a responsible department before touching the database', async () => {
		authUser();

		const response = await POST(
			createRequest({
				method: 'POST',
				body: {
					subject: 'Cannot access report',
					description: 'The report page is unavailable.',
				},
			})
		);
		const json = await response.json();

		expect(response.status).toBe(400);
		expect(json.success).toBe(false);
		expect(mocks.dbConnect).not.toHaveBeenCalled();
		expect(mocks.execute).not.toHaveBeenCalled();
	});

	it('rejects a department that is not selectable without saving a ticket', async () => {
		authUser();
		mocks.listTicketDepartments.mockResolvedValue([]);

		const response = await POST(
			createRequest({
				method: 'POST',
				body: {
					subject: 'Cannot access report',
					description: 'The report page is unavailable.',
					ticket_department_id: 9,
				},
			})
		);
		const json = await response.json();

		expect(response.status).toBe(400);
		expect(json.success).toBe(false);
		expect(mocks.commit).not.toHaveBeenCalled();
		expect(mocks.rollback).toHaveBeenCalled();
		expect(mocks.enqueueTicketEmails).not.toHaveBeenCalled();
	});

	it('creates the ticket and its alert jobs in one transaction', async () => {
		authUser();
		mocks.execute.mockImplementation((sql: string) => {
			if (sql.includes('SELECT ticket_number FROM support_tickets')) {
				return Promise.resolve([[{ ticket_number: 'TKT-202611-0007' }]]);
			}
			if (sql.includes('INSERT INTO support_tickets')) {
				return Promise.resolve([{ insertId: 42 }]);
			}
			if (sql.includes('FROM support_tickets t')) {
				return Promise.resolve([
					[
						{
							id: 42,
							ticket_number: 'TKT-202611-0008',
							ticket_department_id: 5,
						},
					],
				]);
			}
			return Promise.resolve([[]]);
		});

		const response = await POST(
			createRequest({
				method: 'POST',
				body: {
					subject: 'Cannot access report',
					description: 'The report page is unavailable.',
					priority: 'critical',
					ticket_department_id: 5,
				},
			})
		);
		const json = await response.json();

		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
		expect(json.data.id).toBe(42);
		expect(mocks.commit).toHaveBeenCalledTimes(1);
		expect(mocks.enqueueTicketEmails).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				ticketId: 42,
				departmentId: 5,
				assignmentVersion: 1,
				eventType: 'created',
				ticketNumber: 'TKT-202611-0008',
				priority: 'critical',
			})
		);
	});

	it('does not report success when the alert jobs cannot be queued', async () => {
		authUser();
		mocks.execute.mockImplementation((sql: string) => {
			if (sql.includes('SELECT ticket_number FROM support_tickets')) {
				return Promise.resolve([[{ ticket_number: 'TKT-202611-0007' }]]);
			}
			if (sql.includes('INSERT INTO support_tickets')) {
				return Promise.resolve([{ insertId: 42 }]);
			}
			return Promise.resolve([[]]);
		});
		mocks.enqueueTicketEmails.mockRejectedValue(
			new Error('No eligible recipients for the department')
		);

		const response = await POST(
			createRequest({
				method: 'POST',
				body: {
					subject: 'Cannot access report',
					description: 'The report page is unavailable.',
					ticket_department_id: 5,
				},
			})
		);
		const json = await response.json();

		expect(response.status).toBe(500);
		expect(json.success).toBe(false);
		expect(mocks.commit).not.toHaveBeenCalled();
		expect(mocks.rollback).toHaveBeenCalled();
	});

	it('forbids a non-super-admin from forging a routing change', async () => {
		authUser({ id: 2 });
		mocks.canHandleTicket.mockResolvedValue(true);
		mocks.execute.mockImplementation((sql: string) => {
			if (sql.includes('FROM support_tickets')) {
				return Promise.resolve([
					[
						{
							id: 1,
							user_id: 9,
							status: 'open',
							priority: 'medium',
							ticket_department_id: 5,
							assignment_version: 1,
							ticket_number: 'TKT-202611-0001',
						},
					],
				]);
			}
			return Promise.resolve([[]]);
		});

		const response = await PUT(
			createRequest({
				method: 'PUT',
				body: { id: 1, ticket_department_id: 6 },
			})
		);
		const json = await response.json();

		expect(response.status).toBe(403);
		expect(json.success).toBe(false);
		expect(mocks.listTicketDepartments).not.toHaveBeenCalled();
		expect(mocks.enqueueTicketEmails).not.toHaveBeenCalled();
		expect(mocks.commit).not.toHaveBeenCalled();
	});

	it('allows a current handler to update the persisted status', async () => {
		authUser({ id: 2 });
		mocks.canHandleTicket.mockResolvedValue(true);
		mocks.execute.mockImplementation((sql: string) => {
			if (sql.includes('FROM support_tickets t')) {
				return Promise.resolve([
					[
						{
							id: 1,
							user_id: 9,
							status: 'resolved',
							ticket_department_id: 5,
						},
					],
				]);
			}
			if (sql.includes('FROM support_tickets')) {
				return Promise.resolve([
					[
						{
							id: 1,
							user_id: 9,
							status: 'pending_info',
							ticket_department_id: 5,
						},
					],
				]);
			}
			return Promise.resolve([{ affectedRows: 1 }]);
		});

		const response = await PUT(
			createRequest({
				method: 'PUT',
				body: { id: 1, status: 'resolved' },
			})
		);
		const json = await response.json();

		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
		expect(json.data.status).toBe('resolved');
		expect(mocks.commit).toHaveBeenCalledTimes(1);
	});

	it('lets an owner delete their own unassigned legacy open ticket', async () => {
		authUser();
		mocks.execute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE support_tickets SET isDelete = 1')) {
				return Promise.resolve([{ affectedRows: 1 }]);
			}
			return Promise.resolve([
				[
					{
						id: 1,
						user_id: 1,
						status: 'open',
						assigned_to: null,
						ticket_department_id: null,
					},
				],
			]);
		});

		const response = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await response.json();

		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
	});

	it('forbids an owner from deleting a ticket routed to a department', async () => {
		authUser();
		mocks.execute.mockResolvedValue([
			[
				{
					id: 1,
					user_id: 1,
					status: 'open',
					assigned_to: null,
					ticket_department_id: 5,
				},
			],
		]);

		const response = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await response.json();

		expect(response.status).toBe(403);
		expect(json.success).toBe(false);
	});

	it('returns empty attachments for malformed comment JSON and exposes capabilities', async () => {
		authUser();
		mocks.execute.mockImplementation((sql: string) => {
			if (sql.includes('ticket_comments')) {
				return Promise.resolve([
					[
						{ id: 1, attachments: '' },
						{ id: 2, attachments: 'not-json' },
						{ id: 3, attachments: '["file.pdf"]' },
					],
				]);
			}
			return Promise.resolve([
				[
					{
						id: 4,
						user_id: 1,
						title: 'Cannot access report',
						ticket_department_id: 5,
					},
				],
			]);
		});

		const response = await idGET(createRequest(), {
			params: Promise.resolve({ id: '4' }),
		});

		const json = await response.json();
		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
		expect(json.data.can_update_status).toBe(true);
		expect(json.data.can_reassign).toBe(false);
		expect(json.data.can_handle).toBe(false);
		expect(json.data.comments).toEqual([
			{ id: 1, attachments: [] },
			{ id: 2, attachments: [] },
			{ id: 3, attachments: ['file.pdf'] },
		]);
	});
});
