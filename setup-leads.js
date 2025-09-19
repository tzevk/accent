import { dbConnect } from './src/utils/database.js';

async function setupLeadsTable() {
    const db = await dbConnect();
    
    try {
        // Create leads table with all CSV fields plus additional management fields
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS leads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_name VARCHAR(255) NOT NULL,
                contact_name VARCHAR(255),
                contact_email VARCHAR(255),
                city VARCHAR(100),
                project_description TEXT,
                enquiry_type VARCHAR(50),
                enquiry_status VARCHAR(50),
                enquiry_date DATE,
                
                -- Additional lead management fields
                phone VARCHAR(20),
                lead_source VARCHAR(50),
                lead_score INT DEFAULT 0,
                estimated_value DECIMAL(15,2),
                priority ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
                assigned_to VARCHAR(100),
                notes TEXT,
                follow_up_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                -- Indexes for better performance
                INDEX idx_company_name (company_name),
                INDEX idx_contact_email (contact_email),
                INDEX idx_enquiry_status (enquiry_status),
                INDEX idx_enquiry_date (enquiry_date),
                INDEX idx_city (city),
                INDEX idx_lead_source (lead_source)
            )
        `;
        
        await db.execute(createTableQuery);
        console.log('✅ Leads table created successfully');
        
        // Insert sample data from CSV (first few rows as examples)
        const insertSampleData = `
            INSERT INTO leads (
                company_name, contact_name, contact_email, city, project_description, 
                enquiry_type, enquiry_status, enquiry_date, lead_score, estimated_value,
                priority, notes
            ) VALUES 
            (
                'Beauty Garage India Pvt Ltd',
                'Akash Bhutak - Director',
                '',
                'Mumbai',
                'Utility Piping',
                'Justdial',
                'Regretted',
                '2025-08-20',
                30,
                50000.00,
                'Low',
                'Director level contact, regretted due to timing'
            ),
            (
                'Hospertz India Pvt. Ltd.',
                'Asmita Nikam - HR',
                'hr@hospertz.com',
                'Mumbai',
                'MEP',
                'Justdial',
                'Under Discussion',
                '2025-08-20',
                75,
                150000.00,
                'High',
                'HR contact, MEP project under discussion'
            ),
            (
                'Techno Design Consultant India Pvt Ltd',
                'Jitendra Sir',
                'tcindia38@gmail.com',
                'Mumbai',
                'Stress Analysis',
                'Email',
                'Under Discussion',
                '2025-09-11',
                80,
                75000.00,
                'High',
                'Technical lead, stress analysis project'
            ),
            (
                'Vedlaxmi Engineering Solutions (OPC) Pvt. Ltd.',
                'Abhijit Sir',
                'entegriti@gmail.com',
                'Mumbai',
                'Stress Analysis',
                'Email',
                'Under Discussion',
                '2025-04-15',
                70,
                100000.00,
                'Medium',
                'Engineering solutions company, stress analysis focus'
            ),
            (
                'Saga Consultants',
                'SK Jain Sir',
                'jainsk07@sagaconsultants.com',
                'Mumbai',
                'Modeling in E3D software',
                'Call',
                'Under Discussion',
                '2025-04-19',
                85,
                200000.00,
                'High',
                'Consulting firm, E3D modeling expertise required'
            )
        `;
        
        await db.execute(insertSampleData);
        console.log('✅ Sample lead data inserted successfully');
        
        // Display table structure
        const [columns] = await db.execute('DESCRIBE leads');
        console.log('\n📋 Leads table structure:');
        columns.forEach(col => {
            console.log(`  ${col.Field}: ${col.Type} ${col.Null === 'NO' ? '(Required)' : '(Optional)'}`);
        });
        
        // Display sample data count
        const [[{count}]] = await db.execute('SELECT COUNT(*) as count FROM leads');
        console.log(`\n📊 Total leads in database: ${count}`);
        
    } catch (error) {
        console.error('❌ Error setting up leads table:', error);
    } finally {
        await db.end();
    }
}

// Run the setup
setupLeadsTable().catch(console.error);