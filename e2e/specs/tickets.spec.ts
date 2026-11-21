import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import {
	deleteSupportTickets,
	deleteTicketDepartment,
	findSupportTicketIds,
	readUserRoleId,
	seedSupportTicket,
	seedTicketDepartment,
	type StoredSupportTicketRow,
	type StoredTicketCommentRow,
	type SupportTicketFixture,
	type TicketDepartmentFixture,
} from '../fixtures/service-workflows.ts';

interface CreateTicketBody {
	success: boolean;
	data: { id: number };
}

interface MutationResultBody {
	success: boolean;
}

// The owned dev server compiles the ticket list/new/detail routes on first
// visit. The assertions still wait for their visible result; this only bounds
// that compile time.
test.setTimeout(180_000);

/**
 * Actor: an ordinary signed-in employee whose custom role grants no extra
 * permissions; submitting a ticket needs only the account, not a module grant.
 *
 * Starting state: one active ticket department mapped to the employee's own
 * role, so the real department picker lists one eligible recipient and there
 * is no external mail delivery in the test.
 *
 * Action: open Support Tickets, choose New Ticket, select that department,
 * author a namespaced subject and description, choose High priority, submit,
 * then reload the detail page.
 *
 * Proof: the detail heading shows the authored subject, the description is
 * present, the High badge is visible, and a database read of the
 * server-allocated ticket matches subject, description, priority, status,
 * owner and department after the reload.
 */
test('requester submits a support ticket and sees the authored subject and detail after reload', async ({
	page,
	db,
	namespace,
}) => {
	const subject = `${namespace} shared drive is unavailable`;
	const description = `${namespace} detail: the finance shared drive rejects every laptop sign-in.`;
	const user = await createJourneyUser(db, `${namespace}-ticket-create`, []);
	let department: TicketDepartmentFixture | null = null;
	let createdTicketId: number | null = null;

	try {
		page.setDefaultNavigationTimeout(60_000);
		const roleId = await readUserRoleId(db, user.userId);
		department = await seedTicketDepartment(
			db,
			namespace,
			roleId,
			'create routing'
		);

		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});

		await page.goto('/tickets');
		await expect(
			page.getByRole('heading', { name: 'Support Tickets', exact: true })
		).toBeVisible();
		// The header and the empty state both offer New Ticket; the header
		// action comes first in the document.
		await page
			.getByRole('button', { name: 'New Ticket', exact: true })
			.first()
			.click();
		await page.waitForURL(/\/tickets\/new$/);
		await expect(
			page.getByRole('heading', {
				name: 'New Support Ticket',
				exact: true,
			})
		).toBeVisible();

		const departmentSelect = page.getByLabel('Responsible department', {
			exact: true,
		});
		await expect(departmentSelect).toBeEnabled();
		await departmentSelect.selectOption({ label: department.name });
		await page.getByLabel('Subject', { exact: true }).fill(subject);
		await page.getByLabel('Description', { exact: true }).fill(description);
		await page.getByRole('button', { name: 'High', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'High', exact: true })
		).toHaveAttribute('aria-pressed', 'true');

		const createResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/tickets'
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByRole('button', { name: 'Submit Ticket', exact: true })
			.click();
		const response = await createResponse;
		expect(response.ok()).toBe(true);
		const body = (await response.json()) as CreateTicketBody;
		expect(body.success).toBe(true);
		createdTicketId = body.data.id;

		await page.waitForURL(new RegExp(`/tickets/${createdTicketId}$`));
		const header = page
			.getByRole('heading', { name: subject, exact: true })
			.locator('..');
		await expect(
			page.getByRole('heading', { name: subject, exact: true })
		).toBeVisible();
		await expect(page.getByText(description, { exact: true })).toBeVisible();
		await expect(header.getByText('High', { exact: true })).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: subject, exact: true })
		).toBeVisible();
		await expect(page.getByText(description, { exact: true })).toBeVisible();
		await expect(header.getByText('High', { exact: true })).toBeVisible();

		const [rows] = await db.execute<StoredSupportTicketRow[]>(
			'SELECT * FROM support_tickets WHERE id = ?',
			[createdTicketId]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			ticket_number: expect.any(String),
			user_id: user.userId,
			title: subject,
			description,
			priority: 'high',
			status: 'open',
			ticket_department_id: department.id,
			isDelete: 0,
		});
	} finally {
		try {
			const ticketIds =
				createdTicketId === null
					? await findSupportTicketIds(db, user.userId, subject)
					: [createdTicketId];
			await deleteSupportTickets(db, ticketIds);
			if (department !== null) {
				await deleteTicketDepartment(db, department.id);
			}
		} finally {
			await user.dispose();
		}
	}
});

/**
 * Actor: the ordinary employee who submitted the seeded ticket (custom role
 * with no extra permissions).
 *
 * Starting state: one live open ticket owned by that employee, with no
 * comments.
 *
 * Action: open the ticket from its detail URL, write a reply in the real Reply
 * form, send it, then reload the ticket.
 *
 * Proof: the reply is visible after the reload with the comment count moved to
 * one, and an independent database read shows exactly one stored comment
 * authored by that employee with the same text.
 */
