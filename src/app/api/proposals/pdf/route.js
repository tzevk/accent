import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer';
import fs from 'fs';
import path from 'path';

// Ensure Node.js runtime for fs operations
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const exportAll = url.searchParams.get('all') === 'true';
    
    console.log('PDF Generation request - ID:', id, 'All:', exportAll);
    
    const pool = await dbConnect();
    let proposals = [];
    
    if (exportAll) {
      // Fetch all proposals
      const [rows] = await pool.execute('SELECT * FROM proposals ORDER BY created_at DESC');
      proposals = rows;
      console.log(`Exporting all proposals: ${proposals.length} total`);
    } else {
      if (!id) {
        await pool.end();
        return NextResponse.json({ error: 'Proposal ID is required' }, { status: 400 });
      }
      
      const [rows] = await pool.execute('SELECT * FROM proposals WHERE id = ? LIMIT 1', [id]);
      
      if (!rows || rows.length === 0) {
        await pool.end();
        return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
      }
      
      proposals = [rows[0]];
      console.log('Found proposal:', proposals[0].proposal_title || proposals[0].title);
    }
    
    await pool.end();

    // Generate the PDF document with all proposals
    const pdfDoc = createPDFDocument(proposals);
    
    // Generate PDF buffer
    const pdfBuffer = await pdf(pdfDoc).toBuffer();
    
    const filename = exportAll 
      ? `all_proposals_${new Date().toISOString().split('T')[0]}.pdf`
      : `quotation_${proposals[0].proposal_id || proposals[0].id}_${new Date().toISOString().split('T')[0]}.pdf`;

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ 
      error: 'Failed to generate PDF', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// Professional quotation PDF styles
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    padding: 0,
    lineHeight: 1.2,
  },
  container: {
    borderWidth: 2,
    borderColor: '#000',
    margin: 15,
  },
  header: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 70,
  },
  logoSection: {
    width: 100,
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoBox: {
    width: 80,
    height: 50,
    borderWidth: 1,
    borderColor: '#64126D',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 5,
  },
  logoImage: {
    width: 70,
    height: 40,
    objectFit: 'contain',
  },
  logoText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#64126D',
    textAlign: 'center',
  },
  annexureSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  annexureTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    textDecoration: 'underline',
  },
  infoGrid: {
  },
  infoRow: {
    flexDirection: 'row',
    minHeight: 25,
  },
  infoCell: {
    borderRightWidth: 1,
    borderRightColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    padding: 6,
    justifyContent: 'center',
    minHeight: 25,
  },
  infoCellLabel: {
    backgroundColor: '#f8f9fa',
    fontWeight: 'bold',
    width: '25%',
  },
  infoCellValue: {
    width: '25%',
  },
  infoCellLarge: {
    width: '75%',
  },
  workTableContainer: {
    marginTop: 0,
  },
  workTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  workTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    minHeight: 25,
  },
  workCellSrNo: {
    width: '10%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    padding: 6,
    textAlign: 'center',
    justifyContent: 'center',
  },
  workCellScope: {
    width: '50%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    padding: 6,
    justifyContent: 'center',
  },
  workCellQty: {
    width: '10%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    padding: 6,
    textAlign: 'center',
    justifyContent: 'center',
  },
  workCellRate: {
    width: '15%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    padding: 6,
    textAlign: 'right',
    justifyContent: 'center',
  },
  workCellAmount: {
    width: '15%',
    padding: 6,
    textAlign: 'right',
    justifyContent: 'center',
  },
  headerText: {
    fontWeight: 'bold',
    fontSize: 10,
  },
  amountInWordsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    padding: 8,
    backgroundColor: '#ffffff',
  },
  amountWordsLeft: {
    flex: 1,
  },
  amountWordsRight: {
    width: 150,
    textAlign: 'right',
    fontWeight: 'bold',
  },
  termsSection: {
    borderWidth: 1,
    borderColor: '#000',
    padding: 10,
    marginTop: 8,
  },
  termsTitle: {
    fontWeight: 'bold',
    fontSize: 11,
    marginBottom: 6,
  },
  termsText: {
    fontSize: 10,
    marginBottom: 3,
    lineHeight: 1.4,
  },
  signatureSection: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#000',
    marginTop: 10,
    minHeight: 80,
  },
  signatureLeft: {
    width: '50%',
    borderRightWidth: 1,
    borderRightColor: '#000',
    padding: 10,
    justifyContent: 'flex-start',
  },
  signatureRight: {
    width: '50%',
    padding: 10,
    alignItems: 'flex-end',
  },
  signatureCompany: {
    fontWeight: 'bold',
    marginBottom: 25,
    textAlign: 'right',
  },
  signatureName: {
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: 15,
  },
  signatureTitle: {
    textAlign: 'right',
    fontSize: 10,
  },
});

