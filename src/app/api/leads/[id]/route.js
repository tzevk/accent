import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
    try {
        const db = await dbConnect();
        const { id } = await params;
        const leadId = parseInt(id);
        
        const [leads] = await db.execute(
            'SELECT * FROM leads WHERE id = ?',
            [leadId]
        );
        
        await db.end();
        
        if (leads.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Lead not found' },
                { status: 404 }
            );
        }
        
        return NextResponse.json({
            success: true,
            data: leads[0]
        });
        
    } catch (error) {
        console.error('Error fetching lead:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch lead' },
            { status: 500 }
        );
    }
}

export async function PUT(request, { params }) {
    try {
        const db = await dbConnect();
        const id = parseInt(params.id);
        const data = await request.json();
        
        // Check if lead exists
        const [existing] = await db.execute(
            'SELECT id FROM leads WHERE id = ?',
            [id]
        );
        
        if (existing.length === 0) {
            await db.end();
            return NextResponse.json(
                { success: false, error: 'Lead not found' },
                { status: 404 }
            );
        }
        
        const {
            company_name,
            contact_name,
            contact_email,
            phone,
            city,
            project_description,
            enquiry_type,
            enquiry_status,
            enquiry_date,
            lead_source,
            priority,
            assigned_to,
            notes,
            follow_up_date
        } = data;
        
        // Validate required fields
        if (!company_name) {
            await db.end();
            return NextResponse.json(
                { success: false, error: 'Company name is required' },
                { status: 400 }
            );
        }
        
        const updateQuery = `
            UPDATE leads SET
                company_name = ?,
                contact_name = ?,
                contact_email = ?,
                phone = ?,
                city = ?,
                project_description = ?,
                enquiry_type = ?,
                enquiry_status = ?,
                enquiry_date = ?,
                lead_source = ?,
                priority = ?,
                assigned_to = ?,
                notes = ?,
                follow_up_date = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        await db.execute(updateQuery, [
            company_name,
            contact_name || null,
            contact_email || null,
            phone || null,
            city || null,
            project_description || null,
            enquiry_type || null,
            enquiry_status || null,
            enquiry_date || null,
            lead_source || null,
            priority || null,
            assigned_to || null,
            notes || null,
            follow_up_date || null,
            id
        ]);
        
        // Get the updated lead
        const [updatedLead] = await db.execute(
            'SELECT * FROM leads WHERE id = ?',
            [id]
        );
        
        await db.end();
        
        return NextResponse.json({
            success: true,
            data: updatedLead[0],
            message: 'Lead updated successfully'
        });
        
    } catch (error) {
        console.error('Error updating lead:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update lead' },
            { status: 500 }
        );
    }
}

export async function DELETE(request, { params }) {
    try {
        const db = await dbConnect();
        const { id } = await params;
        const leadId = parseInt(id);
        
        // Check if lead exists
        const [existing] = await db.execute(
            'SELECT id, company_name FROM leads WHERE id = ?',
            [leadId]
        );
        
        if (existing.length === 0) {
            await db.end();
            return NextResponse.json(
                { success: false, error: 'Lead not found' },
                { status: 404 }
            );
        }
        
        // Delete the lead
        await db.execute('DELETE FROM leads WHERE id = ?', [leadId]);
        
        await db.end();
        
        return NextResponse.json({
            success: true,
            message: `Lead "${existing[0].company_name}" deleted successfully`
        });
        
    } catch (error) {
        console.error('Error deleting lead:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to delete lead' },
            { status: 500 }
        );
    }
}
