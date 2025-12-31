import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET individual lead by ID
export async function GET(request, { params }) {
  try {
    // RBAC: read leads
    const auth = await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.READ);
    if (auth instanceof Response) return auth;
    
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
    // RBAC: update leads
    const auth = await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;
    
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

    // Log the activity
    logActivity({
      actionType: 'update',
      resourceType: 'lead',
      resourceId: leadId.toString(),
      description: `Updated lead: ${data.company_name}`,
      details: {
        lead_id: data.lead_id,
        company_name: data.company_name,
        status: data.enquiry_status,
        updated_fields: Object.keys(data)
      }
    }, request).catch(err => console.error('Failed to log activity:', err));

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
    // RBAC: delete leads
    const auth = await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    const leadId = parseInt(id);
    const db = await dbConnect();
    
    // Get lead info before deleting for logging
    const [leadRows] = await db.execute(
      'SELECT company_name, lead_id FROM leads WHERE id = ?',
      [leadId]
    );
    
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

    // Log the activity
    if (leadRows.length > 0) {
      logActivity({
        actionType: 'delete',
        resourceType: 'lead',
        resourceId: leadId.toString(),
        description: `Deleted lead: ${leadRows[0].company_name}`,
        details: {
          lead_id: leadRows[0].lead_id,
          company_name: leadRows[0].company_name
        }
      }, request).catch(err => console.error('Failed to log activity:', err));
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
