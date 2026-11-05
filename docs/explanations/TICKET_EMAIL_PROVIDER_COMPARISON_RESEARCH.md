# Ticket Email Provider Comparison Research

Research note (2026-10-28). Research only; no code, account, or delivery changes.
Neutral comparison of practical email delivery choices for Accent CRM ticket alerts.
This expands the earlier [Gmail and integration note](TICKET_EMAIL_NOTIFICATIONS_RESEARCH.md).

## Pricing basis

- USD per month on monthly billing unless marked; annual-commitment figures shown separately only where verified.
- Prices are list subscription/sending cost only. They do not imply delivery guarantees or inbox placement.
- Separate everywhere: domain registration/renewal, taxes, implementation work, retry/queue infrastructure, attachment bandwidth beyond stated overages, and inbox placement.
- "Unknown" means not stated in the official sources checked. It is not inferred.

## Main comparison

| Option           | Ongoing free or trial                                                | Lowest paid (monthly billing)                                                      | Overage / metered note                                    | Integration                                                                   |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Resend           | Free-forever $0: 3,000/mo, max 100/day                               | Pro $20/mo: 50,000/mo                                                              | $0.90/1k beyond included; opt-in pay-as-you-go            | Verified domain; API + SMTP on all plans                                      |
| Postmark         | Free developer $0: 100/mo, no overages, no expiry                    | Basic $15/mo: 10,000/mo                                                            | $1.80/1k on Basic; auto-billed next cycle                 | Verified domain/sender; API + SMTP                                            |
| SendGrid         | Free TRIAL $0: 100/day for 60 days only                              | Essentials $19.95/mo: 50,000/mo                                                    | $1.33/1k extra on that tier; overages may apply           | Authenticated domain; API + SMTP on all plans                                 |
| Mailgun          | Free $0: 100/day, no card, no time limit stated                      | Basic $15/mo: 10,000/mo                                                            | $1.80/1k on Basic; auto-billed, cannot disable            | Verified domain; API + SMTP on all plans                                      |
| Amazon SES       | No ongoing free allowance listed; new-customer credits are temporary | No fixed fee: $0.10/1k + $0.12/GB attachments (a la carte)                         | Metered per recipient, not per message                    | Verified identity; production approval removes sandbox recipient restrictions |
| Brevo            | Free ongoing: 300/day, "Sent with Brevo" branding                    | Starter $9/mo (USD; INR Rs625): 5,000/mo                                           | Next 5,001-10,000 adds $8/mo; prepaid-pack prices unknown | Authenticated domain/sender; SMTP/API                                         |
| SMTP2GO          | Free ongoing: 1,000/mo AND 200/day                                   | Starter $10/mo: 10,000/mo                                                          | $1/1k extra, paid plans only, up to 3x plan               | Verified domain, else 25/hour cap; SMTP/API                                   |
| Personal Gmail   | Existing mailbox; no new subscription                                | n/a (not a paid mail API)                                                          | Hard provider caps; 1-24h recovery after limit errors     | App password (2SV) or Gmail API OAuth                                         |
| Google Workspace | Existing licensed mailbox may avoid new cost                         | Std $8.40 flex / $7 annual-commit per user/mo (US); India varies, confirm checkout | 2,000 msgs/rolling 24h paid; 500 trial                    | SMTP/API under admin policy                                                   |
| Microsoft 365    | Existing license may avoid new cost                                  | Exchange Online Plan 1 $4/user/mo PAID YEARLY ($48/yr)                             | Mailbox limits, not an unrestricted app-mail API          | Graph/OAuth preferred; SMTP AUTH often disabled                               |
| Self-hosted SMTP | No universal price; software may be free                             | VM, IP, DNS/domain, operations all separate                                        | n/a                                                       | Full DNS, reputation, and upkeep burden                                       |

Volume math at one recipient per send: 20 tickets/day means 20 sends/day before assignment or comment notifications. Where a provider bills per recipient, extra recipients multiply deliveries (for example, 5 recipients would mean 100 deliveries/day). Average monthly quota alone does not cover bursts; size to measured peaks.

## Transactional providers (verified 2026-10-28)

