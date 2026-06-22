import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export const runtime = 'nodejs';

function generateInvoiceHTML(data) {
	const formatDate = (dateStr) => {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		return d
			.toLocaleDateString('en-IN', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
			})
			.replace(/\//g, '.');
	};

	const formatCurrency = (amount) =>
		new Intl.NumberFormat('en-IN', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount || 0);

	const numberToWords = (num) => {
		const ones = [
			'',
			'One',
			'Two',
			'Three',
			'Four',
			'Five',
			'Six',
			'Seven',
			'Eight',
			'Nine',
			'Ten',
			'Eleven',
			'Twelve',
			'Thirteen',
			'Fourteen',
			'Fifteen',
			'Sixteen',
			'Seventeen',
			'Eighteen',
			'Nineteen',
		];
		const tens = [
			'',
			'',
			'Twenty',
			'Thirty',
			'Forty',
			'Fifty',
			'Sixty',
			'Seventy',
			'Eighty',
			'Ninety',
		];
		if (num === 0) return 'Zero';
		if (num < 20) return ones[num];
		if (num < 100)
			return (
				tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '')
			);
		if (num < 1000)
			return (
				ones[Math.floor(num / 100)] +
				' Hundred' +
				(num % 100 ? ' ' + numberToWords(num % 100) : '')
			);
		if (num < 100000)
			return (
				numberToWords(Math.floor(num / 1000)) +
				' Thousand' +
				(num % 1000 ? ' ' + numberToWords(num % 1000) : '')
			);
		if (num < 10000000)
			return (
				numberToWords(Math.floor(num / 100000)) +
				' Lakh' +
				(num % 100000 ? ' ' + numberToWords(num % 100000) : '')
			);
		return (
			numberToWords(Math.floor(num / 10000000)) +
			' Crore' +
			(num % 10000000 ? ' ' + numberToWords(num % 10000000) : '')
		);
	};

	const grossAmount = parseFloat(data.gross_amount) || 0;
	const cgstRate = parseFloat(data.cgst_rate) || 9;
	const sgstRate = parseFloat(data.sgst_rate) || 9;
	const igstRate = parseFloat(data.igst_rate) || 18;
	const gstType = data.gst_type || 'cgst_sgst';

	const cgstAmount =
		gstType === 'cgst_sgst' ? (grossAmount * cgstRate) / 100 : 0;
	const sgstAmount =
		gstType === 'cgst_sgst' ? (grossAmount * sgstRate) / 100 : 0;
	const igstAmount = gstType === 'igst' ? (grossAmount * igstRate) / 100 : 0;
	const totalGst = cgstAmount + sgstAmount + igstAmount;
	const netAmount = parseFloat(data.net_amount) || grossAmount + totalGst;

	const rupees = Math.floor(netAmount);
	const paise = Math.round((netAmount - rupees) * 100);
	const amountInWords =
		data.amount_in_words ||
		'Rupees ' +
			numberToWords(rupees) +
			(paise > 0 ? ' And ' + numberToWords(paise) + ' Paise' : '') +
			' Only .';

	let lineItems = [];
	if (data.line_items) {
		try {
			lineItems =
				typeof data.line_items === 'string'
					? JSON.parse(data.line_items)
					: data.line_items;
		} catch (_) {}
	}
	if (!lineItems.length && data.items) {
		try {
			const items =
				typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
			lineItems = (items || []).map((item, i) => ({
				sr_no: item.sr_no || i + 1,
				description: item.description || '',
				unit: item.unit || '-',
				charges: item.charges || '-',
				amount:
					item.amount != null
						? item.amount
						: (item.quantity || 1) * (item.rate || 0),
			}));
		} catch (_) {}
	}
	if (!lineItems.length) {
		lineItems = [
			{
				sr_no: 1,
				description: data.description || data.scope_of_work || '',
				unit: data.unit || '-',
				charges: data.charges || '-',
				amount: grossAmount,
			},
		];
	}

	const lineItemsHTML = lineItems
		.map(
			(item) => `
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 4px;text-align:center;vertical-align:top;">${item.sr_no || ''}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;white-space:pre-wrap;">${item.description || ''}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 4px;text-align:center;vertical-align:top;">${item.unit || '-'}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 4px;text-align:center;vertical-align:top;">${item.charges || '-'}</td>
      <td style="border-bottom:1px solid #000;padding:6px 8px;text-align:right;vertical-align:top;">${item.amount ? formatCurrency(item.amount) : ''}</td>
    </tr>
  `
		)
		.join('');

	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tax Invoice - ${data.invoice_number || 'Draft'}</title>
  <style>
    @media print { body { margin: 0; padding: 0; } }
    @page { size: A4; margin: 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      font-size: 10px;
      color: #000;
      background: white;
      padding: 15px;
    }
    .outer { width: 100%; max-width: 730px; margin: 0 auto; border: 1px solid #000; border-collapse: collapse; }
    td, th { font-family: Arial, sans-serif; font-size: 10px; }
  </style>
</head>
<body>
  <table class="outer" style="border-collapse:collapse;">

    <!-- TAX INVOICE title row -->
    <tr>
      <td colspan="2" style="border-bottom:1px solid #000;padding:6px;text-align:center;font-weight:bold;font-size:12px;letter-spacing:1px;">
        TAX INVOICE
      </td>
    </tr>

    <!-- To / Invoice meta split -->
    <tr>
      <td style="width:55%;border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        <div>To,</div>
        <br>
        <div>Name &nbsp;&nbsp;&nbsp; : ${data.client_name || ''}</div>
        <br>
        <div>Address &nbsp; : ${data.client_address ? data.client_address.replace(/\n/g, '<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;') : ''}</div>
      </td>
      <td style="width:45%;border-bottom:1px solid #000;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Invoice No.</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;font-weight:bold;">${data.invoice_number || ''}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Date of Invoice</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">${formatDate(data.invoice_date)}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">PO Number</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">${data.po_number || 'Agreement'}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;">PO Date</td>
            <td style="padding:4px 8px;">${formatDate(data.po_date)}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- PAN / GSTIN / State | Original & Balance PO Value -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        <div>PAN No. &nbsp; : ${data.client_pan || ''}</div>
        <div>GSTIN &nbsp;&nbsp;&nbsp;&nbsp; : ${data.client_gstin || ''}</div>
        <div style="margin-top:4px;">State &nbsp;&nbsp;&nbsp; :&nbsp; ${data.client_state || 'Maharashtra'} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; State Code : &nbsp; ${data.client_state_code || '27'}</div>
      </td>
      <td style="border-bottom:1px solid #000;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Original PO Value</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;text-align:right;">
              : &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${data.original_po_value ? formatCurrency(data.original_po_value) : '-'}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-weight:bold;">Balance PO Value</td>
            <td style="padding:4px 8px;text-align:right;font-weight:bold;">
              : &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${data.balance_po_value ? formatCurrency(data.balance_po_value) : '-'}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Kind Attn -->
    <tr>
      <td colspan="2" style="border-bottom:1px solid #000;padding:4px 8px;">
        Kind Attn. &nbsp; : ${data.kind_attn || ''}
      </td>
    </tr>

    <!-- Line items table header -->
    <tr>
      <td colspan="2" style="padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #000;">
              <th style="border-right:1px solid #000;padding:5px 4px;text-align:center;width:50px;">Sr. No.</th>
              <th style="border-right:1px solid #000;padding:5px 8px;text-align:center;">Description</th>
              <th style="border-right:1px solid #000;padding:5px 4px;text-align:center;width:70px;">Unit</th>
              <th style="border-right:1px solid #000;padding:5px 4px;text-align:center;width:80px;">Charges</th>
              <th style="padding:5px 8px;text-align:center;width:90px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHTML}
          </tbody>
        </table>
      </td>
    </tr>

    <!-- GSTIN/PAN/Service/TAN left | Totals right -->
    <tr>
      <td style="border-right:1px solid #000;border-top:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        <div>GSTIN &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; : ${data.gst_number || ''}</div>
        <div>PAN NO &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; : ${data.pan_number || ''}</div>
        <div style="margin-top:2px;">Service Category : ${data.service_category || 'Consulting & Advisory Engineering Services (Service Code : 998331)'}</div>
        <div>Tan No &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; : ${data.tan_number || ''}</div>
      </td>
      <td style="border-top:1px solid #000;border-bottom:1px solid #000;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Total Amount Before Tax &gt;&gt;</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;text-align:right;">${formatCurrency(grossAmount)}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Add : CGST _ ${cgstRate}% &gt;&gt;</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;text-align:right;">${gstType === 'cgst_sgst' ? formatCurrency(cgstAmount) : '-'}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Add : SGST _ ${sgstRate}% &gt;&gt;</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;text-align:right;">${gstType === 'cgst_sgst' ? formatCurrency(sgstAmount) : '-'}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Add : IGST _${igstRate}% &gt;&gt;</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;text-align:right;">${gstType === 'igst' ? formatCurrency(igstAmount) : '-'}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;border-bottom:1px solid #000;">Total Amount : GST &gt;&gt;</td>
            <td style="padding:4px 8px;border-bottom:1px solid #000;text-align:right;">${formatCurrency(totalGst)}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Amount in words | Total Amount After Tax -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:middle;">
        <strong>${amountInWords}</strong>
      </td>
      <td style="border-bottom:1px solid #000;padding:0;vertical-align:middle;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 8px;font-weight:bold;">Total Amount After Tax &gt;&gt;</td>
            <td style="padding:6px 8px;font-weight:bold;text-align:right;">${formatCurrency(netAmount)}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Payment Terms & Conditions -->
    <tr>
      <td colspan="2" style="border-bottom:1px solid #000;padding:6px 8px;">
        <div style="font-weight:bold;">Payment Terms &amp; Conditions:</div>
        <div style="margin-top:4px;margin-left:12px;">
          1 &nbsp; a) Payment shall be made within 15 days from the receipt of invoice.<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; b) Interest @ 18% will be charged on delayed payment.
        </div>
        <div style="margin-top:4px;margin-left:12px;">2 &nbsp; Subject to Mumbai Jurisdiction.</div>
      </td>
    </tr>

    <!-- Cheque instructions | For ATSPL signature block -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        Cheque/ Demand Draft /wire Transfer for requisite amount to be drawn in favor of
        <strong>"Accent Techno Solutions Private Ltd"</strong> payable at Mumbai.
      </td>
      <td style="border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        For Accent Techno Solutions Private Limited
      </td>
    </tr>

    <!-- Payment remittance detail | Signature -->
    <tr>
      <td style="border-right:1px solid #000;padding:6px 8px;vertical-align:top;">
        <div style="text-align:center;font-weight:bold;">Payment remittance detail</div>
        <div style="text-align:center;">Bank - Axis Bank Ltd.</div>
        <div style="margin-top:4px;">Add. - ${data.bank_address || ''}</div>
        <div>.</div>
      </td>
      <td style="padding:6px 8px;vertical-align:bottom;">
        <div style="margin-top:40px;">
          <div style="font-weight:bold;">Varsha Vasant Mestry</div>
          <div>Managing Director</div>
        </div>
      </td>
    </tr>

  </table>

  <!-- Doc reference footer (outside main table, bottom-left) -->
  <div style="margin-top:6px;font-size:9px;">
    F/ATSPL/ADMN/09<br>Rev 001
  </div>
