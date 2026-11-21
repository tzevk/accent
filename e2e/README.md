# Browser journeys

A spec proves something a person can do and verify afterward. It is not a list of pages to visit.

Name four things next to each test:

- **Actor:** The signed-in role and the permissions this workflow needs, or an anonymous visitor.
- **Starting state:** What already exists in this test's fixture.
- **Action:** What the person does in the browser.
- **Proof:** What the person can see afterward that would be wrong if the workflow broke.

Keep dependent steps together. Saving a quotation and reopening it are one journey because the proof concerns that save. A read-only view and an unsaved-change warning can start from their own fixtures and fail independently.

## Test at the right layer

Use role, label, text, or an explicit test ID. Use Playwright assertions that wait for the visible result. Avoid sleeps, CSS styling selectors, forced clicks, and first-party API mocks. Seed prerequisites outside the browser, but do the action under test in the browser. For financial or persistence outcomes, check the visible result after a fresh read and inspect the saved rows independently.

Keep rounding combinations in unit tests, authorization decisions at the API, and race conditions against MariaDB. A browser test can still cover one representative permission outcome when the visible response matters. Use isolated data and ordinary test accounts. Do not use operational data or bypass authentication.

See [Playwright best practices](https://playwright.dev/docs/best-practices), [the TodoMVC examples](https://github.com/microsoft/playwright/tree/main/examples/todomvc), and [Accent verification rules](../CODING_STANDARDS.md#testing-and-verification).

## Runtime

GitHub Actions owns routine browser verification. `npm run test:e2e` covers the maintained suite through the owned runtime. See [local database operations](../docs/agents/local-database.md#authorized-local-debugging) for approved focused debugging.

For a full run, register each spec exactly once in [`groups.ts`](../scripts/e2e/groups.ts). A group uses a fresh disposable database and app server. Count the signed-out requests to the auth endpoint across its tests. Four planned attempts leave room for a retry of each test and the harness's startup login. Keep the real rate limiter enabled.

The CI artifact contains a separate HTML report and failure traces for each group under `e2e/artifacts/groups/`. A focused local run keeps the existing `npm run test:e2e:report` path.

## Maintained outcomes

| Spec                                                         | Visible proof                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Session](specs/session.spec.ts)                             | A user signs in and sees the employee dashboard. Signed-out reentry returns to sign-in, and an employee without admin access returns to their own dashboard. |
| [Quotation](specs/quotation.spec.ts)                         | The creator reopens the saved quotation from the register and sees the same client, scope line, and tax totals.                                              |
| [Cash voucher](specs/cash-voucher.spec.ts)                   | The creator reopens the voucher and sees the same payee, bill number, rupees, paise, and total.                                                              |
| [Lead conversion](specs/lead-conversion.spec.ts)             | The Lead owner's conversion opens the linked Proposal. The reopened Lead links to that same Proposal.                                                        |
| [Payroll review](specs/payroll-review.spec.ts)               | Current attendance and recorded slip amounts stay distinct in the company sheet and slip document.                                                           |
| [Salary profile lifecycle](specs/salary-profiles.spec.ts)    | An editor creates and corrects an agreement, generates payroll, and revises the agreement without repricing the earlier slip.                                |
| [Salary profile access](specs/salary-profile-access.spec.ts) | A reader sees used history without write controls. Independent tests prove zero CTC and the unsaved-draft guard.                                             |

[Salary contention](specs/salary-contention.spec.ts) runs in the same harness but checks real database transactions without a browser.