### Resend

- Free plan is free-forever (not a trial): $0, 3,000 emails/mo, 100/day cap, 3 domains. Paid Pro starts $20/mo for 50,000/mo; overage $0.90/1k. Multiple To/CC/BCC recipients count as separate emails; received emails also count toward quota. <https://resend.com/pricing>
- Self-serve plans bill monthly only; no annual discount. Paid overages bill in 1,000-email buckets when pay-as-you-go is enabled. <https://resend.com/pricing>
- Production sending needs a verified owned domain (subdomain recommended); exact DKIM/SPF records required, DMARC after verification. API, SMTP relay, and SDKs are on all plans. <https://resend.com/docs/add-a-domain>
- Marketing email is contact-based, not send-based; broadcasts go only to existing contacts. Do not compare contact counts against transactional send quotas. <https://resend.com/pricing>
- Whether the free plan needs a credit card was not stated in the sources checked: unknown.

### Postmark

- Free developer plan: 100 emails/mo, no overages allowed, never expires; no tier exists between 100/mo and 10,000/mo. Basic $15/mo for 10,000/mo with $1.80/1k extra; Pro $16.50 and Platform $18 start at the same 10,000 volume with lower overage rates. <https://postmarkapp.com/pricing>
- Sent transactional/broadcast, sandboxed test, and processed inbound messages each count as 1; each CC/BCC address counts as 1. Unused emails do not roll over. No annual plans currently. <https://postmarkapp.com/support/article/1107-how-does-monthly-pricing-work>
- Domain verification uses DKIM TXT plus a custom Return-Path CNAME for SPF alignment, with DMARC recommended. <https://postmarkapp.com/support/article/how-do-i-verify-a-domain>
- Signup CTA states no credit card for the free trial; paid billing is by card (Visa, MasterCard, Amex, Diners, JCB; no PayPal). <https://postmarkapp.com/pricing>

### SendGrid (Twilio)

- Free offer is a 60-day trial only: $0, 100 emails/day, no credit card; it cannot exceed its limits. It is not an ongoing free plan. <https://www.twilio.com/en-us/products/email-api/pricing>
- Lowest paid Email API tier: Essentials $19.95/mo for 50,000/mo; extra emails $0.00133 each ($1.33/1k). Next: $34.95/mo for 100,000/mo. <https://www.twilio.com/content/dam/twilio-com/global/en/pricing/all-pricing/twi121--sendgrid-pricing-pdf-st1.pdf>
- Domain authentication uses provider-generated SPF/DKIM/DMARC DNS records (automated CNAME security by default); verification can take up to 48 hours. SMTP and API are on all plans. <https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication/>
- Per-recipient vs per-message counting and annual-discount terms were not stated in the sources checked: unknown.

### Mailgun

- Free plan needs no credit card: 100 messages/day, 1 verified custom domain, 1-day log retention, ticket support. No time limit is stated, unlike Foundation/Scale which are "free for 1 month, then" paid. <https://help.mailgun.com/hc/en-us/articles/203068914-What-does-the-Free-plan-offer>
- Lowest paid: Basic from $15/mo for 10,000/mo, extra from $1.80/1k. Foundation $35/mo for 50,000/mo; Scale $90/mo for 100,000/mo. <https://www.mailgun.com/pricing/>
- Overage rates step down by monthly volume tier on Foundation/Scale; Basic stays $1.80/1k at all listed tiers. Extras auto-bill at renewal and cannot be deactivated; upgrading before cycle end absorbs them into the new allocation. <https://help.mailgun.com/hc/en-us/articles/6745531451547-What-happens-if-I-send-more-emails-than-my-monthly-plan-provides>
- Verify the sending domain with the supplied DNS records. Receiving and tracking features have additional DNS records. REST API and SMTP relay are available. <https://help.mailgun.com/hc/en-us/articles/32884702360603-Domain-Verification-Setup-Guide>
- Per-recipient vs per-message counting was not stated in the sources checked: unknown.

## Value providers (peer findings, official sources, 2026-10-28)

### Amazon SES