</body>
</html>
  `;
}

function sanitizeFileName(value) {
	return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

// Map a DB invoice row to the fields expected by generateInvoiceHTML
function mapInvoiceForTemplate(inv) {
	const taxRate = parseFloat(inv.tax_rate) || 18;
	const gstType = inv.gst_type || 'cgst_sgst';
	return {
		...inv,
		invoice_date: inv.invoice_date || inv.created_at,
		gross_amount: inv.gross_amount != null ? inv.gross_amount : inv.subtotal,
		net_amount: inv.net_amount != null ? inv.net_amount : inv.total,
		original_po_value:
			inv.original_po_value != null ? inv.original_po_value : inv.po_value,
		cgst_rate:
			inv.cgst_rate != null
				? inv.cgst_rate
				: gstType === 'cgst_sgst'
					? taxRate / 2
					: 0,
		sgst_rate:
			inv.sgst_rate != null
				? inv.sgst_rate
				: gstType === 'cgst_sgst'
					? taxRate / 2
					: 0,
		igst_rate: inv.igst_rate != null ? inv.igst_rate : taxRate,
	};
}

// GET - Download invoice as PDF
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let connection;
	let browser;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, message: 'Invoice ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const [invoices] = await connection.execute(
			'SELECT * FROM invoices WHERE id = ?',
			[id]
		);

		if (!invoices || invoices.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Invoice not found' },
				{ status: 404 }
			);
		}

		const invoice = mapInvoiceForTemplate(invoices[0]);
		const html = generateInvoiceHTML(invoice);
		const filename = `${sanitizeFileName(invoice.invoice_number || 'invoice')}.pdf`;

		const viewport = {
			deviceScaleFactor: 1,
			hasTouch: false,
			height: 1754,
			isLandscape: false,
			isMobile: false,
			width: 1240,
		};

		const isVercel = process.env.VERCEL === '1';
		if (isVercel) {
			browser = await puppeteer.launch({
				args: chromium.args,
				defaultViewport: viewport,
				executablePath: await chromium.executablePath(),
				headless: true,
			});
		} else {
			browser = await puppeteer.launch({
				headless: true,
				defaultViewport: viewport,
			});
		}

		const page = await browser.newPage();
		await page.emulateMediaType('print');
		await page.setContent(html, { waitUntil: 'networkidle0' });

		const pdf = await page.pdf({
			format: 'A4',
			printBackground: true,
			preferCSSPageSize: true,
			displayHeaderFooter: false,
			margin: {
				top: '12mm',
				right: '12mm',
				bottom: '12mm',
				left: '12mm',
			},
		});

		return new Response(Buffer.from(pdf), {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${filename}"`,
			},
		});
	} catch (error) {
		console.error('Error generating invoice:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to generate invoice',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (browser) {
			try {
				await browser.close();
			} catch (closeError) {
				console.error('Error closing browser:', closeError);
			}
		}
		if (connection) await connection.end();
	}
}
