import type { BrowserContext } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import { createCollaborationPair } from '../fixtures/collaboration.ts';

// The owned Next dev server compiles `/messages` and the messages API on the
// first visit. Assertions still wait for their observable result. The overall
// budget only covers compilation and the two real sign-in flows; every
// individual action is bounded below so the first unresolved step reports its
// own locator or network error instead of consuming the whole test.
const OPERATION_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 60_000;
test.setTimeout(300_000);

interface StoredMessageRow extends RowDataPacket {
	id: number;
	sender_id: number | string;
	receiver_id: number | string | null;
	subject: string;
	body: string;
	conversation_id: number | string | null;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Actor: User A and User B, two ordinary disposable employees whose custom
 * roles grant no permissions. Each signs in through the real `/signin` form in
 * its own isolated browser context, so neither shares cookies or client state.
 *
 * Starting state: No message or direct conversation exists between the pair;
 * the only rows are the two identities.
 *
 * Action: A collapses the real desktop sidebar through its own control (the
 * expanded app sidebar overlays the messages folder pane and intercepts its
 * compose button), then composes a message to B through the `/messages`
 * recipient picker, subject and body fields, and sends it. B opens the unread
 * conversation, reads A's exact body, writes a reply, and sends it. A reloads
 * `/messages`, reopens the conversation, and reads the thread.
 *
 * Proof: After the reload A's thread shows B's exact reply as a message body
 * from B and A's original body as a message from A; an independent database
 * read shows exactly the two expected messages, senders, recipients, subjects
 * and bodies in the pair's direct conversation.
 */
test("A sends B a direct message and sees B's reply after reloading the conversation", async ({
	page,
	browser,
	db,
	namespace,
	runtime,
}) => {
	const pair = await createCollaborationPair(db, namespace);
	let recipientContext: BrowserContext | null = null;
	try {
		page.setDefaultTimeout(OPERATION_TIMEOUT_MS);
		page.setDefaultNavigationTimeout(60_000);
		page.setViewportSize({ width: 1440, height: 900 });

		recipientContext = await browser.newContext({
			baseURL: runtime.baseUrl,
			viewport: { width: 1440, height: 900 },
		});
		const recipientPage = await recipientContext.newPage();
		recipientPage.setDefaultTimeout(OPERATION_TIMEOUT_MS);
		recipientPage.setDefaultNavigationTimeout(60_000);

		await signInThroughUi(page, {
			username: pair.sender.username,
			password: pair.sender.password,
		});

		await page.goto('/messages');
		await expect(
			page.getByRole('main', { name: 'Messages', exact: true })
		).toBeVisible();

		// App boundary: the messages page still offsets itself for the old
		// pinned-sidebar selector, so at 1440px the expanded desktop sidebar
		// covers the folder pane and intercepts the compose button. Collapse
		// the real desktop sidebar through its own control; the mobile sheet
		// is not mounted at this viewport.
		const desktopSidebar = page.locator(
			'[data-slot="sidebar"][data-side="left"]'
		);
		const sidebarToggle = desktopSidebar
			.locator('[data-slot="sidebar-header"]')
			.getByRole('button', { name: 'Toggle Sidebar', exact: true });
		await expect(sidebarToggle).toBeVisible();
		await sidebarToggle.click();
		await expect(desktopSidebar).toHaveAttribute('data-state', 'collapsed');

		await page
			.getByRole('button', { name: 'Compose new message', exact: true })
			.click();
		// App boundary: focusing the recipient field seeds it with a leading
		// space. Typing on top would filter for " <username>" and match nobody,
		// so clear the seeded text first, as a user selecting all would.
		const recipientSearch = page.getByLabel('Search for recipients', {
			exact: true,
		});
		await recipientSearch.click();
		await recipientSearch.selectText();
		await recipientSearch.pressSequentially(pair.recipient.username);
		await expect(recipientSearch).toHaveValue(pair.recipient.username);

		const availableRecipients = page.getByRole('listbox', {
			name: 'Available recipients',
		});
		await expect(availableRecipients).toBeVisible();
		await availableRecipients
			.getByRole('option', {
				name: new RegExp(escapeRegExp(pair.recipient.username), 'i'),
			})
			.click();
		await expect(
			page.getByLabel('Selected recipients', { exact: true })
		).toContainText(pair.recipient.username);

		await page.getByLabel('Subject', { exact: true }).fill(pair.subject);
		await page
			.getByLabel('Message body', { exact: true })
			.fill(pair.senderBody);

		const [sendResponse] = await Promise.all([
			page.waitForResponse(
				(response) =>
					response.request().method() === 'POST' &&
					new URL(response.url()).pathname === '/api/messages',
				{ timeout: RESPONSE_TIMEOUT_MS }
			),
			page.getByRole('button', { name: 'Send message', exact: true }).click(),
		]);
		expect(sendResponse.ok()).toBe(true);

		await signInThroughUi(recipientPage, {
			username: pair.recipient.username,
			password: pair.recipient.password,
		});
		await recipientPage.goto('/messages');
		const recipientConversation = recipientPage.getByRole('option', {
			name: new RegExp(escapeRegExp(pair.subject)),
		});
		await expect(recipientConversation).toBeVisible();
		await recipientConversation.click();

		await expect(
			recipientPage.getByRole('article', {
				name: `Message body from ${pair.sender.username}`,
			})
		).toContainText(pair.senderBody);

		await recipientPage
			.getByRole('textbox', { name: /Reply message body/ })
			.fill(pair.replyBody);
		const [replyResponse] = await Promise.all([
			recipientPage.waitForResponse(
				(response) =>
					response.request().method() === 'POST' &&
					new URL(response.url()).pathname === '/api/messages',
				{ timeout: RESPONSE_TIMEOUT_MS }
			),
			recipientPage
				.getByRole('button', { name: 'Send reply', exact: true })
				.click(),
		]);
		expect(replyResponse.ok()).toBe(true);
		await expect(
			recipientPage.getByRole('article', { name: 'Message body from you' })
		).toContainText(pair.replyBody);

		await page.reload();
		const senderConversation = page.getByRole('option', {
			name: new RegExp(escapeRegExp(pair.subject)),
		});
		await expect(senderConversation).toBeVisible();
		await senderConversation.click();

		await expect(
			page.getByRole('article', {
				name: `Message body from ${pair.recipient.username}`,
			})
		).toContainText(pair.replyBody);
		await expect(
			page.getByRole('article', { name: 'Message body from you' })
		).toContainText(pair.senderBody);

		const [messages] = await db.execute<StoredMessageRow[]>(
			`SELECT m.id,
              m.sender_id,
              m.receiver_id,
              m.subject,
              m.body,
              m.conversation_id
         FROM messages m
         JOIN conversation_members cm_sender
           ON cm_sender.conversation_id = m.conversation_id
          AND cm_sender.user_id = ?
         JOIN conversation_members cm_recipient
           ON cm_recipient.conversation_id = m.conversation_id
          AND cm_recipient.user_id = ?
        WHERE (m.sender_id = ? AND m.receiver_id = ?)
           OR (m.sender_id = ? AND m.receiver_id = ?)
        ORDER BY m.id ASC`,
			[
				pair.sender.userId,
				pair.recipient.userId,
				pair.sender.userId,
				pair.recipient.userId,
				pair.recipient.userId,
				pair.sender.userId,
			]
		);

		expect(
			messages.map((message) => ({
				sender_id: Number(message.sender_id),
				receiver_id: Number(message.receiver_id),
				subject: message.subject,
				body: message.body,
			}))
		).toEqual([
			{
				sender_id: pair.sender.userId,
				receiver_id: pair.recipient.userId,
				subject: pair.subject,
				body: pair.senderBody,
			},
			{
				sender_id: pair.recipient.userId,
				receiver_id: pair.sender.userId,
				subject: `Re: ${pair.subject}`,
				body: pair.replyBody,
			},
		]);
	} finally {
		// The disposable database is thrown away with the group, so cleanup is
		// best-effort. A teardown error must never replace the failure that
		// actually stopped the journey (or make a passing journey look broken).
		if (recipientContext !== null) {
			try {
				await recipientContext.close();
			} catch (error) {
				console.error('[messages] recipient context cleanup failed:', error);
			}
		}
		try {
			await pair.dispose();
		} catch (error) {
			console.error('[messages] collaboration pair cleanup failed:', error);
		}
	}
});
