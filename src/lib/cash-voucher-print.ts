/**
 * Pure HTML renderer for the cash voucher print document.
 *
 * The download route fetches the voucher row, parses line items, and inlines
 * the logo; this module turns that data into a complete standalone HTML page
 * (white document, Stripe-inspired hierarchy, A4 print rules). Pure and typed
 * so fixtures can smoke it without a database.
 *
 * Money: each line is amount_rs + amount_ps / 100 via shared helpers; the
 * stored voucher.total_amount stays authoritative and is never recalculated.
 * Every stored value is escaped at the sink with escapeHtml.
 */

import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { escapeHtml } from '@/lib/escape-html';
import { add, div, toNumber } from '@/lib/money';

export interface CashVoucherPrintLineItem {
	sr_no?: unknown;
	bill_date?: unknown;
	bill_no?: unknown;
	account_head?: unknown;
	amount_rs?: unknown;
	amount_ps?: unknown;
	description?: unknown;
}

export interface CashVoucherPrintVoucher {
	voucher_number?: unknown;
	voucher_date?: unknown;
	paid_to?: unknown;
	project_number?: unknown;
	payment_mode?: unknown;
	total_amount?: unknown;
	amount_in_words?: unknown;
	prepared_by?: unknown;
	checked_by?: unknown;
	approved_by_name?: unknown;
	receiver_signature?: unknown;
}

export interface CashVoucherPrintInput {
	voucher: CashVoucherPrintVoucher;
	lineItems: CashVoucherPrintLineItem[];
	/**
	 * Inlined logo (data URI) so the document survives a blob-tab open, or
	 * null when the logo file is missing — then a text mark renders instead
	 * of a broken image.
	 */
	logoSrc: string | null;
}

function toMoneyNumber(value: unknown): number {
	if (value === null || value === undefined || value === '') return 0;
	const n = typeof value === 'number' ? value : Number(String(value).trim());
	return Number.isFinite(n) ? n : 0;
}

/** One line total: rupees plus paise / 100, via the shared money helpers. */
export function lineItemTotalRs(amountRs: unknown, amountPs: unknown): number {
	return toNumber(
		add(toMoneyNumber(amountRs), div(toMoneyNumber(amountPs), 100))
	);
}

/** Stored text for display: em dash when blank, escaped otherwise. */
function text(value: unknown): string {
	if (value === null || value === undefined) return '—';
	const s = String(value).trim();
	return s === '' ? '—' : escapeHtml(s);
}

function paymentModeLabel(value: unknown): string {
	const raw = String(value ?? '').trim() || 'Cash';
	return escapeHtml(raw.charAt(0).toUpperCase() + raw.slice(1));
}

function signatureName(value: unknown): string {
	if (value === null || value === undefined) return '&nbsp;';
	const s = String(value).trim();
	return s === '' ? '&nbsp;' : escapeHtml(s);
}