- Pay-as-you-go, no commitment: a la carte outbound $0.10/1k emails + $0.12/GB attachments, or Essentials plan $0.16/1k with no fixed fee. No ongoing free allowance is listed; new-customer credits are temporary. <https://aws.amazon.com/ses/pricing>
- Billing and quotas are per recipient: one email to 10 recipients counts as 10. <https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html>
- New accounts start in a sandbox (200 msgs/24h); sandbox sending is restricted to verified addresses/domains, but those verified addresses can be real staff recipients. Production access removes the verified-recipient restriction; every From identity must still be verified. <https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html>
- Whether INR billing applies to this account: unknown.

### Brevo

- Free plan is ongoing: 300 sends/day (daily reset, no rollover), up to 100,000 contacts stored, 1 user; transactional sends past the cap queue up to 1,000, then stop. <https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan>
- Free sends carry "Sent with Brevo" branding. Removal requires Starter plus an add-on, or a higher qualifying tier. Starter monthly: USD $9/mo or INR Rs625/mo for 5,000 emails. <https://www.brevo.com/pricing.md> <https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan>
- Prepaid credits never expire and cover both marketing and transactional sends; exact pack prices were not verified. Transactional-only marketing-contact caps remain unknown. <https://help.brevo.com/hc/en-us/articles/4409354969746-Customize-your-plan-with-add-ons>

### SMTP2GO

- Free plan is ongoing: 1,000 emails/mo AND 200 emails/day; over the monthly cap, sends are rejected until reset. Starter $10/mo (USD) for 10,000/mo; extra $1/1k on paid plans only, up to 3x the plan limit. <https://www.smtp2go.com/pricing> <https://support.smtp2go.com/hc/en-gb/articles/223087947-Free-Plan>
- Without a verified domain, an additional 25/hour limit applies. Single-address verification lacks domain authentication alignment, risking rejection under restrictive DMARC policies. New accounts face review after 1,000 sends. <https://support.smtp2go.com/hc/en-gb/articles/223087947-Free-Plan> <https://support.smtp2go.com/hc/en-gb/articles/9150216032537-Verified-Senders-Sender-Domain-vs-Single-Sender-Emails> <https://support.smtp2go.com/hc/en-gb/articles/223087427-New-Account-Limits-and-the-Review-Process>
- Multi-recipient quota counting was not stated in the official sources checked: unknown.

## Mailbox and self-hosting (parent findings, 2026-10-28)

- Personal Gmail: possible limit errors above 500 emails/day or 500 recipients/message, 1-24h recovery; not an automated-delivery allowance. App passwords need 2-Step Verification and eligibility; password changes revoke them. <https://support.google.com/mail/answer/22839?hl=en> <https://support.google.com/accounts/answer/185833?hl=en>
- Google Workspace: standard Business Starter US $8.40/user/mo flexible or $7 annual-commitment ($84/yr); India standard Rs650 flexible / Rs540 annual-equivalent, while the public India page shows different promotions, so checkout must confirm. Paid limit 2,000 msgs/rolling 24h; trials 500; SMTP 100 recipients/message. <https://support.google.com/a/answer/1247360?hl=en> <https://support.google.com/a/answer/166852?hl=en>
- Microsoft 365: Exchange Online Plan 1 US list $4/user/mo paid yearly ($48/yr), not a verified month-to-month offer. Prefer Graph API/OAuth for new integrations; SMTP AUTH may be disabled and security should not be weakened for alerts. Recipient/tenant limits apply. <https://www.microsoft.com/en-us/microsoft-365/exchange/compare-microsoft-exchange-online-plans> <https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0> <https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission>
- Self-hosted SMTP: no universal price; VM, IP, DNS/domain, and operations are separate. Requires forward/reverse DNS, SPF, DKIM, DMARC, plus ongoing upkeep; disproportionate work for ticket alerts alone. <https://docs.mailcow.email/getstarted/prerequisite-system/> <https://docs.mailcow.email/getstarted/prerequisite-dns/>
- Additional alternatives needing checkout verification (not verified live quotes): Zoho ZeptoMail credit pricing now sits behind <https://www.zoho.com/cpaas/pricing.html>, which shows 10,000 emails per credit with the first credit free and 6-month credit expiry, but no static price numbers; Azure Communication Services email pricing renders dynamically at <https://azure.microsoft.com/en-us/pricing/details/communication-services/>, while its docs page publishes $0.00025/email + $0.00012/MB but labels those figures illustrative and possibly not latest. <https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing>

