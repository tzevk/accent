import { dbConnect } from './src/utils/database.js';

async function dropValueScoreColumns() {
    const db = await dbConnect();
    
    try {
        console.log('🗄️  Dropping estimated_value and lead_score columns from leads table...');
        
        // Drop estimated_value column
        await db.execute('ALTER TABLE leads DROP COLUMN estimated_value');
        console.log('✅ Dropped estimated_value column');
        
        // Drop lead_score column
        await db.execute('ALTER TABLE leads DROP COLUMN lead_score');
        console.log('✅ Dropped lead_score column');
        
        // Show updated table structure
        const [columns] = await db.execute('DESCRIBE leads');
        console.log('\n📋 Updated leads table structure:');
        columns.forEach(col => {
            console.log(`  ${col.Field}: ${col.Type} ${col.Null === 'NO' ? '(Required)' : '(Optional)'}`);
        });
        
        console.log('\n🎉 Successfully removed value and score columns from database!');
        
    } catch (error) {
        console.error('❌ Error dropping columns:', error);
    } finally {
        await db.end();
    }
}

// Run the script
dropValueScoreColumns().catch(console.error);
