import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    console.log('PDF Export request for ID:', id);

    if (!id) {
      return NextResponse.json({ error: 'Proposal ID is required' }, { status: 400 });
    }

    const pool = await dbConnect();

    // First, let's check if any proposals exist
    const [allRows] = await pool.execute('SELECT id FROM proposals LIMIT 10');
    console.log('Available proposal IDs:', allRows.map(r => r.id));

    const [rows] = await pool.execute('SELECT * FROM proposals WHERE id = ? LIMIT 1', [id]);

    if (!rows || rows.length === 0) {
      console.log('Proposal not found with ID:', id);

      // If no proposal found, let's create a demo proposal for testing
      const demoProposal = {
        id: id,
        proposal_id: `DEMO-${id}`,
        proposal_title: 'Demo Software Development Project',
        client_name: 'Demo Client Company',
        contact_name: 'John Doe',
        description: 'Development of custom software solution including web application and mobile app',
        proposal_value: 250000,
        currency: 'INR',
        status: 'DRAFT',
        enquiry_no: 'ENQ-2024-001',
        enquiry_date: '2024-01-15',
        list_of_deliverables: JSON.stringify([
          'Web Application Development',
          'Mobile Application (iOS & Android)',
          'Database Design & Implementation',
          'Testing & Quality Assurance',
          'Documentation & Training'
        ])
      };

      console.log('Using demo proposal for PDF generation');
      const pdfHTML = generateProposalPDF(demoProposal);

      return new NextResponse(pdfHTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="quotation-demo-${id}.html"`
        }
      });
    }

    const proposal = rows[0];
    console.log('Found proposal:', proposal.proposal_title || proposal.title);

    // Generate the PDF HTML content that matches the format in the images
    const pdfHTML = generateProposalPDF(proposal);

    return new NextResponse(pdfHTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="quotation-${proposal.proposal_id || proposal.id}.html"`
      }
    });

  } catch (error) {
    console.error('PDF export error:', error);
    return NextResponse.json({
      error: 'Failed to export PDF',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}
function generateProposalPDF(proposal) {
  const currentDate = new Date().toLocaleDateString('en-GB');

  // Parse work items if they exist
  let workItems = [];
  try {
    if (proposal.list_of_deliverables) {
      const deliverables = typeof proposal.list_of_deliverables === 'string'
        ? JSON.parse(proposal.list_of_deliverables)
        : proposal.list_of_deliverables;

      if (Array.isArray(deliverables)) {
        workItems = deliverables.map((item, index) => ({
          srNo: index + 1,
          scope: typeof item === 'string' ? item : item.description || item.name || 'Work Item',
          qty: item.quantity || 1,
          rate: item.rate || (proposal.proposal_value || proposal.value || 0) / deliverables.length,
          amount: item.amount || ((proposal.proposal_value || proposal.value || 0) / deliverables.length)
        }));
      }
    }

    // If no work items, create a default one
    if (workItems.length === 0) {
      workItems = [{
        srNo: 1,
        scope: proposal.description || proposal.project_description || 'Project Work',
        qty: 1,
        rate: proposal.proposal_value || proposal.value || 0,
        amount: proposal.proposal_value || proposal.value || 0
      }];
    }
  } catch {
    // Fallback if parsing fails
    workItems = [{
      srNo: 1,
      scope: proposal.description || proposal.project_description || 'Project Work',
      qty: 1,
      rate: proposal.proposal_value || proposal.value || 0,
      amount: proposal.proposal_value || proposal.value || 0
    }];
  }

  const totalAmount = workItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  // Convert number to words function
  function numberToWords(num) {
    if (num === 0) return 'Zero';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convertHundreds(n) {
      let result = '';
      if (n >= 100) {
        result += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 20) {
        result += tens[Math.floor(n / 10)] + ' ';
        n %= 10;
      } else if (n >= 10) {
        result += teens[n - 10] + ' ';
        return result;
      }
      if (n > 0) {
        result += ones[n] + ' ';
      }
      return result;
    }

    const crores = Math.floor(num / 10000000);
    const lakhs = Math.floor((num % 10000000) / 100000);
    const thousandsNum = Math.floor((num % 100000) / 1000);
    const hundreds = num % 1000;

    let result = '';
    if (crores > 0) result += convertHundreds(crores) + 'Crore ';
    if (lakhs > 0) result += convertHundreds(lakhs) + 'Lakh ';
    if (thousandsNum > 0) result += convertHundreds(thousandsNum) + 'Thousand ';
    if (hundreds > 0) result += convertHundreds(hundreds);

    return result.trim();
  }

  const amountInWords = numberToWords(Math.floor(totalAmount)) + ' Only';

  // Format currency with Indian numbering system
  function formatCurrency(amount) {
    if (typeof amount !== 'number') return amount;
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Quotation - ${proposal.proposal_id || proposal.id}</title>
    <style>
        @page {
            size: A4;
            margin: 15mm 20mm;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 11px;
            line-height: 1.5;
            margin: 0;
            padding: 0;
            color: #1a1a1a;
            background: #f8f9fa;
        }

        .container {
            width: 100%;
            max-width: 210mm;
            margin: 0 auto;
            background: white;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
            padding: 20px;
        }

        .header {
            display: flex;
            align-items: center;
            padding: 15px 20px;
            border-bottom: 3px solid #64126D;
            background: linear-gradient(135deg, #ffffff 0%, #f8f5fa 100%);
            margin-bottom: 20px;
        }

        .logo {
            width: 100px;
            height: 70px;
            margin-right: 25px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #64126D;
            border-radius: 8px;
            padding: 10px;
        }

        .logo svg {
            width: 100%;
            height: 100%;
        }

        .annexure {
            flex: 1;
            text-align: center;
        }

        .annexure h1 {
            margin: 0;
            font-size: 18px;
            font-weight: 700;
            color: #64126D;
            letter-spacing: 1px;
            text-transform: uppercase;
        }

        .info-grid {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .info-row {
            border-bottom: 1px solid #e0e0e0;
        }

        .info-cell {
            border: 1px solid #e0e0e0;
            padding: 10px 12px;
            vertical-align: top;
        }

        .info-cell.label {
            background: linear-gradient(135deg, #f8f5fa 0%, #f0e8f5 100%);
            font-weight: 600;
            width: 25%;
            color: #64126D;
            font-size: 10.5px;
        }

        .info-cell.value {
            width: 25%;
            color: #333;
            font-weight: 500;
        }

        .work-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 0;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .work-table th,
        .work-table td {
            border: 1px solid #e0e0e0;
            padding: 12px 10px;
            text-align: left;
        }

        .work-table th {
            background: linear-gradient(135deg, #64126D 0%, #7a1a8a 100%);
            color: white;
            font-weight: 600;
            text-align: center;
            font-size: 10.5px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }

        .work-table tbody tr {
            transition: background-color 0.2s;
        }

        .work-table tbody tr:nth-child(even) {
            background: #fafafa;
        }

        .work-table tbody tr:hover {
            background: #f0e8f5;
        }

        .work-table .number {
            text-align: center;
            width: 8%;
            font-weight: 600;
            color: #64126D;
        }

        .work-table .scope {
            width: 50%;
            padding-left: 15px;
        }

        .work-table .qty {
            text-align: center;
            width: 10%;
        }

        .work-table .rate {
            text-align: right;
            width: 16%;
            font-weight: 500;
            font-family: 'Courier New', monospace;
        }

        .work-table .amount {
            text-align: right;
            width: 16%;
            font-weight: 600;
            color: #64126D;
            font-family: 'Courier New', monospace;
        }

        .amount-row {
            border: 2px solid #64126D;
            padding: 12px 15px;
            background: linear-gradient(135deg, #f8f5fa 0%, #f0e8f5 100%);
            font-weight: 600;
            margin-bottom: 15px;
            border-radius: 4px;
        }

        .amount-row strong {
            color: #64126D;
            font-size: 11.5px;
        }

        .registration-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .registration-table td {
            border: 1px solid #e0e0e0;
            padding: 12px;
            text-align: center;
            width: 33.33%;
        }

        .registration-table tr:first-child td {
            background: linear-gradient(135deg, #64126D 0%, #7a1a8a 100%);
            color: white;
            font-weight: 600;
            font-size: 10.5px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }

        .registration-table tr:last-child td {
            font-weight: 500;
            font-family: 'Courier New', monospace;
            color: #333;
        }

        .terms-section {
            border: 2px solid #e0e0e0;
            padding: 20px;
            margin-top: 20px;
            background: #fafafa;
            border-radius: 4px;
            border-left: 4px solid #64126D;
        }

        .terms-title {
            font-weight: 700;
            margin-bottom: 12px;
            color: #64126D;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .terms-list {
            margin: 0;
            padding-left: 20px;
        }

        .terms-list li {
            margin-bottom: 8px;
            line-height: 1.6;
            color: #444;
        }

        .signature-section {
            width: 100%;
            border-collapse: collapse;
            margin-top: 30px;
            border: 2px solid #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
        }

        .signature-left {
            width: 50%;
            padding: 20px;
            border-right: 2px solid #e0e0e0;
            background: #fafafa;
        }

        .signature-right {
            width: 50%;
            padding: 20px;
            text-align: right;
            background: white;
        }

        .signature-right .company-name {
            font-weight: 700;
            margin-bottom: 50px;
            color: #64126D;
            font-size: 11.5px;
        }

        .signature-right .director {
            font-weight: 700;
            color: #333;
            font-size: 11.5px;
            margin-top: 10px;
        }

        .signature-left div {
            font-weight: 600;
            color: #333;
            font-size: 11px;
        }

        .footer-note {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            font-size: 9px;
            color: #666;
            font-style: italic;
        }

        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .container {
                box-shadow: none;
                padding: 15px;
            }
            .work-table tbody tr:hover {
                background: #fafafa;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header Section -->
        <div class="header">
            <div class="logo">
                <!-- Accent Logo SVG -->
                <svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
                    <rect width="100" height="60" rx="4" fill="white"/>
                    <circle cx="30" cy="30" r="12" fill="white"/>
                    <text x="50" y="22" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="white">ACCENT</text>
                    <text x="50" y="35" font-family="Arial, sans-serif" font-size="7" fill="white">TECHNO</text>
                    <text x="50" y="45" font-family="Arial, sans-serif" font-size="7" fill="white">SOLUTIONS</text>
                </svg>
            </div>
            <div class="annexure">
                <h1>ANNEXURE – I</h1>
            </div>
        </div>

        <!-- Info Grid Section -->
        <table class="info-grid">
            <tr class="info-row">
                <td class="info-cell label">To,</td>
                <td class="info-cell value" style="width: 35%;">${proposal.client_name || proposal.client || ''}</td>
                <td class="info-cell label">Quotation No.</td>
                <td class="info-cell value">${proposal.proposal_id || proposal.id || ''}</td>
            </tr>
            <tr class="info-row">
                <td class="info-cell label" style="height: 60px;"></td>
                <td class="info-cell value" style="height: 60px;"></td>
                <td class="info-cell label">Date of Quotation</td>
                <td class="info-cell value">${currentDate}</td>
            </tr>
            <tr class="info-row">
                <td class="info-cell label"></td>
                <td class="info-cell value"></td>
                <td class="info-cell label">Enquiry No.</td>
                <td class="info-cell value">${proposal.enquiry_no || ''}</td>
            </tr>
            <tr class="info-row">
                <td class="info-cell label"></td>
                <td class="info-cell value"></td>
                <td class="info-cell label">Date of Enquiry</td>
                <td class="info-cell value">${proposal.enquiry_date || ''}</td>
            </tr>
            <tr class="info-row">
                <td class="info-cell label">Kind Attn:</td>
                <td class="info-cell value" colspan="3">${proposal.contact_name || proposal.client_contact_details || ''}</td>
            </tr>
        </table>

        <!-- Work Items Table -->
        <table class="work-table">
            <thead>
                <tr>
                    <th class="number">Sr. No.</th>
                    <th class="scope">Scope of the Work</th>
                    <th class="qty">Qty.</th>
                    <th class="rate">Rate</th>
                    <th class="amount">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${workItems.map(item => `
                    <tr>
                        <td class="number">${item.srNo}</td>
                        <td class="scope">${item.scope}</td>
                        <td class="qty">${item.qty}</td>
                        <td class="rate">₹ ${formatCurrency(typeof item.rate === 'number' ? item.rate : parseFloat(item.rate) || 0)}</td>
                        <td class="amount">₹ ${formatCurrency(typeof item.amount === 'number' ? item.amount : parseFloat(item.amount) || 0)}</td>
                    </tr>
                `).join('')}
                <!-- Add empty rows to match the format -->
                ${Array(Math.max(0, 8 - workItems.length)).fill(0).map(() => `
                    <tr>
                        <td class="number">&nbsp;</td>
                        <td class="scope">&nbsp;</td>
                        <td class="qty">&nbsp;</td>
                        <td class="rate">&nbsp;</td>
                        <td class="amount">&nbsp;</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- Amount in Words -->
        <div class="amount-row">
            <strong>Amount in words:</strong> ${amountInWords} <span style="float: right; color: #64126D; font-size: 12px;">₹ ${formatCurrency(totalAmount)}</span>
        </div>

        <!-- Registration Details Table -->
        <table class="registration-table">
            <tr>
                <td><strong>GST Number</strong></td>
                <td><strong>Pan Number</strong></td>
                <td><strong>Tan Number</strong></td>
            </tr>
            <tr>
                <td>${proposal.gst_number || '27AAFCA9766G1ZE'}</td>
                <td>${proposal.pan_number || 'AAFCA9766G'}</td>
                <td>${proposal.tan_number || 'MUMA30082D'}</td>
            </tr>
        </table>

        <!-- Terms and Conditions -->
        <div class="terms-section">
            <div class="terms-title">General Terms and conditions</div>
            <ul class="terms-list">
                <li>Any additional work will be charged extra</li>
                <li>GST 18% extra as applicable on total project cost.</li>
                <li>The proposal is based on client's enquiry and provided input data</li>
                <li>Work will start within 15 days after receipt of confirmed LOI/PO.</li>
                <li>Mode of Payments: - Through Wire transfer to 'Accent Techno Solutions Pvt Ltd.' payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244</li>
            </ul>

            <div style="margin-top: 20px;">
                <div class="terms-title" style="margin-bottom: 15px;">12) Other Terms & Conditions:</div>
                <div style="margin-left: 15px;">
                    <div style="margin-bottom: 12px;">
                        <strong style="color: #64126D; font-size: 11px;">12.1 Confidentiality</strong>
                        <div style="margin-left: 15px; margin-top: 5px; line-height: 1.7; color: #444;">
                            Input, output & any excerpts in between are intellectual properties of client. ATS shall not voluntarily disclose any of such information to third parties & will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information. ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across. ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.
                        </div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <strong style="color: #64126D; font-size: 11px;">12.2 Codes and Standards:</strong>
                        <div style="margin-left: 15px; margin-top: 5px; line-height: 1.7; color: #444;">
                            Basic Engineering/ Detail Engineering should be carried out in ATS's office as per good engineering practices, project specifications and applicable client's inputs, Indian and International Standards
                        </div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <strong style="color: #64126D; font-size: 11px;">12.3 Dispute Resolution</strong>
                        <div style="margin-left: 15px; margin-top: 5px; line-height: 1.7; color: #444;">
                            Should any disputes arise as claimed breach of the contract originated by this offer, it shall be finally settled amicably. Framework shall be the essence of this contract.
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                <p style="margin: 8px 0; line-height: 1.7; color: #444;">
                    We trust you will find our offer in line with your requirement, and we shall look forward to receiving your valued work order.
                </p>
                <p style="margin: 8px 0; line-height: 1.7; color: #444;">
                    Thanking you and always assuring you of our best services.
                </p>
                <div style="margin-top: 15px; font-weight: 700; color: #64126D; font-size: 11.5px;">
                    For Accent Techno Solutions Private Limited.
                </div>
            </div>
        </div>

        <!-- Signature Section -->
        <table class="signature-section">
            <tr>
                <td class="signature-left">
                    <div style="font-weight: bold;">Receivers Signature with Company Seal.</div>
                </td>
                <td class="signature-right">
                    <div class="company-name">For Accent Techno Solutions Private Limited</div>
                    <div style="margin-bottom: 10px;">&nbsp;</div>
                    <div style="margin-bottom: 10px;">&nbsp;</div>
                    <div class="director">Santosh Dinkar Mistry</div>
                    <div>Director</div>
                </td>
            </tr>
        </table>

        <!-- Footer Note -->
        <div class="footer-note">
            This is a system-generated document. For any queries, please contact us at info@accenttechno.com
        </div>
    </div>

    <script>
        // Auto-print when loaded for PDF generation
        window.onload = function() {
            if (window.location.search.includes('print=true')) {
                setTimeout(() => window.print(), 500);
            }
        };
    </script>
</body>
</html>`;
}
