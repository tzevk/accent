import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET specific company
export async function GET(request, { params }) {
  let db;
  try {
    // RBAC: read companies
    const auth = await ensurePermission(request, RESOURCES.COMPANIES, PERMISSIONS.READ);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    const companyId = parseInt(id);
    
    db = await dbConnect();
    
    const [rows] = await db.execute(
      'SELECT * FROM companies WHERE id = ?',
      [companyId]
    );

    if (rows.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch company' 
    }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// PUT - Update company
export async function PUT(request, { params }) {
  let db;
  try {
    // RBAC: update companies
    const auth = await ensurePermission(request, RESOURCES.COMPANIES, PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    const companyId = parseInt(id);
    const data = await request.json();
    
    const {
      company_id,
      company_name,
      industry,
      company_size,
      website,
      phone,
      email,
      address,
      city,
      state,
      country,
      postal_code,
      description,
      founded_year,
      revenue,
      notes,
      location,
      contact_person,
      designation,
      mobile_number,
      sector,
      gstin,
      pan_number,
      company_profile
    } = data;

    db = await dbConnect();
    
    // Build UPDATE query dynamically - only include fields that were provided
    const updateFields = [];
    const updateValues = [];
    
    // Map of field names to check
    const fieldMap = {
      company_id, company_name, industry, company_size, website, phone, email,
      address, city, state, country, postal_code, description,
      founded_year, revenue, notes, location, contact_person, designation,
      mobile_number, sector, gstin, pan_number, company_profile
    };
    
    // Add only fields that were explicitly provided (not undefined)
    for (const [field, value] of Object.entries(fieldMap)) {
      if (value !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(value || null); // Allow empty strings to clear the field
      }
    }
    
    // Add updated_at
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    
    if (updateFields.length === 1) {
      // Only updated_at - no fields to update
      return Response.json({ 
        success: false, 
        error: 'No fields to update' 
      }, { status: 400 });
    }
    
    const sql = `UPDATE companies SET ${updateFields.join(', ')} WHERE id = ?`;
    updateValues.push(companyId);
    
    const [result] = await db.execute(sql, updateValues);

    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Company updated successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to update company' 
    }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// DELETE company
export async function DELETE(request, { params }) {
  let db;
  try {
    // RBAC: delete companies
    const auth = await ensurePermission(request, RESOURCES.COMPANIES, PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    const companyId = parseInt(id);
    
    db = await dbConnect();
    
    const [result] = await db.execute(
      'DELETE FROM companies WHERE id = ?',
      [companyId]
    );

    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Company deleted successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to delete company' 
    }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
