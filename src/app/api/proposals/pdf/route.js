import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer';
import fs from 'fs';
import path from 'path';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    
    console.log('PDF Generation request for ID:', id);
    
    if (!id) {
      return NextResponse.json({ error: 'Proposal ID is required' }, { status: 400 });
    }

    const pool = await dbConnect();
    
    // First, let's check if any proposals exist
    const [allRows] = await pool.execute('SELECT id FROM proposals LIMIT 10');
    console.log('Available proposal IDs:', allRows.map(r => r.id));
    
    // Handle "all" case - just use the first proposal for now
    const actualId = id === 'all' ? (allRows.length > 0 ? allRows[0].id : '1') : id;
    
    const [rows] = await pool.execute('SELECT * FROM proposals WHERE id = ? LIMIT 1', [actualId]);
    
    let proposal;
    
    if (!rows || rows.length === 0) {
      console.log('Proposal not found with ID:', id);
      
      // If no proposal found, let's create a demo proposal for testing
      proposal = {
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
    } else {
      proposal = rows[0];
      console.log('Found proposal:', proposal.proposal_title || proposal.title);
    }

    // Generate the PDF document
    const pdfDoc = createPDFDocument(proposal);
    
    // Generate PDF buffer
    const pdfBuffer = await pdf(pdfDoc).toBuffer();
    
    const filename = `quotation_${proposal.proposal_id || proposal.id}_${new Date().toISOString().split('T')[0]}.pdf`;

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

// Define styles for professional quotation format
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
    width: 50,
    textAlign: 'right',
  },
  registrationTable: {
    marginTop: 8,
  },
  registrationHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderTopWidth: 1,
    borderTopColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  registrationRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  registrationCell: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#000',
    padding: 8,
    textAlign: 'center',
    justifyContent: 'center',
    minHeight: 25,
  },
  registrationCellLast: {
    flex: 1,
    padding: 8,
    textAlign: 'center',
    justifyContent: 'center',
    minHeight: 25,
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
  termsSubTitle: {
    fontWeight: 'bold',
    fontSize: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  termsSubSection: {
    marginLeft: 15,
    marginBottom: 6,
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

function createPDFDocument(proposal) {
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

  return (
    <Document>
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

            {/* Row 3: Empty, Empty, Enquiry No. */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text> </Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLarge]}>
                <Text> </Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Enquiry No.</Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellValue]}>
                <Text>{proposal.enquiry_no || ''}</Text>
              </View>
            </View>

            {/* Row 4: Empty, Empty, Date of Enquiry */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text> </Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLarge]}>
                <Text> </Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Date of Enquiry</Text>
              </View>
              <View style={[styles.infoCell, styles.infoCellValue]}>
                <Text>{proposal.enquiry_date || ''}</Text>
              </View>
            </View>

            {/* Row 5: Kind Attn spanning 4 columns */}
            <View style={styles.infoRow}>
              <View style={[styles.infoCell, styles.infoCellLabel]}>
                <Text style={styles.headerText}>Kind Attn:</Text>
              </View>
              <View style={[styles.infoCell, { width: '75%' }]}>
                <Text>{proposal.contact_name || proposal.client_contact_details || ''}</Text>
              </View>
            </View>
          </View>

          {/* Work Items Table */}
          <View style={styles.workTableContainer}>
            {/* Table Header */}
            <View style={styles.workTableHeader}>
              <View style={styles.workCellSrNo}>
                <Text style={styles.headerText}>Sr. No.</Text>
              </View>
              <View style={styles.workCellScope}>
                <Text style={styles.headerText}>Scope of the Work</Text>
              </View>
              <View style={styles.workCellQty}>
                <Text style={styles.headerText}>Qty.</Text>
              </View>
              <View style={styles.workCellRate}>
                <Text style={styles.headerText}>Rate</Text>
              </View>
              <View style={styles.workCellAmount}>
                <Text style={styles.headerText}>Amount</Text>
              </View>
            </View>

            {/* Work Items Rows */}
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
                  <Text>{typeof item.rate === 'number' ? item.rate.toFixed(2) : item.rate}</Text>
                </View>
                <View style={styles.workCellAmount}>
                  <Text>{typeof item.amount === 'number' ? item.amount.toFixed(2) : item.amount}</Text>
                </View>
              </View>
            ))}

            {/* Empty rows to fill the table */}
            {Array(Math.max(0, 6 - workItems.length)).fill(0).map((_, index) => (
              <View key={`empty-${index}`} style={styles.workTableRow}>
                <View style={styles.workCellSrNo}>
                  <Text> </Text>
                </View>
                <View style={styles.workCellScope}>
                  <Text> </Text>
                </View>
                <View style={styles.workCellQty}>
                  <Text> </Text>
                </View>
                <View style={styles.workCellRate}>
                  <Text> </Text>
                </View>
                <View style={styles.workCellAmount}>
                  <Text> </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Amount in Words */}
          <View style={styles.amountInWordsRow}>
            <View style={styles.amountWordsLeft}>
              <Text style={styles.headerText}>Amount in words: {amountInWords}</Text>
            </View>
            <View style={styles.amountWordsRight}>
              <Text style={styles.headerText}>-00</Text>
            </View>
          </View>

          {/* Registration Details Table */}
          <View style={styles.registrationTable}>
            <View style={styles.registrationHeader}>
              <View style={styles.registrationCell}>
                <Text style={styles.headerText}>GST Number</Text>
              </View>
              <View style={styles.registrationCell}>
                <Text style={styles.headerText}>Pan Number</Text>
              </View>
              <View style={styles.registrationCellLast}>
                <Text style={styles.headerText}>Tan Number</Text>
              </View>
            </View>
            <View style={styles.registrationRow}>
              <View style={styles.registrationCell}>
                <Text>{proposal.gst_number || '27AAFCA9766G1ZE'}</Text>
              </View>
              <View style={styles.registrationCell}>
                <Text>{proposal.pan_number || 'AAFCA9766G'}</Text>
              </View>
              <View style={styles.registrationCellLast}>
                <Text>{proposal.tan_number || 'MUMA30082D'}</Text>
              </View>
            </View>
          </View>

          {/* Terms and Conditions */}
          <View style={styles.termsSection}>
            <Text style={styles.termsTitle}>General Terms and conditions</Text>
            <Text style={styles.termsText}>• Any additional work will be charged extra</Text>
            <Text style={styles.termsText}>• GST 18% extra as applicable on total project cost.</Text>
            <Text style={styles.termsText}>• The proposal is based on client&apos;s enquiry and provided input data</Text>
            <Text style={styles.termsText}>• Work will start within 15 days after receipt of confirmed LOI/PO.</Text>
            <Text style={styles.termsText}>• Mode of Payments: - Through Wire transfer to &apos;Accent Techno Solutions Pvt Ltd.&apos; payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244</Text>
            
            <Text style={styles.termsSubTitle}>12) Other Terms & conditions:</Text>
            <View style={styles.termsSubSection}>
              <Text style={styles.termsSubTitle}>12.1 Confidentiality</Text>
              <Text style={[styles.termsText, { marginLeft: 10, fontSize: 9 }]}>
                • Input, output & any excerpts in between are intellectual properties of client. ATS shall not voluntarily disclose any of such information to third parties & will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information. ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across. ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.
              </Text>
            </View>
            
            <View style={styles.termsSubSection}>
              <Text style={styles.termsSubTitle}>12.2 Codes and Standards:</Text>
              <Text style={[styles.termsText, { marginLeft: 10, fontSize: 9 }]}>
                • Basic Engineering/ Detail Engineering should be carried out in ATS&apos;s office as per good engineering practices, project specifications and applicable client&apos;s inputs, Indian and International Standards
              </Text>
            </View>
            
            <View style={styles.termsSubSection}>
              <Text style={styles.termsSubTitle}>12.3 Dispute Resolution</Text>
              <Text style={[styles.termsText, { marginLeft: 10, fontSize: 9 }]}>
                • Should any disputes arise as claimed breach of the contract originated by this offer, it shall be finally settled amicably. Framework shall be the essence of this contract.
              </Text>
            </View>
            
            <Text style={[styles.termsText, { marginTop: 10 }]}>
              We trust you will find our offer in line with your requirement, and we shall look forward to receiving your valued work order.
            </Text>
            <Text style={styles.termsText}>
              Thanking you and always assuring you of our best services.
            </Text>
            <Text style={[styles.termsTitle, { marginTop: 8 }]}>
              For Accent Techno Solutions Private Limited.
            </Text>
          </View>

          {/* Signature Section */}
          <View style={styles.signatureSection}>
            <View style={styles.signatureLeft}>
              <Text style={{ fontWeight: 'bold' }}>Receivers Signature with Company Seal.</Text>
            </View>
            <View style={styles.signatureRight}>
              <Text style={styles.signatureCompany}>For Accent Techno Solutions Private Limited</Text>
              <Text style={styles.signatureName}>Santosh Dinkar Mistry</Text>
              <Text style={styles.signatureTitle}>Director</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}