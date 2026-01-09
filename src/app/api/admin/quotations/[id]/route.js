import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch single quotation by ID
export async function GET(request, { params }) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'project';

    connection = await dbConnect();

    let quotationData = null;

    if (source === 'project') {
      // Fetch from project_quotations
      const [rows] = await connection.execute(
        'SELECT * FROM project_quotations WHERE id = ?',
        [id]
      );

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Quotation not found' }, { status: 404 });
      }

      quotationData = rows[0];

      // Try to fetch project details
      if (quotationData.project_id) {
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
            // Map project fields to annexure fields if not already set
            quotationData.scope_of_work = quotationData.annexure_scope_of_work || p.scope_of_work;
            quotationData.input_document = quotationData.annexure_input_document || p.input_document || p.input_documents;
            quotationData.input_documents = p.input_documents;
            quotationData.deliverables = quotationData.annexure_deliverables || p.deliverables || p.list_of_deliverables;
            quotationData.list_of_deliverables = p.list_of_deliverables;
            quotationData.software_included = quotationData.annexure_software || p.software_included;
            quotationData.duration = quotationData.annexure_duration || p.duration;
            quotationData.site_visit = quotationData.annexure_site_visit || p.site_visit;
            quotationData.quotation_validity = quotationData.annexure_quotation_validity || p.quotation_validity;
            quotationData.mode_of_delivery = quotationData.annexure_mode_of_delivery || p.mode_of_delivery;
            quotationData.revision = quotationData.annexure_revision || p.revision;
            quotationData.exclusion = quotationData.annexure_exclusions || p.exclusion;
            quotationData.billing_and_payment_terms = quotationData.annexure_billing_payment_terms || p.billing_and_payment_terms;
            
            // Try to fetch from proposals if project has proposal_id
            if (p.proposal_id) {
              try {
                const [proposals] = await connection.execute(
                  `SELECT scope_of_work, input_document, list_of_deliverables, deliverables,
                   software, duration, site_visit, quotation_validity, mode_of_delivery,
                   revision, exclusions, billing_payment_terms
                   FROM proposals WHERE id = ? LIMIT 1`,
                  [p.proposal_id]
                );
                if (proposals.length > 0) {
                  const prop = proposals[0];
                  // Map proposal fields only if not already set
                  if (!quotationData.scope_of_work) quotationData.scope_of_work = prop.scope_of_work;
                  if (!quotationData.input_document) quotationData.input_document = prop.input_document;
                  if (!quotationData.deliverables) quotationData.deliverables = prop.list_of_deliverables || prop.deliverables;
                  if (!quotationData.software_included) quotationData.software_included = prop.software;
                  if (!quotationData.duration) quotationData.duration = prop.duration;
                  if (!quotationData.site_visit) quotationData.site_visit = prop.site_visit;
                  if (!quotationData.quotation_validity) quotationData.quotation_validity = prop.quotation_validity;
                  if (!quotationData.mode_of_delivery) quotationData.mode_of_delivery = prop.mode_of_delivery;
                  if (!quotationData.revision) quotationData.revision = prop.revision;
                  if (!quotationData.exclusion) quotationData.exclusion = prop.exclusions;
                  if (!quotationData.billing_and_payment_terms) quotationData.billing_and_payment_terms = prop.billing_payment_terms;
                }
              } catch (e) {
                // Ignore - proposals table might have different structure
              }
            }
          }
        } catch (e) {
          // Ignore - some columns might not exist
        }
      }
    } else {
      // Fetch from quotations table
      const [rows] = await connection.execute(
        'SELECT * FROM quotations WHERE id = ?',
        [id]
      );

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Quotation not found' }, { status: 404 });
      }

      quotationData = rows[0];
    }

    return NextResponse.json({ success: true, data: quotationData });
  } catch (error) {
    console.error('Error fetching quotation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// PUT - Update quotation
export async function PUT(request, { params }) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'project';
    const body = await request.json();

    connection = await dbConnect();

    if (source === 'project') {
      // Add new columns if they don't exist
      const columnsToAdd = [
        'client_address TEXT',
        'kind_attn VARCHAR(255)',
        'enquiry_date DATE',
        'scope_items JSON',
        'amount_in_words TEXT',
        'gst_number VARCHAR(50)',
        'pan_number VARCHAR(50)',
        'tan_number VARCHAR(50)',
        'terms_and_conditions TEXT',
        // Annexure columns
        'annexure_scope_of_work TEXT',
        'annexure_input_document TEXT',
        'annexure_deliverables TEXT',
        'annexure_software VARCHAR(255)',
        'annexure_duration VARCHAR(255)',
        'annexure_site_visit VARCHAR(255)',
        'annexure_quotation_validity VARCHAR(255)',
        'annexure_mode_of_delivery VARCHAR(255)',
        'annexure_revision VARCHAR(255)',
        'annexure_exclusions TEXT',
        'annexure_billing_payment_terms TEXT',
        'annexure_confidentiality TEXT',
        'annexure_codes_standards TEXT',
        'annexure_dispute_resolution TEXT'
      ];

      for (const col of columnsToAdd) {
        try {
          await connection.execute(`ALTER TABLE project_quotations ADD COLUMN ${col}`);
        } catch (e) {
          // Column already exists
        }
      }

      // Update project_quotations
      await connection.execute(
        `UPDATE project_quotations SET
          quotation_number = ?,
          quotation_date = ?,
          client_name = ?,
          client_address = ?,
          kind_attn = ?,
          enquiry_number = ?,
          enquiry_date = ?,
          scope_of_work = ?,
          scope_items = ?,
          gross_amount = ?,
          gst_percentage = ?,
          gst_amount = ?,
          net_amount = ?,
          amount_in_words = ?,
          gst_number = ?,
          pan_number = ?,
          tan_number = ?,
          terms_and_conditions = ?,
          annexure_scope_of_work = ?,
          annexure_input_document = ?,
          annexure_deliverables = ?,
          annexure_software = ?,
          annexure_duration = ?,
          annexure_site_visit = ?,
          annexure_quotation_validity = ?,
          annexure_mode_of_delivery = ?,
          annexure_revision = ?,
          annexure_exclusions = ?,
          annexure_billing_payment_terms = ?,
          annexure_confidentiality = ?,
          annexure_codes_standards = ?,
          annexure_dispute_resolution = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          body.quotation_number,
          body.quotation_date || null,
          body.client_name || null,
          body.client_address || null,
          body.kind_attn || null,
          body.enquiry_number || null,
          body.enquiry_date || null,
          body.scope_items?.[0]?.description || null, // First item description as scope_of_work
          JSON.stringify(body.scope_items || []),
          body.gross_amount || 0,
          body.gst_percentage || 18,
          body.gst_amount || 0,
          body.net_amount || 0,
          body.amount_in_words || null,
          body.gst_number || null,
          body.pan_number || null,
          body.tan_number || null,
          body.terms_and_conditions || null,
          body.annexure_scope_of_work || null,
          body.annexure_input_document || null,
          body.annexure_deliverables || null,
          body.annexure_software || null,
          body.annexure_duration || null,
          body.annexure_site_visit || null,
          body.annexure_quotation_validity || null,
          body.annexure_mode_of_delivery || null,
          body.annexure_revision || null,
          body.annexure_exclusions || null,
          body.annexure_billing_payment_terms || null,
          body.annexure_confidentiality || null,
          body.annexure_codes_standards || null,
          body.annexure_dispute_resolution || null,
          id
        ]
      );
    } else {
      // Add new columns to quotations table if they don't exist
      const columnsToAdd = [
        'client_address TEXT',
        'kind_attn VARCHAR(255)',
        'enquiry_number VARCHAR(100)',
        'enquiry_date DATE',
        'scope_items JSON',
        'amount_in_words TEXT',
        'gst_number VARCHAR(50)',
        'pan_number VARCHAR(50)',
        'tan_number VARCHAR(50)',
        'terms_and_conditions TEXT',
        'gross_amount DECIMAL(15, 2) DEFAULT 0',
        'gst_percentage DECIMAL(5, 2) DEFAULT 18',
        'gst_amount DECIMAL(15, 2) DEFAULT 0',
        'net_amount DECIMAL(15, 2) DEFAULT 0',
        // Annexure columns
        'annexure_scope_of_work TEXT',
        'annexure_input_document TEXT',
        'annexure_deliverables TEXT',
        'annexure_software VARCHAR(255)',
        'annexure_duration VARCHAR(255)',
        'annexure_site_visit VARCHAR(255)',
        'annexure_quotation_validity VARCHAR(255)',
        'annexure_mode_of_delivery VARCHAR(255)',
        'annexure_revision VARCHAR(255)',
        'annexure_exclusions TEXT',
        'annexure_billing_payment_terms TEXT',
        'annexure_confidentiality TEXT',
        'annexure_codes_standards TEXT',
        'annexure_dispute_resolution TEXT'
      ];

      for (const col of columnsToAdd) {
        try {
          await connection.execute(`ALTER TABLE quotations ADD COLUMN ${col}`);
        } catch (e) {
          // Column already exists
        }
      }

      // Update quotations table
      await connection.execute(
        `UPDATE quotations SET
          quotation_number = ?,
          client_name = ?,
          client_address = ?,
          kind_attn = ?,
          enquiry_number = ?,
          enquiry_date = ?,
          scope_items = ?,
          subject = ?,
          gross_amount = ?,
          gst_percentage = ?,
          gst_amount = ?,
          net_amount = ?,
          total = ?,
          amount_in_words = ?,
          gst_number = ?,
          pan_number = ?,
          tan_number = ?,
          terms_and_conditions = ?,
          annexure_scope_of_work = ?,
          annexure_input_document = ?,
          annexure_deliverables = ?,
          annexure_software = ?,
          annexure_duration = ?,
          annexure_site_visit = ?,
          annexure_quotation_validity = ?,
          annexure_mode_of_delivery = ?,
          annexure_revision = ?,
          annexure_exclusions = ?,
          annexure_billing_payment_terms = ?,
          annexure_confidentiality = ?,
          annexure_codes_standards = ?,
          annexure_dispute_resolution = ?,
          valid_until = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          body.quotation_number,
          body.client_name || null,
          body.client_address || null,
          body.kind_attn || null,
          body.enquiry_number || null,
          body.enquiry_date || null,
          JSON.stringify(body.scope_items || []),
          body.scope_items?.[0]?.description || null,
          body.gross_amount || 0,
          body.gst_percentage || 18,
          body.gst_amount || 0,
          body.net_amount || 0,
          body.net_amount || 0,
          body.amount_in_words || null,
          body.gst_number || null,
          body.pan_number || null,
          body.tan_number || null,
          body.terms_and_conditions || null,
          body.annexure_scope_of_work || null,
          body.annexure_input_document || null,
          body.annexure_deliverables || null,
          body.annexure_software || null,
          body.annexure_duration || null,
          body.annexure_site_visit || null,
          body.annexure_quotation_validity || null,
          body.annexure_mode_of_delivery || null,
          body.annexure_revision || null,
          body.annexure_exclusions || null,
          body.annexure_billing_payment_terms || null,
          body.annexure_confidentiality || null,
          body.annexure_codes_standards || null,
          body.annexure_dispute_resolution || null,
          body.quotation_date ? new Date(new Date(body.quotation_date).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
          id
        ]
      );
    }

    return NextResponse.json({ success: true, message: 'Quotation updated successfully' });
  } catch (error) {
    console.error('Error updating quotation:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