test('requester replies to a seeded ticket and the comment survives reload', async ({
	page,
	db,
	namespace,
}) => {
	const subject = `${namespace} payroll portal access`;
	const description = `${namespace} detail: the payroll portal rejects the saved password.`;
	const reply = `${namespace} reply: I retried after resetting the password and can sign in now.`;
	const user = await createJourneyUser(db, `${namespace}-ticket-reply`, []);
	let ticket: SupportTicketFixture | null = null;

	try {
		page.setDefaultNavigationTimeout(60_000);
		ticket = await seedSupportTicket(db, {
			namespace,
			requesterUserId: user.userId,
			departmentId: null,
			subject,
			description,
			status: 'open',
			suffix: 'reply',
		});

		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});
		await page.goto(`/tickets/${ticket.id}`);
		await expect(
			page.getByRole('heading', { name: subject, exact: true })
		).toBeVisible();
		await expect(page.getByText(description, { exact: true })).toBeVisible();
		await expect(page.getByText('Comments (0)', { exact: true })).toBeVisible();

		await page.getByLabel('Reply', { exact: true }).fill(reply);
		const replyResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === `/api/tickets/${ticket?.id}`
				);
			},
			{ timeout: 60_000 }
		);
		await page.getByRole('button', { name: 'Send Reply', exact: true }).click();
		const response = await replyResponse;
		expect(response.ok()).toBe(true);
		const replyBody = (await response.json()) as MutationResultBody;
		expect(replyBody.success).toBe(true);

		await expect(page.getByText(reply, { exact: true })).toBeVisible();
		await expect(page.getByText('Comments (1)', { exact: true })).toBeVisible();

		await page.reload();
		await expect(page.getByText(reply, { exact: true })).toBeVisible();
		await expect(page.getByText('Comments (1)', { exact: true })).toBeVisible();

		const [comments] = await db.execute<StoredTicketCommentRow[]>(
			'SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY id ASC',
			[ticket.id]
		);
		expect(comments).toHaveLength(1);
		expect(comments[0]).toMatchObject({
			ticket_id: ticket.id,
			user_id: user.userId,
			comment: reply,
			is_internal: 0,
		});
	} finally {
		try {
			const ticketIds =
				ticket === null
					? await findSupportTicketIds(db, user.userId, subject)
					: [ticket.id];
			await deleteSupportTickets(db, ticketIds);
		} finally {
			await user.dispose();
		}
	}
});

/**
 * Actor: an ordinary signed-in employee whose custom role is the responsible
 * role for the seeded department; no permission grant is involved because
 * handling is derived from the fresh role/department membership.
 *
 * Starting state: a department mapped to the handler's custom role and a
 * separate routed ticket owned by a different fixture employee, currently New
 * (open).
 *
 * Action: open that routed ticket, choose In Progress in the Update status
 * form, save it, then reload the ticket.
 *
 * Proof: after reload the header badge and status control read In Progress,
 * and an independent database read shows the same ticket moved from open to
 * in_progress while its owner and department are unchanged.
 */
test('responsible-role handler moves a separately seeded routed ticket to in progress', async ({
	page,
	db,
	namespace,
}) => {
	const subject = `${namespace} handler needs an update`;
	const description = `${namespace} detail: this ticket was routed before the browser started.`;
	const handler = await createJourneyUser(
		db,
		`${namespace}-ticket-handler`,
		[]
	);
	let requester: JourneyUser | null = null;
	let department: TicketDepartmentFixture | null = null;
	let ticket: SupportTicketFixture | null = null;

	try {
		requester = await createJourneyUser(db, `${namespace}-ticket-owner`, []);
		page.setDefaultNavigationTimeout(60_000);
		const roleId = await readUserRoleId(db, handler.userId);
		department = await seedTicketDepartment(
			db,
			namespace,
			roleId,
			'handler routing'
		);
		ticket = await seedSupportTicket(db, {
			namespace,
			requesterUserId: requester.userId,
			departmentId: department.id,
			subject,
			description,
			status: 'open',
			suffix: 'handler',
		});

		await signInThroughUi(page, {
			username: handler.username,
			password: handler.password,
		});
		await page.goto(`/tickets/${ticket.id}`);
		const header = page
			.getByRole('heading', { name: subject, exact: true })
			.locator('..');
		await expect(header).toContainText(subject);
		await expect(
			page.getByRole('heading', { name: 'Update status', exact: true })
		).toBeVisible();
		await expect(header.getByText('New', { exact: true })).toBeVisible();

		const statusSelect = page.getByLabel('Status', { exact: true });
		await expect(statusSelect).toHaveValue('open');
		await statusSelect.selectOption('in_progress');
		const updateResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'PUT' &&
					url.pathname === '/api/tickets'
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByRole('button', { name: 'Save status', exact: true })
			.click();
		const response = await updateResponse;
		expect(response.ok()).toBe(true);
		const updateBody = (await response.json()) as MutationResultBody;
		expect(updateBody.success).toBe(true);

		await expect(
			page.getByText('Status updated.', { exact: true })
		).toBeVisible();
		await expect(
			header.getByText('In Progress', { exact: true })
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: subject, exact: true })
		).toBeVisible();
		await expect(statusSelect).toHaveValue('in_progress');
		await expect(
			header.getByText('In Progress', { exact: true })
		).toBeVisible();

		const [rows] = await db.execute<StoredSupportTicketRow[]>(
			'SELECT * FROM support_tickets WHERE id = ?',
			[ticket.id]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			user_id: requester.userId,
			title: subject,
			status: 'in_progress',
			ticket_department_id: department.id,
			isDelete: 0,
		});
	} finally {
		try {
			if (requester !== null) {
				const ticketIds =
					ticket === null
						? await findSupportTicketIds(db, requester.userId, subject)
						: [ticket.id];
				await deleteSupportTickets(db, ticketIds);
			}
			if (department !== null) {
				await deleteTicketDepartment(db, department.id);
			}
		} finally {
			try {
				if (requester !== null) {
					await requester.dispose();
				}
			} finally {
				await handler.dispose();
			}
		}
	}
});
