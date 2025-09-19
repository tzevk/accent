import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const db = await dbConnect();
        const { searchParams } = new URL(request.url);
        
        // Get query parameters
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '10');
        const search = searchParams.get('search') || '';
        const status = searchParams.get('status') || '';
        const city = searchParams.get('city') || '';
        
        const offset = (page - 1) * limit;
        
        // Build WHERE clause
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (search) {
            whereClause += ' AND (company_name LIKE ? OR contact_name LIKE ? OR project_description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        if (status) {
            whereClause += ' AND enquiry_status = ?';
            params.push(status);
        }
        
        if (city) {
            whereClause += ' AND city = ?';
            params.push(city);
        }
        
        // Get total count
        const [totalResult] = await db.execute(
            `SELECT COUNT(*) as total FROM leads ${whereClause}`,
            params
        );
        const total = totalResult[0].total;
        
        // Get leads with pagination
        const [leads] = await db.execute(
            `SELECT * FROM leads ${whereClause} 
             ORDER BY created_at DESC, id DESC 
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        
        // Get summary statistics
        const [stats] = await db.execute(`
            SELECT 
                COUNT(*) as total_leads,
                COUNT(CASE WHEN enquiry_status = 'Under Discussion' THEN 1 END) as active_leads,
                COUNT(CASE WHEN enquiry_status = 'Awarded' THEN 1 END) as won_leads
            FROM leads
        `);
        
        await db.end();
        
        return NextResponse.json({
            success: true,
            data: {
                leads,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
                stats: stats[0]
            }
        });
        
    } catch (error) {
        console.error('Error fetching leads:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch leads' },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const db = await dbConnect();
        const data = await request.json();
        
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
            return NextResponse.json(
                { success: false, error: 'Company name is required' },
                { status: 400 }
            );
        }
        
        const insertQuery = `
            INSERT INTO leads (
                company_name, contact_name, contact_email, phone, city,
                project_description, enquiry_type, enquiry_status, enquiry_date,
                lead_source, priority, assigned_to, notes, follow_up_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const [result] = await db.execute(insertQuery, [
            company_name,
            contact_name || null,
            contact_email || null,
            phone || null,
            city || null,
            project_description || null,
            enquiry_type || null,
            enquiry_status || 'New',
            enquiry_date || null,
            lead_source || null,
            priority || 'Medium',
            assigned_to || null,
            notes || null,
            follow_up_date || null
        ]);
        
        // Get the created lead
        const [newLead] = await db.execute(
            'SELECT * FROM leads WHERE id = ?',
            [result.insertId]
        );
        
        await db.end();
        
        return NextResponse.json({
            success: true,
            data: newLead[0],
            message: 'Lead created successfully'
        });
        
    } catch (error) {
        console.error('Error creating lead:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create lead' },
            { status: 500 }
        );
    }
}