function createPDFDocument(proposals) {
  // Handle both single proposal and array of proposals
  const proposalArray = Array.isArray(proposals) ? proposals : [proposals];
  const currentDate = new Date().toLocaleDateString('en-GB');
  
  // Load logo as base64
  const logoPath = path.join(process.cwd(), 'public', 'accent-logo.png');
  let logoBase64 = '';
  try {
    const logoBuffer = fs.readFileSync(logoPath);
    logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch (error) {
    console.error('Error loading logo:', error);
  }

  return (
    <Document>
      {proposalArray.map((proposal, index) => (
        <ProposalPage 
          key={index} 
          proposal={proposal} 
          currentDate={currentDate}
          logoBase64={logoBase64}
        />
      ))}
    </Document>
  );
}

function ProposalPage({ proposal, currentDate, logoBase64 }) {
  // Parse work items
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
    
    if (workItems.length === 0) {
      workItems = [{
        srNo: 1,
        scope: proposal.description || proposal.proposal_title || 'Services as per requirements',
        qty: 1,
        rate: proposal.proposal_value || proposal.value || 0,
        amount: proposal.proposal_value || proposal.value || 0
      }];
    }
  } catch (e) {
    console.error('Error parsing deliverables:', e);
    workItems = [{
      srNo: 1,
      scope: proposal.description || 'Services as per requirements',
      qty: 1,
      rate: proposal.proposal_value || proposal.value || 0,
      amount: proposal.proposal_value || proposal.value || 0
    }];
  }

  const totalAmount = workItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  // Number to words conversion
  function numberToWords(num) {
    if (num === 0) return 'Zero';
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function convertHundreds(n) {
      if (n === 0) return '';
      if (n < 10) return ones[n];
      if (n < 20) return teens[n - 10];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertHundreds(n % 100) : '');
    }
    
    const crores = Math.floor(num / 10000000);
    const lakhs = Math.floor((num % 10000000) / 100000);
    const thousands = Math.floor((num % 100000) / 1000);
    const hundreds = num % 1000;
    
    let result = '';
    if (crores > 0) result += convertHundreds(crores) + ' Crore ';
    if (lakhs > 0) result += convertHundreds(lakhs) + ' Lakh ';
    if (thousands > 0) result += convertHundreds(thousands) + ' Thousand ';
    if (hundreds > 0) result += convertHundreds(hundreds);
    
    return result.trim();
  }

  const amountInWords = numberToWords(Math.floor(totalAmount)) + ' Only';

  return (
    <Page size="A4" style={styles.page}>
        <View style={styles.container}>
          {/* Header Section */}
          <View style={styles.header}>
            <View style={styles.logoSection}>
              <View style={styles.logoBox}>
                {logoBase64 ? (
                  <Image 
                    src={logoBase64}
                    style={styles.logoImage}
                    alt="Accent Techno Solutions Logo"
                  />
                ) : (
                  <Text style={styles.logoText}>ACCENT{'\n'}TECHNO SOLUTIONS</Text>
                )}
              </View>
            </View>
            <View style={styles.annexureSection}>
              <Text style={styles.annexureTitle}>ANNEXURE – I</Text>
            </View>
          </View>

          {/* Client Information Grid */}
          <View style={styles.infoGrid}>
            {/* Row 1: To, Client Name, Quotation No. */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>To,</Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLarge]}>
                <Text>{proposal.client_name || proposal.client || ''}</Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Quotation No.</Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellValue]}>
                <Text>{proposal.proposal_id || proposal.id || ''}</Text>
              </View>
            </View>

            {/* Row 2: Empty, Empty, Date of Quotation */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel, { minHeight: 40 }]}>
                <Text> </Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLarge, { minHeight: 40 }]}>
                <Text> </Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Date of Quotation</Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellValue]}>
                <Text>{currentDate}</Text>
              </View>
            </View>

            {/* Row 3: Subject */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Subject:</Text>
              </View>
              <View style={[styles.infoCell, { width: '75%', borderRight: 0 }]}>
                <Text>{proposal.proposal_title || proposal.title || 'Quotation'}</Text>
              </View>
            </View>

            {/* Row 4: Kind Attention */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Kind Attention:</Text>
              </View>
              <View style={[styles.infoCell, { width: '75%', borderRight: 0 }]}>
                <Text>{proposal.contact_name || ''}</Text>
              </View>
            </View>
          </View>

          {/* Work Scope Table */}
          <View style={styles.workTableContainer}>
            {/* Header */}
            <View style={styles.workTableHeader}>
              <View style={styles.workCellSrNo}>
                <Text style={styles.headerText}>Sr. No.</Text>
              </View>
              <View style={styles.workCellScope}>
                <Text style={styles.headerText}>Scope of Work</Text>
              </View>
              <View style={styles.workCellQty}>
                <Text style={styles.headerText}>Qty</Text>
              </View>
              <View style={styles.workCellRate}>
                <Text style={styles.headerText}>Rate</Text>
              </View>
              <View style={styles.workCellAmount}>
                <Text style={styles.headerText}>Amount (₹)</Text>
              </View>
            </View>

            {/* Work Items */}
            {workItems.map((item, index) => (
              <View key={index} style={styles.workTableRow}>
                <View style={styles.workCellSrNo}>
                  <Text>{item.srNo}</Text>
                </View>
                <View style={styles.workCellScope}>
                  <Text>{item.scope}</Text>
                </View>
                <View style={styles.workCellQty}>
                  <Text>{item.qty}</Text>
                </View>
                <View style={styles.workCellRate}>
                  <Text>{item.rate.toLocaleString('en-IN')}</Text>
                </View>
                <View style={styles.workCellAmount}>
                  <Text>{item.amount.toLocaleString('en-IN')}</Text>
                </View>
              </View>
            ))}

            {/* Total Row */}
            <View style={[styles.workTableRow, { backgroundColor: '#f8f9fa' }]}>
              <View style={[styles.workCellSrNo, { borderBottom: 0 }]}>
                <Text> </Text>
              </View>
              <View style={[styles.workCellScope, { borderBottom: 0 }]}>
                <Text style={styles.headerText}>Total</Text>
              </View>
              <View style={[styles.workCellQty, { borderBottom: 0 }]}>
                <Text> </Text>
              </View>
              <View style={[styles.workCellRate, { borderBottom: 0 }]}>
                <Text> </Text>
              </View>
              <View style={[styles.workCellAmount, { borderBottom: 0 }]}>
                <Text style={styles.headerText}>{totalAmount.toLocaleString('en-IN')}</Text>
              </View>
            </View>

            {/* Amount in Words */}
            <View style={styles.amountInWordsRow}>
              <View style={styles.amountWordsLeft}>
                <Text style={styles.headerText}>Amount in Words:</Text>
                <Text>{amountInWords}</Text>
              </View>
              <View style={styles.amountWordsRight}>
                <Text>Grand Total</Text>
                <Text style={styles.headerText}>₹ {totalAmount.toLocaleString('en-IN')}</Text>
              </View>
            </View>
          </View>

          {/* Terms & Conditions */}
          <View style={styles.termsSection}>
            <Text style={styles.termsTitle}>Terms & Conditions:</Text>
            <Text style={styles.termsText}>• Payment Terms: As per agreement</Text>
            <Text style={styles.termsText}>• Delivery: As per schedule</Text>
            <Text style={styles.termsText}>• Validity: 30 days from the date of quotation</Text>
            <Text style={styles.termsText}>• GST: Extra as applicable</Text>
          </View>

          {/* Signature Section */}
          <View style={styles.signatureSection}>
            <View style={styles.signatureLeft}>
              <Text style={styles.headerText}>Client Acceptance:</Text>
              <Text style={{ fontSize: 9, marginTop: 4 }}>Name & Signature</Text>
            </View>
            <View style={styles.signatureRight}>
              <Text style={styles.signatureCompany}>For ACCENT TECHNO SOLUTIONS</Text>
              <Text style={styles.signatureName}>Authorized Signatory</Text>
              <Text style={styles.signatureTitle}>Director</Text>
            </View>
          </View>
        </View>
      </Page>
  );
}
