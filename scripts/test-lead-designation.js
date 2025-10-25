import fetch from 'node-fetch';

// Simple script to POST a lead with designation and verify via GET
// Usage: node scripts/test-lead-designation.js

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function run() {
  try {
    const payload = {
      company_name: `Test Co ${Date.now()}`,
      contact_name: 'Automated Tester',
      designation: 'QA Engineer',
      contact_email: `test-${Date.now()}@example.com`,
      phone: '+911234567890',
      city: 'Test City',
      project_description: 'Automated test lead',
      enquiry_type: 'Email',
      enquiry_status: 'Under Discussion',
      enquiry_date: new Date().toISOString().split('T')[0],
      lead_source: 'Script',
      priority: 'Medium',
      notes: 'Created by automated test script'
    };

    console.log('Posting lead to', `${BASE}/api/leads`);
    const postRes = await fetch(`${BASE}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const postJson = await postRes.json();
    if (!postRes.ok || postJson.success === false) {
      console.error('POST failed', postJson);
      process.exit(2);
    }

    const createdId = postJson.data?.id;
    if (!createdId) {
      console.error('No lead id returned from POST', postJson);
      process.exit(3);
    }

    console.log('Lead created with id', createdId, ' — fetching back...');
    const getRes = await fetch(`${BASE}/api/leads/${createdId}`);
    const getJson = await getRes.json();
    if (!getRes.ok || getJson.success === false) {
      console.error('GET failed', getJson);
      process.exit(4);
    }

    const lead = getJson.data;
    console.log('Lead fetched:', {
      id: lead.id,
      company_name: lead.company_name,
      designation: lead.designation
    });

    if (lead.designation === payload.designation) {
      console.log('✅ Designation persisted correctly');
      process.exit(0);
    } else {
      console.error('❌ Designation mismatch', { expected: payload.designation, got: lead.designation });
      process.exit(5);
    }
  } catch (err) {
    console.error('Script failed:', err);
    process.exit(1);
  }
}

run();
