import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// Helper functions
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount || 0);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(-num);
  
  let words = '';
  
  if (Math.floor(num / 10000000) > 0) {
    words += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  if (Math.floor(num / 100000) > 0) {
    words += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  if (Math.floor(num / 1000) > 0) {
    words += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    words += numberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    if (num < 20) {
      words += ones[num];
    } else {
      words += tens[Math.floor(num / 10)];
      if (num % 10 > 0) {
        words += ' ' + ones[num % 10];
      }
    }
  }
  return words.trim();
}

function amountToWords(amount) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  
  let result = 'Rupees ' + numberToWords(rupees);
  if (paise > 0) {
    result += ' and ' + numberToWords(paise) + ' Paise';
  }
  result += ' Only';
  return result;
}

// Generate Invoice HTML
function generateInvoiceHTML(data) {
  // Parse items if needed
  let items = data.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  items = items || [];

  // Generate items rows
  let itemsHTML = '';
  if (items.length > 0) {
    items.forEach((item, index) => {
      const qty = parseFloat(item.quantity) || 1;
      const rate = parseFloat(item.rate) || parseFloat(item.unit_price) || 0;
      const amount = qty * rate;
      itemsHTML += `
        <tr>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
          <td style="border: 1px solid #000; padding: 8px;">${item.description || item.name || '-'}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">${qty}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(rate)}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(amount)}</td>
        </tr>
      `;
    });
  } else {
    itemsHTML = `
      <tr>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">1</td>
        <td style="border: 1px solid #000; padding: 8px;">${data.description || '-'}</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">1</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(data.subtotal)}</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(data.subtotal)}</td>
      </tr>
    `;
  }

  const subtotal = parseFloat(data.subtotal) || 0;
  const taxRate = parseFloat(data.tax_rate) || 18;
  const taxAmount = parseFloat(data.tax_amount) || (subtotal * taxRate / 100);
  const discount = parseFloat(data.discount) || 0;
  const total = parseFloat(data.total) || (subtotal + taxAmount - discount);
  const amountPaid = parseFloat(data.amount_paid) || 0;
  const balanceDue = parseFloat(data.balance_due) || (total - amountPaid);
  
  const amountInWords = amountToWords(total);

  // Status badge
  const getStatusBadge = (status) => {
    const styles = {
      draft: 'background: #f3f4f6; color: #374151;',
      sent: 'background: #dbeafe; color: #1d4ed8;',
      paid: 'background: #dcfce7; color: #15803d;',
      overdue: 'background: #fee2e2; color: #dc2626;',
      cancelled: 'background: #f3f4f6; color: #6b7280;'
    };
    return `<span style="padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 600; ${styles[status] || styles.draft}">${(status || 'draft').toUpperCase()}</span>`;
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice - ${data.invoice_number || 'Draft'}</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; }
      .no-print { display: none !important; }
      .invoice-page { page-break-after: always; }
    }
    @page { size: A4; margin: 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      font-size: 11px; 
      line-height: 1.4; 
      color: #000; 
      background: white; 
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container { 
      width: 100%; 
      max-width: 750px; 
      margin: 0 auto; 
      background: white;
    }
    .print-button { position: fixed; bottom: 20px; right: 20px; background: #000; color: white; border: none; padding: 12px 24px; border-radius: 4px; font-size: 13px; cursor: pointer; z-index: 1000; }
    .print-button:hover { background: #333; }
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container invoice-page">
    <!-- Header with Logo -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 15px;">
      <div style="display: flex; align-items: center;">
        <img src="/accent-logo.png" alt="Accent Logo" style="height: 50px; margin-right: 15px;" onerror="this.style.display='none'"/>
        <div>
          <div style="font-size: 18px; font-weight: bold;">ACCENT TECHNO SOLUTIONS PVT. LTD.</div>
          <div style="font-size: 10px; color: #666; margin-top: 4px;">Engineering Excellence</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 24px; font-weight: bold; color: #333;">INVOICE</div>
        ${getStatusBadge(data.status)}
      </div>
    </div>

    <!-- Invoice Details and Client Info -->
    <table style="width: 100%; border: 2px solid #000; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="border: 1px solid #000; padding: 0; vertical-align: top; width: 50%;">
          <div style="padding: 10px; border-bottom: 1px solid #000; font-weight: bold; background: #f5f5f5;">Bill To:</div>
          <div style="padding: 10px;">
            <strong>${data.client_name || ''}</strong><br>
            ${data.client_address ? data.client_address.replace(/\n/g, '<br>') : ''}
            ${data.client_email ? `<br>Email: ${data.client_email}` : ''}
            ${data.client_phone ? `<br>Phone: ${data.client_phone}` : ''}
          </div>
        </td>
        <td style="border: 1px solid #000; padding: 0; vertical-align: top; width: 50%;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px; font-weight: bold; background: #f5f5f5;">Invoice No.</td>
              <td style="border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 8px;">${data.invoice_number || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px; font-weight: bold;">Invoice Date</td>
              <td style="border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 8px;">${formatDate(data.created_at)}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px; font-weight: bold;">Due Date</td>
              <td style="border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 8px;">${formatDate(data.due_date)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Status</td>
              <td style="border-left: 1px solid #000; padding: 8px;">${(data.status || 'draft').toUpperCase()}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Items Table -->
    <table style="width: 100%; border: 2px solid #000; border-collapse: collapse; margin-bottom: 20px;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 50px;">Sr.</th>
          <th style="border: 1px solid #000; padding: 10px; text-align: left;">Description</th>
          <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 60px;">Qty</th>
          <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 100px;">Rate</th>
          <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 100px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHTML}
      </tbody>
    </table>

    <!-- Totals Section -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="width: 60%; vertical-align: top; padding-right: 20px;">
          <div style="border: 2px solid #000; padding: 10px;">
            <div style="font-weight: bold; margin-bottom: 5px;">Amount in Words:</div>
            <div style="font-style: italic;">${amountInWords}</div>
          </div>
        </td>
        <td style="width: 40%; vertical-align: top;">
          <table style="width: 100%; border: 2px solid #000; border-collapse: collapse;">
            <tr>
              <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Subtotal</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(subtotal)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">GST @ ${taxRate}%</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(taxAmount)}</td>
            </tr>
            ${discount > 0 ? `
            <tr>
              <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Discount</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; color: green;">- ${formatCurrency(discount)}</td>
            </tr>
            ` : ''}
            <tr style="background: #f5f5f5;">
              <td style="border: 1px solid #000; padding: 10px; font-weight: bold; font-size: 12px;">Total</td>
              <td style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold; font-size: 12px;">${formatCurrency(total)}</td>
            </tr>
            ${amountPaid > 0 ? `
            <tr>
              <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Amount Paid</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; color: green;">${formatCurrency(amountPaid)}</td>
            </tr>
            <tr style="background: #fff3cd;">
              <td style="border: 1px solid #000; padding: 8px; font-weight: bold;">Balance Due</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; color: #dc2626;">${formatCurrency(balanceDue)}</td>
            </tr>
            ` : ''}
          </table>
        </td>
      </tr>
    </table>

    <!-- Bank Details -->
    <table style="width: 100%; border: 2px solid #000; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="border: 1px solid #000; padding: 0; width: 50%;">
          <div style="padding: 8px; font-weight: bold; background: #f5f5f5; border-bottom: 1px solid #000;">Bank Details:</div>
          <div style="padding: 10px; font-size: 10px; line-height: 1.6;">
            <strong>Bank Name:</strong> HDFC Bank<br>
            <strong>Account Name:</strong> Accent Techno Solutions Pvt. Ltd.<br>
            <strong>Account No:</strong> 50200012345678<br>
            <strong>IFSC Code:</strong> HDFC0001234<br>
            <strong>Branch:</strong> Mumbai
          </div>
        </td>
        <td style="border: 1px solid #000; padding: 0; width: 50%;">
          <div style="padding: 8px; font-weight: bold; background: #f5f5f5; border-bottom: 1px solid #000;">Company Details:</div>
          <div style="padding: 10px; font-size: 10px; line-height: 1.6;">
            <strong>GST No:</strong> 27AABCA1234A1Z5<br>
            <strong>PAN No:</strong> AABCA1234A<br>
            <strong>CIN:</strong> U72200MH2020PTC123456
          </div>
        </td>
      </tr>
    </table>

    <!-- Notes & Terms -->
    ${data.notes || data.terms ? `
    <table style="width: 100%; border: 2px solid #000; border-collapse: collapse; margin-bottom: 20px;">
      ${data.notes ? `
      <tr>
        <td style="border: 1px solid #000; padding: 0;">
          <div style="padding: 8px; font-weight: bold; background: #f5f5f5; border-bottom: 1px solid #000;">Notes:</div>
          <div style="padding: 10px; white-space: pre-wrap;">${data.notes}</div>
        </td>
      </tr>
      ` : ''}
      ${data.terms ? `
      <tr>
        <td style="border: 1px solid #000; padding: 0;">
          <div style="padding: 8px; font-weight: bold; background: #f5f5f5; border-bottom: 1px solid #000;">Terms & Conditions:</div>
          <div style="padding: 10px; white-space: pre-wrap; font-size: 10px;">${data.terms}</div>
        </td>
      </tr>
      ` : ''}
    </table>
    ` : ''}

    <!-- Signature Section -->
    <table style="width: 100%; border: 2px solid #000; border-collapse: collapse;">
      <tr>
        <td style="width: 50%; border: 1px solid #000; padding: 15px; vertical-align: top;">
          <div style="font-size: 11px;">Receiver's Signature with Company Seal</div>
          <div style="height: 60px;"></div>
        </td>
        <td style="width: 50%; border: 1px solid #000; padding: 15px; vertical-align: top;">
          <div style="font-weight: bold;">For Accent Techno Solutions Private Limited</div>
          <div style="height: 40px;"></div>
          <div style="font-weight: bold;">Authorized Signatory</div>
        </td>
      </tr>
    </table>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #ccc; font-size: 10px; color: #666;">
      <p>Thank you for your business!</p>
      <p style="margin-top: 5px;">This is a computer-generated invoice and does not require a signature.</p>
    </div>
  </div>
  
  <button class="print-button no-print" onclick="window.print()">
    Print / Save as PDF
  </button>
</body>
</html>
  `;
}

// GET - Download invoice as printable HTML
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
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

    const invoice = invoices[0];

    // Generate HTML
    const html = generateInvoiceHTML(invoice);

    // Return as HTML response
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('Error downloading invoice:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to download invoice', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
