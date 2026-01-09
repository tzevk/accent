import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Download quotation as PDF
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const source = searchParams.get('source') || 'project'; // 'project' or 'quotations'

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    connection = await dbConnect();

    let quotationData = null;

    if (source === 'project') {
      // Fetch from project_quotations first
      const [rows] = await connection.execute(`
        SELECT * FROM project_quotations WHERE id = ?
      `, [id]);

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Quotation not found' }, { status: 404 });
      }

      quotationData = rows[0];

      // Try to fetch project details separately
      if (quotationData.project_id) {
        let proposalId = null;
        
        try {
          const [projects] = await connection.execute(
            `SELECT name, client_name, description, company_id, proposal_id,
             scope_of_work, input_document, input_documents, list_of_deliverables, deliverables,
             software_included, duration, site_visit, quotation_validity, mode_of_delivery,
             revision, exclusion, billing_and_payment_terms, other_terms_and_conditions
             FROM projects WHERE id = ? LIMIT 1`,
            [quotationData.project_id]
          );
          if (projects.length > 0) {
            const p = projects[0];
            quotationData.project_name = p.name;
            quotationData.client_name = quotationData.client_name || p.client_name;
            quotationData.project_description = p.description;
            proposalId = p.proposal_id;
            
            // Map project fields to annexure fields if not already set in quotation
            if (!quotationData.annexure_scope_of_work) quotationData.annexure_scope_of_work = p.scope_of_work;
            if (!quotationData.annexure_input_document) quotationData.annexure_input_document = p.input_document || p.input_documents;
            if (!quotationData.annexure_deliverables) quotationData.annexure_deliverables = p.deliverables || p.list_of_deliverables;
            if (!quotationData.annexure_software) quotationData.annexure_software = p.software_included;
            if (!quotationData.annexure_duration) quotationData.annexure_duration = p.duration;
            if (!quotationData.annexure_site_visit) quotationData.annexure_site_visit = p.site_visit;
            if (!quotationData.annexure_quotation_validity) quotationData.annexure_quotation_validity = p.quotation_validity;
            if (!quotationData.annexure_mode_of_delivery) quotationData.annexure_mode_of_delivery = p.mode_of_delivery;
            if (!quotationData.annexure_revision) quotationData.annexure_revision = p.revision;
            if (!quotationData.annexure_exclusions) quotationData.annexure_exclusions = p.exclusion;
            if (!quotationData.annexure_billing_payment_terms) quotationData.annexure_billing_payment_terms = p.billing_and_payment_terms;
            
            // Try to fetch company details
            if (p.company_id) {
              try {
                const [companies] = await connection.execute(
                  'SELECT company_name, address, phone, email, gst_number FROM companies WHERE id = ? LIMIT 1',
                  [p.company_id]
                );
                if (companies.length > 0) {
                  quotationData.company_name = companies[0].company_name;
                  quotationData.company_address = companies[0].address;
                  quotationData.company_phone = companies[0].phone;
                  quotationData.company_email = companies[0].email;
                  quotationData.gst_number = quotationData.gst_number || companies[0].gst_number;
                }
              } catch (compErr) {
                // Companies table might have different structure
              }
            }
          }
        } catch (projErr) {
          // Projects table might have different structure - try simpler query
          try {
            const [projects] = await connection.execute(
              'SELECT name, client_name, description, company_id, proposal_id FROM projects WHERE id = ? LIMIT 1',
              [quotationData.project_id]
            );
            if (projects.length > 0) {
              quotationData.project_name = projects[0].name;
              quotationData.client_name = quotationData.client_name || projects[0].client_name;
              quotationData.project_description = projects[0].description;
              proposalId = projects[0].proposal_id;
            }
          } catch (simpleErr) {
            // Ignore
          }
        }
        
        // Try to fetch from proposals if project has proposal_id
        if (proposalId) {
          try {
            const [proposals] = await connection.execute(
              `SELECT scope_of_work, input_document, input_documents, list_of_deliverables, deliverables,
               software, duration, site_visit, quotation_validity, mode_of_delivery,
               revision, exclusions, billing_payment_terms
               FROM proposals WHERE id = ? LIMIT 1`,
              [proposalId]
            );
            if (proposals.length > 0) {
              const prop = proposals[0];
              // Map proposal fields only if not already set
              if (!quotationData.annexure_scope_of_work) quotationData.annexure_scope_of_work = prop.scope_of_work;
              if (!quotationData.annexure_input_document) quotationData.annexure_input_document = prop.input_document || prop.input_documents;
              if (!quotationData.annexure_deliverables) quotationData.annexure_deliverables = prop.list_of_deliverables || prop.deliverables;
              if (!quotationData.annexure_software) quotationData.annexure_software = prop.software;
              if (!quotationData.annexure_duration) quotationData.annexure_duration = prop.duration;
              if (!quotationData.annexure_site_visit) quotationData.annexure_site_visit = prop.site_visit;
              if (!quotationData.annexure_quotation_validity) quotationData.annexure_quotation_validity = prop.quotation_validity;
              if (!quotationData.annexure_mode_of_delivery) quotationData.annexure_mode_of_delivery = prop.mode_of_delivery;
              if (!quotationData.annexure_revision) quotationData.annexure_revision = prop.revision;
              if (!quotationData.annexure_exclusions) quotationData.annexure_exclusions = prop.exclusions;
              if (!quotationData.annexure_billing_payment_terms) quotationData.annexure_billing_payment_terms = prop.billing_payment_terms;
            }
          } catch (propErr) {
            // Ignore - proposals table might have different structure
          }
        }
      }
    } else {
      // Fetch from quotations table
      const [rows] = await connection.execute('SELECT * FROM quotations WHERE id = ?', [id]);

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Quotation not found' }, { status: 404 });
      }

      quotationData = rows[0];
    }

    // Generate HTML for the quotation PDF
    const html = generateQuotationHTML(quotationData, source);

    // Return HTML that can be printed/saved as PDF
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="${quotationData.quotation_number || 'quotation'}.html"`,
      },
    });

  } catch (error) {
    console.error('Error generating quotation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

function generateQuotationHTML(data, source) {
  const isProjectQuotation = source === 'project';
  
  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
  };

  // Number to words conversion
  const numberToWords = (num) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    if (num === 0) return 'Zero';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numberToWords(num % 100) : '');
    if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '');
    if (num < 10000000) return numberToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + numberToWords(num % 100000) : '');
    return numberToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + numberToWords(num % 10000000) : '');
  };

  const grossAmount = parseFloat(data.gross_amount) || 0;
  const gstPercentage = parseFloat(data.gst_percentage) || 18;
  const gstAmount = parseFloat(data.gst_amount) || 0;
  const netAmount = parseFloat(data.net_amount) || parseFloat(data.total) || 0;

  // Generate amount in words
  const rupees = Math.floor(netAmount);
  const paise = Math.round((netAmount - rupees) * 100);
  let amountInWords = data.amount_in_words || ('Rupees ' + numberToWords(rupees) + (paise > 0 ? ' and ' + numberToWords(paise) + ' Paise' : '') + ' Only');

  // Parse scope items
  let scopeItems = [];
  if (data.scope_items) {
    try {
      scopeItems = typeof data.scope_items === 'string' ? JSON.parse(data.scope_items) : data.scope_items;
    } catch (e) {
      if (data.scope_of_work) {
        scopeItems = [{ sr_no: 1, description: data.scope_of_work, qty: data.enquiry_quantity || '1', rate: grossAmount, amount: grossAmount }];
      }
    }
  } else if (data.scope_of_work) {
    scopeItems = [{ sr_no: 1, description: data.scope_of_work, qty: data.enquiry_quantity || '1', rate: grossAmount, amount: grossAmount }];
  }

  // Calculate total from items if not already set
  const itemsTotal = scopeItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const displayGrossAmount = grossAmount || itemsTotal;

  // Default terms if not set
  const termsAndConditions = data.terms_and_conditions || `• Any additional work will be charged extra.
