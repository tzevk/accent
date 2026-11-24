import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import { createCollaborationPair } from '../fixtures/collaboration.ts';

// The owned Next dev server may compile each path on first use. Keep the
// sign-in actions and direct requests bounded so a failure names its step.
const OPERATION_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 60_000;
test.setTimeout(300_000);

/**
 * Actor: One ordinary disposable employee signs in through the real
 * `/signin` form. A second disposable employee provides a valid recipient.
 *
 * Starting state: Both identities exist and no direct conversation or
 * message exists between them.
 *
 * Action: The authenticated client directly requests the removed Messages
 * page, unread count, send endpoint, and nested attachment endpoint.
 *
 * Proof: Every removed route returns HTTP 404 instead of exposing the old
 * messaging workflow.
 */
test('disabled Messages routes return 404 for an authenticated employee', async ({
	page,
	db,
	namespace,
}) => {
	const pair = await createCollaborationPair(db, namespace);
	try {
		page.setDefaultTimeout(OPERATION_TIMEOUT_MS);
		page.setDefaultNavigationTimeout(RESPONSE_TIMEOUT_MS);

		await signInThroughUi(page, {
			username: pair.sender.username,
			password: pair.sender.password,
		});

		const [messagesPage, unreadCount, sendMessage, attachment] =
			await Promise.all([
				page.request.get('/messages', { timeout: RESPONSE_TIMEOUT_MS }),
				page.request.get('/api/messages/unread-count', {
					timeout: RESPONSE_TIMEOUT_MS,
				}),
				page.request.post('/api/messages', {
					data: {
						receiver_id: pair.recipient.userId,
						subject: pair.subject,
						body: pair.senderBody,
					},
					timeout: RESPONSE_TIMEOUT_MS,
				}),
				page.request.get('/api/messages/attachments/1', {
					timeout: RESPONSE_TIMEOUT_MS,
				}),
			]);

		expect(messagesPage.status(), 'GET /messages').toBe(404);
		expect(unreadCount.status(), 'GET /api/messages/unread-count').toBe(404);
		expect(sendMessage.status(), 'POST /api/messages').toBe(404);
		expect(attachment.status(), 'GET /api/messages/attachments/1').toBe(404);
	} finally {
		await pair.dispose();
	}
});