## Neutral fit for low-volume ticket alerts

- An existing company mailbox avoids a new email-provider subscription if policy permits app sending; a new dedicated mailbox may need another license [INFERENCE].
- For a zero-cost dedicated sender, choose among the ongoing free plans (Resend, Postmark, Mailgun, Brevo, SMTP2GO) by measured peak day, recipient multiplier, branding tolerance, and domain-verification effort. SendGrid's free offer expires after 60 days, so it is not a zero-cost answer.
- SES has the lowest base metered sending price among the reviewed options, with more setup (sandbox exit, identity verification). A paid managed provider is justified only if its support, logging, retention, or limits are worth its fixed monthly fee at this volume.
- No universal winner. Prices above do not imply delivery guarantees; domain authentication and sender reputation still decide inbox placement.

## Checking existing Microsoft 365 for accent.in

Research note (2026-10-28). No authenticated tenant access; tenant, licenses, and admin permissions are all unknown. Nothing below was verified by signing in to any admin portal.

- Public DNS checks (observed 2026-10-28, parent live checks): `nslookup -type=MX accent.in` returned preference 0 `mx008-ind.megavelocity.net` and preference 5 `mail.accent.in`, NOT the standard `*.mail.protection.outlook.com`; `nslookup -type=TXT accent.in` returned `v=spf1 include:_spf.megavelocity.net include:spf.protection.outlook.com -all`, which authorizes MegaVelocity and Microsoft outbound routes but is NOT proof of an active Exchange Online license. Do not assume direct Microsoft 365 hosting; this could be hosted Exchange/a reseller or a mail security gateway in front of Microsoft 365. Public DNS records cannot decide the backend (observed command output; no external citation needed). Check with the domain admin/IT what the actual mailbox hosting type is before choosing Graph vs hosted SMTP; no DNS changes needed.
- Existing business email on the domain is not proof of a Microsoft 365 license or of Microsoft hosting the mailboxes [INFERENCE].
- Checklist (needs an admin with tenant access):
  1. Microsoft 365 admin center (`admin.microsoft.com`): Users > Active users > select the user > Licenses and apps; look for an assigned license with Exchange Online enabled. Licenses can be assigned per user on the Active users page, including turning apps and services on or off. <https://learn.microsoft.com/en-us/microsoft-365/admin/manage/assign-licenses-to-users?view=o365-worldwide>
  2. Exchange admin center (`admin.exchange.microsoft.com`): Recipients > Mailboxes; confirms which mailboxes actually exist. The EAC is the web-based management console for Exchange Online, and mailbox properties are managed under Recipients > Mailboxes. <https://learn.microsoft.com/en-us/exchange/exchange-admin-center> <https://learn.microsoft.com/en-us/exchange/recipients/user-mailboxes/user-mailboxes>
  3. Domain check: Settings > Domains in the Microsoft 365 admin center, to confirm accent.in is added/verified in the tenant (parent-verified path). <https://learn.microsoft.com/en-us/microsoft-365/admin/setup/add-domain?view=o365-worldwide>
  4. Microsoft Entra admin center (`entra.microsoft.com`): Entra ID > App registrations > New registration; needs at least the Application Developer role. <https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app>
- Recommendation for app-only Graph sending: use Exchange RBAC for Applications to assign `Application Mail.Send`, scoped only to the notification mailbox. Do not also grant tenant-wide `Mail.Send` through Entra: permissions are additive, so that would defeat this scope. Request no mail-reading permissions. <https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0> <https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac>
- A shared mailbox is an option, subject to licensing and security configuration. It can hold up to 50 GB without a separate license; the organization needs an Exchange-inclusive subscription. Advanced features may need licenses. Keep direct sign-in blocked. <https://learn.microsoft.com/en-us/microsoft-365/admin/email/about-shared-mailboxes?view=o365-worldwide>
