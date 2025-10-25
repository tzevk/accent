import { dbConnect } from '@/utils/database';

// GET individual lead by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const leadId = parseInt(id);
    const db = await dbConnect();
    
    const [rows] = await db.execute(
      'SELECT * FROM leads WHERE id = ?',
      [leadId]
    );
    
    await db.end();
    
    if (rows.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'Lead not found' 
      }, { status: 404 });
    }

    return Response.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (error) {
    console.error('Error fetching lead:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch lead: ' + error.message 
    }, { status: 500 });
  }
}

// PUT update lead by ID
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const leadId = parseInt(id);
    const data = await request.json();
    const db = await dbConnect();
    
    // Update the lead
    const [result] = await db.execute(`
      UPDATE leads SET 
        lead_id = ?,
        designation = ?,
        company_name = ?,
        contact_name = ?,
        contact_email = ?,
        inquiry_email = ?,
        cc_emails = ?,
        phone = ?,
        city = ?,
        project_description = ?,
        enquiry_type = ?,
        enquiry_status = ?,
        enquiry_date = ?,
        lead_source = ?,
        priority = ?,
        notes = ?,
        updated_at = NOW()
      WHERE id = ?
    `, [
      data.lead_id || null,
      data.designation || null,
      data.company_name,
      data.contact_name,
      data.contact_email,
      data.inquiry_email || null,
      data.cc_emails || null,
      data.phone,
      data.city,
      data.project_description,
      data.enquiry_type,
      data.enquiry_status,
      data.enquiry_date,
      data.lead_source,
      data.priority,
      data.notes,
      leadId
    ]);
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Lead not found' 
      }, { status: 404 });
    }

    return Response.json({ 
      success: true, 
      message: 'Lead updated successfully' 
    });
  } catch (error) {
    console.error('Error updating lead:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to update lead: ' + error.message 
    }, { status: 500 });
  }
}

// DELETE lead by ID
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const leadId = parseInt(id);
    const db = await dbConnect();
    
    const [result] = await db.execute(
      'DELETE FROM leads WHERE id = ?',
      [leadId]
    );
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Lead not found' 
      }, { status: 404 });
    }

    return Response.json({ 
      success: true, 
      message: 'Lead deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting lead:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to delete lead: ' + error.message 
    }, { status: 500 });
  }
}
