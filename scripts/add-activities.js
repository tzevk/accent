import mysql from 'mysql2/promise';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const activities = {
  'Electrical': ['Single Line Diagram', 'Cable Schedule', 'Panel Layout', 'Lighting Design', 'Load List', 'Motor List', 'Earthing Design'],
  'Instrumentation': ['P&ID Review', 'Instrument Index', 'Control Narrative', 'Loop Diagrams', 'Hook-up Drawings', 'Cable Schedule', 'JB Layout'],
  'Process': ['PFD Development', 'P&ID Development', 'Heat & Mass Balance', 'Equipment Sizing', 'Hydraulic Calculations', 'Process Datasheet'],
  'Mechanical': ['Equipment Layout', 'GA Drawings', 'Equipment Datasheet', 'Vendor Drawing Review', 'Foundation Loading'],
  'Piping': ['Plot Plan', 'Piping Layout', 'Isometric Drawings', 'Stress Analysis', 'Piping MTO', 'Support Design'],
  'Civil': ['Site Survey', 'Soil Investigation', 'Foundation Design', 'Road Layout', 'Drainage Design'],
  'Structural': ['Steel Structure Design', 'Platform Design', 'Pipe Rack Design', 'Connection Details', 'Foundation Bolts'],
  'HVAC': ['HVAC Load Calculation', 'Duct Layout', 'AHU Selection', 'Chiller Selection', 'Controls Design'],
  'Safety': ['HAZOP Study', 'Risk Assessment', 'Fire Protection', 'Emergency Response Plan', 'Safety Datasheet'],
  'Architecture': ['Site Plan', 'Floor Plan', 'Elevation Drawing', 'Section Drawing', 'Interior Design'],
  'Project Management': ['Project Schedule', 'Resource Planning', 'Progress Report', 'Cost Estimation', 'Risk Register'],
  'Documentation': ['Document Register', 'Transmittal', 'Drawing Index', 'Specification Review', 'As-Built Drawings'],
  'Quality Control': ['ITP Preparation', 'Inspection Report', 'NCR Report', 'Audit Report', 'Quality Plan'],
  'Procurement': ['Vendor Evaluation', 'Purchase Requisition', 'Technical Bid Evaluation', 'Expediting', 'Material Tracking'],
  'Fire Fighting': ['Fire Fighting Layout', 'Sprinkler Design', 'Fire Alarm Design', 'Hydrant System', 'Fire Pump Selection']
};

async function addActivities() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  
  const [disciplines] = await db.execute('SELECT id, function_name FROM functions_master');
  const [existingActs] = await db.execute('SELECT activity_name, function_id FROM activities_master');
  
  let added = 0;
  for (const disc of disciplines) {
    const discActivities = activities[disc.function_name] || [];
    for (const actName of discActivities) {
      const alreadyExists = existingActs.some(a => 
        a.activity_name.toLowerCase() === actName.toLowerCase() && 
        a.function_id === disc.id
      );
      if (!alreadyExists) {
        const id = crypto.randomUUID();
        await db.execute(
          'INSERT INTO activities_master (id, function_id, activity_name, default_manhours) VALUES (?, ?, ?, ?)',
          [id, disc.id, actName, 8]
        );
        console.log('Added:', disc.function_name, '->', actName);
        added++;
      }
    }
  }
  
  console.log('\nTotal activities added:', added);
  const [final] = await db.execute('SELECT COUNT(*) as count FROM activities_master');
  console.log('Total activities now:', final[0].count);
  
  await db.end();
}

addActivities().catch(console.error);