• GST 18% extra as applicable on total project cost.
• The proposal is based on client's enquiry and provided input data.
• Work will start within 15 days after receipt of confirmed LOI/PO.
• Mode of Payments: - Through Wire transfer to 'Accent Techno Solutions Pvt Ltd.' payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244`;

  // Generate scope items HTML
  const scopeItemsHTML = scopeItems.length > 0 ? scopeItems.map(item => `
    <tr>
      <td style="border: 1px solid #000; padding: 8px; text-align: center; vertical-align: top;">${item.sr_no || ''}</td>
      <td style="border: 1px solid #000; padding: 8px; vertical-align: top; white-space: pre-wrap;">${item.description || ''}</td>
      <td style="border: 1px solid #000; padding: 8px; text-align: center; vertical-align: top;">${item.qty || ''}</td>
      <td style="border: 1px solid #000; padding: 8px; text-align: right; vertical-align: top;">${item.rate ? formatCurrency(item.rate) : ''}</td>
      <td style="border: 1px solid #000; padding: 8px; text-align: right; vertical-align: top;">${item.amount ? formatCurrency(item.amount) : ''}</td>
    </tr>
  `).join('') : `
    <tr>
      <td style="border: 1px solid #000; padding: 6px; text-align: center;">1</td>
      <td style="border: 1px solid #000; padding: 6px;">${data.scope_of_work || data.subject || '-'}</td>
      <td style="border: 1px solid #000; padding: 6px; text-align: center;">${data.enquiry_quantity || '1'}</td>
      <td style="border: 1px solid #000; padding: 6px; text-align: right;">${formatCurrency(displayGrossAmount)}</td>
      <td style="border: 1px solid #000; padding: 6px; text-align: right;">${formatCurrency(displayGrossAmount)}</td>
    </tr>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quotation - ${data.quotation_number || 'Draft'}</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; }
      .no-print { display: none !important; }
      .quotation-page { page-break-after: always; }
      .annexure-page { page-break-before: always; }
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
  <!-- QUOTATION PAGE -->
  <div class="container quotation-page">
    <table style="width: 100%; border: 2px solid #000; border-collapse: collapse;">
      <!-- Header Row -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0; vertical-align: top;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 60%; border-right: 1px solid #000; padding: 8px; vertical-align: top;">
                <strong>To,</strong><br><br>
                <strong>${data.client_name || ''}</strong><br>
                ${data.client_address ? data.client_address.replace(/\n/g, '<br>') : ''}
              </td>
              <td style="width: 40%; padding: 0; vertical-align: top;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="border-bottom: 1px solid #000; padding: 4px 8px; font-weight: bold;">Quotation No.</td>
                    <td style="border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 4px 8px;">${data.quotation_number || ''}</td>
                  </tr>
                  <tr>
                    <td style="border-bottom: 1px solid #000; padding: 4px 8px; font-weight: bold;">Date of Quotation</td>
                    <td style="border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 4px 8px;">${formatDate(data.quotation_date || data.created_at)}</td>
                  </tr>
                  <tr>
                    <td style="border-bottom: 1px solid #000; padding: 4px 8px; font-weight: bold;">Enquiry No.</td>
                    <td style="border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 4px 8px;">${data.enquiry_number || ''}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 8px; font-weight: bold;">Date of Enquiry</td>
                    <td style="border-left: 1px solid #000; padding: 4px 8px;">${formatDate(data.enquiry_date)}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Kind Attn -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 80px; padding: 6px 8px; font-weight: bold; border-right: 1px solid #000;">Kind Attn:</td>
              <td style="padding: 6px 8px;">${data.kind_attn || ''}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Scope of Work Table -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="border: 1px solid #000; padding: 6px; text-align: center; width: 50px; font-weight: bold;">Sr. No.</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold;">Scope of the Work</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center; width: 60px; font-weight: bold;">Qty.</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center; width: 80px; font-weight: bold;">Rate</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center; width: 80px; font-weight: bold;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${scopeItemsHTML}
            </tbody>
          </table>
        </td>
      </tr>

      <!-- Totals -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 70%; padding: 6px 8px; border-right: 1px solid #000;"><strong>Gross Amount:</strong></td>
              <td style="width: 30%; padding: 6px 8px; text-align: right;">${formatCurrency(displayGrossAmount)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 8px; border-right: 1px solid #000; border-top: 1px solid #000;"><strong>GST @ ${gstPercentage}%:</strong></td>
              <td style="padding: 6px 8px; text-align: right; border-top: 1px solid #000;">${formatCurrency(gstAmount || (displayGrossAmount * gstPercentage / 100))}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-right: 1px solid #000; border-top: 1px solid #000;"><strong>Net Amount:</strong></td>
              <td style="padding: 8px; text-align: right; border-top: 1px solid #000; font-weight: bold; font-size: 11px;">${formatCurrency(netAmount || (displayGrossAmount + (displayGrossAmount * gstPercentage / 100)))}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Amount in Words -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 100px; padding: 6px 8px; font-weight: bold; border-right: 1px solid #000;">Amount in words:</td>
              <td style="padding: 6px 8px; font-style: italic;">${amountInWords}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- GST/PAN/TAN -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 33.33%; border-right: 1px solid #000; padding: 0;">
                <div style="padding: 5px; font-weight: bold; border-bottom: 1px solid #000; text-align: center;">GST Number</div>
                <div style="padding: 5px; text-align: center; min-height: 20px;">${data.gst_number || ''}</div>
              </td>
              <td style="width: 33.33%; border-right: 1px solid #000; padding: 0;">
                <div style="padding: 5px; font-weight: bold; border-bottom: 1px solid #000; text-align: center;">Pan Number</div>
                <div style="padding: 5px; text-align: center; min-height: 20px;">${data.pan_number || ''}</div>
              </td>
              <td style="width: 33.33%; padding: 0;">
                <div style="padding: 5px; font-weight: bold; border-bottom: 1px solid #000; text-align: center;">Tan Number</div>
                <div style="padding: 5px; text-align: center; min-height: 20px;">${data.tan_number || ''}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Terms and Conditions -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <div style="padding: 6px 8px; font-weight: bold; border-bottom: 1px solid #000;">General Terms and conditions</div>
          <div style="padding: 8px; white-space: pre-wrap; line-height: 1.4; font-size: 10px;">${termsAndConditions}</div>
        </td>
      </tr>

      <!-- Signature -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 50%; border-right: 1px solid #000; padding: 10px; vertical-align: top;">
                <div style="font-size: 11px;">Receivers Signature with Company Seal.</div>
                <div style="height: 50px;"></div>
              </td>
              <td style="width: 50%; padding: 10px; vertical-align: top;">
                <div style="font-weight: bold;">For Accent Techno Solutions Private Limited</div>
                <div style="height: 30px;"></div>
                <div style="font-weight: bold;">Santosh Dinkar Mestry</div>
                <div style="font-size: 11px;">Director</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
  
  <!-- ANNEXURE PAGE -->
  <div class="container annexure-page" style="padding-top: 20px;">
    <!-- Annexure Header with Logo -->
    <div style="display: flex; align-items: flex-start; margin-bottom: 20px;">
      <img src="/accent-logo.png" alt="Accent Logo" style="height: 50px; margin-right: 20px;" onerror="this.style.display='none'"/>
      <div style="flex: 1; text-align: center;">
        <div style="font-weight: bold; text-decoration: underline; font-size: 14px;">ANNEXURE – I</div>
      </div>
    </div>
    
    <!-- Annexure Content -->
    <div style="font-size: 11px; line-height: 1.5;">
      <div style="margin-bottom: 12px;">
        <strong>1) Scope of Work:</strong>
        <div style="margin-left: 18px; white-space: pre-wrap;">${data.annexure_scope_of_work || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>2) Input Document:</strong>
        <div style="margin-left: 18px; white-space: pre-wrap;">${data.annexure_input_document || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>3) Deliverables:</strong>
        <div style="margin-left: 18px; white-space: pre-wrap;">${data.annexure_deliverables || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>4) Software:</strong>
        <div style="margin-left: 18px;">${data.annexure_software || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>5) Duration:</strong>
        <div style="margin-left: 18px;">${data.annexure_duration || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>6) Site Visit:</strong>
        <div style="margin-left: 18px;">${data.annexure_site_visit || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>7) Quotation Validity:</strong>
        <div style="margin-left: 18px;">${data.annexure_quotation_validity || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>8) Mode of Delivery:</strong>
        <div style="margin-left: 18px;">${data.annexure_mode_of_delivery || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>9) Revision:</strong>
        <div style="margin-left: 18px;">${data.annexure_revision || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>10) Exclusions:</strong>
        <div style="margin-left: 18px; white-space: pre-wrap;">${data.annexure_exclusions || ''}</div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>11) Billing & Payment terms:</strong>
        <div style="margin-left: 18px;">
          <strong style="text-decoration: underline;">Payment terms:</strong>
          <div style="white-space: pre-wrap; font-size: 10px;">${data.annexure_billing_payment_terms || `• Payment shall be released by the client within 7 days from the date of the invoice.
• Payment shall be by way of RTGS transfer to ATSPL bank account.
• The late payment charges will be 2% per month on the total bill amount if bills are not settled within the credit period of 30 days.
• In case of project delays beyond two-month, software cost of ₹10,000/- per month will be charged.
• Upon completion of the above scope of work, if a project is cancelled or held by the client for any reason then Accent Techno Solutions Private Limited is entitled to 100% invoice against the completed work.`}</div>
        </div>
      </div>
      
      <div style="margin-bottom: 12px;">
        <strong>12) Other Terms & conditions:</strong>
        
        <div style="margin-left: 18px; margin-top: 8px;">
          <strong>12.1 Confidentiality:</strong>
          <div style="white-space: pre-wrap; font-size: 10px;">${data.annexure_confidentiality || `• Input, output & any excerpts in between are intellectual properties of client. ATS shall not voluntarily disclose any of such documents to third parties& will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information. ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across. ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.`}</div>
        </div>
        
        <div style="margin-left: 18px; margin-top: 8px;">
          <strong>12.2 Codes and Standards:</strong>
          <div style="white-space: pre-wrap; font-size: 10px;">${data.annexure_codes_standards || `• Basic Engineering/ Detail Engineering should be carried out in ATS's office as per good engineering practices, project specifications and applicable client's inputs, Indian and International Standards`}</div>
        </div>
        
        <div style="margin-left: 18px; margin-top: 8px;">
          <strong>12.3 Dispute Resolution:</strong>
          <div style="white-space: pre-wrap; font-size: 10px;">${data.annexure_dispute_resolution || `• Should any disputes arise as claimed breach of the contract originated by this offer, it shall be finally settled amicably. Teamwork shall be the essence of this contract.`}</div>
        </div>
      </div>
      
      <!-- Closing Text -->
      <div style="margin-top: 20px; line-height: 1.6;">
        <p>We trust you will find our offer in line with your requirement, and we shall look forward to receiving your valued work order.</p>
        <p style="margin-top: 8px;">Thanking you and always assuring you of our best services.</p>
      </div>
      
      <!-- Annexure Signature -->
      <div style="margin-top: 30px;">
        <p style="font-weight: bold;">For Accent Techno Solutions Private Limited.</p>
        <div style="height: 50px;"></div>
        <p style="font-weight: bold;">Santosh Dinkar Mestry</p>
        <p>Director</p>
      </div>
    </div>
  </div>
  
  <button class="print-button no-print" onclick="window.print()">
    Print / Save as PDF
  </button>
</body>
</html>
  `;
}