const STYLES = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  background: #f1f2f6;
  color: #1a1a2e;
  font-size: 15px;
  line-height: 1.55;
}
.toolbar { max-width: 860px; margin: 0 auto; padding: 16px 16px 0; }
.toolbar button {
  display: inline-block;
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: #64126d;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.toolbar button:hover { background: #52105a; }
.sheet {
  max-width: 820px;
  margin: 16px auto 48px;
  background: #ffffff;
  color: #1a1a2e;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  padding: 40px 44px;
}
.doc-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  padding-bottom: 20px;
  border-bottom: 3px solid #64126d;
}
.brand { display: flex; gap: 14px; align-items: flex-start; min-width: 0; }
.brand img { height: 52px; width: auto; flex: none; }
.logo-fallback {
  flex: none;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64126d;
  line-height: 1.1;
  padding-top: 4px;
}
.company { margin: 0; font-size: 16px; font-weight: 700; color: #64126d; overflow-wrap: break-word; }
.address { margin: 2px 0 0; font-size: 12.5px; color: #555555; }
.doc-id { text-align: right; flex: none; }
.doc-id h1 { margin: 0; font-size: 22px; letter-spacing: 0.04em; text-transform: uppercase; }
.voucher-number { margin: 6px 0 0; font-size: 18px; font-weight: 700; color: #64126d; overflow-wrap: break-word; }
.voucher-date { margin: 2px 0 0; font-size: 13.5px; color: #444444; }
.meta { padding: 16px 0; border-bottom: 1px solid #e5e7eb; }
.meta dl { margin: 0; display: grid; gap: 8px; }
.meta .meta-row { display: grid; grid-template-columns: 130px 1fr; gap: 12px; }
.meta dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #666666; }
.meta dd { margin: 0; font-weight: 600; overflow-wrap: break-word; }
.items { padding: 8px 0 0; }
.table-scroll { overflow-x: auto; }
table { width: 100%; min-width: 560px; border-collapse: collapse; table-layout: fixed; }
thead th {
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64126d;
  text-align: left;
  padding: 10px 8px;
  border-bottom: 2px solid #64126d;
  vertical-align: bottom;
  overflow-wrap: break-word;
}
tbody td {
  padding: 9px 8px;
  border-bottom: 1px solid #ececf1;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
}
tbody tr:last-child td { border-bottom: none; }
th.num, td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.sr { color: #666666; }
.empty-row td { text-align: center; color: #666666; padding: 22px 8px; }
.totals {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-top: 8px;
  padding: 18px 0;
  border-top: 2px solid #64126d;
  border-bottom: 1px solid #e5e7eb;
}
.words { min-width: 0; }
.words-label, .grand-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #666666; }
.words p { margin: 4px 0 0; font-style: italic; overflow-wrap: break-word; }
.grand { text-align: right; flex: none; }
.grand strong { display: block; font-size: 26px; color: #64126d; font-variant-numeric: tabular-nums; white-space: nowrap; }
.signatures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; padding-top: 28px; }
.sig-name { margin: 0; min-height: 1.4em; font-weight: 600; font-size: 13px; text-align: center; overflow-wrap: break-word; }
.sig-space { height: 56px; }
.sig-rule { border-top: 1px solid #999999; margin: 0; }
.sig-caption { margin: 6px 0 0; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #666666; text-align: center; overflow-wrap: break-word; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 640px) {
  .sheet { margin: 12px 12px 32px; padding: 24px 18px; border-radius: 8px; }
  .doc-head { flex-direction: column; }
  .doc-id { text-align: left; }
  .meta .meta-row { grid-template-columns: 104px 1fr; }
  .totals { flex-direction: column; }
  .grand { text-align: left; }
  .signatures { grid-template-columns: repeat(2, 1fr); }
}
@page { size: A4; margin: 12mm 10mm 14mm; }
@media print {
  body { background: #ffffff; font-size: 10.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  .sheet { max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
  .table-scroll { overflow: visible; }
  table { min-width: 0; }
  thead { display: table-header-group; }
  tbody tr { break-inside: avoid; }
  .doc-head, .meta, .totals, .signatures { break-inside: avoid; }
}
`.trim();

const PRINT_SCRIPT = `
(function () {
  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }
  if (getParam('print') !== 'true') return;
  var done = false;
  function go() {
    if (done) return;
    done = true;
    window.print();
  }
  function whenReady() {
    var pending = [];
    if (document.fonts && document.fonts.ready) {
      pending.push(document.fonts.ready.catch(function () {}));
    }
    var images = document.images ? Array.prototype.slice.call(document.images) : [];
    images.forEach(function (img) {
      if (!img.complete) {
        pending.push(new Promise(function (resolve) {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }));
      }
    });
    Promise.all(pending).then(function () {
      if (document.readyState === 'complete') {
        go();
      } else {
        window.addEventListener('load', go, { once: true });
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', whenReady, { once: true });
  } else {
    whenReady();
  }
})();
`.trim();

/**
 * Render the full standalone print document for one cash voucher.
 * Stored total and stored words are shown verbatim; line amounts combine
 * rupees and paise. Returns a complete HTML page string.
 */
export function renderCashVoucherPrintDocument(
	input: CashVoucherPrintInput
): string {
	const { voucher, lineItems, logoSrc } = input;

	const rows =
		lineItems.length === 0
			? '<tr class="empty-row"><td colspan="6">No line items on this voucher.</td></tr>'
			: lineItems
					.map((item, index) => {
						const rawSr = item.sr_no;
						const sr =
							rawSr === null ||
							rawSr === undefined ||
							String(rawSr).trim() === ''
								? String(index + 1)
								: String(rawSr).trim();
						return `<tr>
          <td class="sr">${escapeHtml(sr)}</td>
          <td>${escapeHtml(formatDate(item.bill_date))}</td>
          <td>${text(item.bill_no)}</td>
          <td>${text(item.account_head)}</td>
          <td>${text(item.description)}</td>
          <td class="num">${escapeHtml(formatNumber(lineItemTotalRs(item.amount_rs, item.amount_ps)))}</td>
        </tr>`;
					})
					.join('');

	const signatures: Array<{ name: unknown; caption: string }> = [
		{ name: voucher.prepared_by, caption: 'Prepared by' },
		{ name: voucher.checked_by, caption: 'Checked by' },
		{ name: voucher.approved_by_name, caption: 'Approved by' },
		{ name: voucher.receiver_signature, caption: "Receiver's signature" },
	];
	const signatureHtml = signatures
		.map(
			(sig) => `<div class="sig">
        <p class="sig-name">${signatureName(sig.name)}</p>
        <div class="sig-space" aria-hidden="true"></div>
        <p class="sig-rule" aria-hidden="true"></p>
        <p class="sig-caption">${sig.caption}</p>
      </div>`
		)
		.join('');

	const brandMark = logoSrc
		? `<img src="${logoSrc}" alt="Accent Techno Solutions logo">`
		: `<div class="logo-fallback" aria-label="Accent Techno Solutions">Accent</div>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cash Voucher - ${text(voucher.voucher_number)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="toolbar no-print" role="toolbar" aria-label="Print actions">
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <main class="sheet">
    <header class="doc-head">
      <div class="brand">
        ${brandMark}
        <div>
          <p class="company">Accent Techno Solutions Pvt. Ltd.</p>
          <p class="address">17/130, Anand Nagar, Neharu Road, Vakola,<br>Santacruz (E), Mumbai - 400 055.</p>
        </div>
      </div>
      <div class="doc-id">
        <h1>Cash Voucher</h1>
        <p class="voucher-number">${text(voucher.voucher_number)}</p>
        <p class="voucher-date">${escapeHtml(formatDate(voucher.voucher_date))}</p>
      </div>
    </header>

    <section class="meta" aria-label="Voucher details">
      <dl>
        <div class="meta-row"><dt>Paid to</dt><dd>${text(voucher.paid_to)}</dd></div>
        <div class="meta-row"><dt>Project</dt><dd>${text(voucher.project_number)}</dd></div>
        <div class="meta-row"><dt>Paid by</dt><dd>${paymentModeLabel(voucher.payment_mode)}</dd></div>
      </dl>
    </section>

    <section class="items" aria-label="Line items">
      <div class="table-scroll" role="region" aria-label="Voucher line items, scroll sideways to see all columns" tabindex="0">
        <table>
          <caption class="visually-hidden">Cash voucher line items</caption>
          <colgroup>
            <col style="width: 44px">
            <col style="width: 96px">
            <col style="width: 88px">
            <col style="width: 22%">
            <col>
            <col style="width: 112px">
          </colgroup>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Bill date</th>
              <th scope="col">Bill no.</th>
              <th scope="col">Account head</th>
              <th scope="col">Description</th>
              <th scope="col" class="num">Amount (&#8377;)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>

    <section class="totals" aria-label="Total">
      <div class="words">
        <span class="words-label">Amount in words</span>
        <p>${text(voucher.amount_in_words)}</p>
      </div>
      <div class="grand">
        <span class="grand-label">Total</span>
        <strong>${escapeHtml(formatCurrency(voucher.total_amount))}</strong>
      </div>
    </section>

    <section class="signatures" aria-label="Signatures">
      ${signatureHtml}
    </section>
  </main>

  <script>${PRINT_SCRIPT}</script>
</body>
</html>`;
}
