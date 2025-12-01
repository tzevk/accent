// Debug script to test project update API
// Run with: node scripts/debug-project-update.js

const API_URL = 'http://localhost:3000';

async function testProjectUpdate() {
  console.log('=== Testing Project Update API ===\n');

  // Test 0: List all projects to find a valid ID
  console.log('0. Fetching all projects...');
  let PROJECT_ID = null;
  try {
    const listResponse = await fetch(`${API_URL}/api/projects`);
    const listResult = await listResponse.json();
    
    if (listResult.success && listResult.data && listResult.data.length > 0) {
      console.log(`✓ Found ${listResult.data.length} projects`);
      console.log('   First 5 projects:');
      listResult.data.slice(0, 5).forEach((p, i) => {
        console.log(`   ${i + 1}. ID: ${p.id || 'N/A'}, Project ID: ${p.project_id}, Name: ${p.name}`);
      });
      
      // Use the project_id (not id) of the first project
      PROJECT_ID = listResult.data[0].project_id;
      console.log(`\n   Using project_id: ${PROJECT_ID} for testing\n`);
    } else {
      console.log('✗ No projects found. Please create a project first.');
      return;
    }
  } catch (error) {
    console.log('✗ Error listing projects:', error.message);
    return;
  }

  // Test 1: Fetch existing project
  console.log('1. Fetching project...');
  try {
    const getResponse = await fetch(`${API_URL}/api/projects/${PROJECT_ID}`);
    const getResult = await getResponse.json();
    
    if (getResult.success) {
      console.log('✓ Project fetched successfully');
      console.log('   Current data:', {
        name: getResult.data.name,
        client_name: getResult.data.client_name,
        company_id: getResult.data.company_id,
        project_id: getResult.data.project_id
      });
    } else {
      console.log('✗ Failed to fetch project:', getResult.error);
      return;
    }
  } catch (error) {
    console.log('✗ Error fetching project:', error.message);
    return;
  }

  console.log('\n2. Testing PUT request with client_name...');
  
  const updatePayload = {
    name: 'Test Project Update',
    client_name: 'Test Company Name',
    description: 'Testing update with client_name',
    status: 'Ongoing'
  };

  console.log('   Payload:', JSON.stringify(updatePayload, null, 2));

  try {
    const putResponse = await fetch(`${API_URL}/api/projects/${PROJECT_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload)
    });

    const putResult = await putResponse.json();
    
    console.log('   Response status:', putResponse.status);
    console.log('   Response body:', JSON.stringify(putResult, null, 2));

    if (putResult.success) {
      console.log('✓ Project updated successfully');
    } else {
      console.log('✗ Update failed:', putResult.error);
    }
  } catch (error) {
    console.log('✗ Error updating project:', error.message);
  }

  console.log('\n3. Verifying update...');
  try {
    const verifyResponse = await fetch(`${API_URL}/api/projects/${PROJECT_ID}`);
    const verifyResult = await verifyResponse.json();
    
    if (verifyResult.success) {
      console.log('   Updated data:', {
        name: verifyResult.data.name,
        client_name: verifyResult.data.client_name,
        company_id: verifyResult.data.company_id,
        description: verifyResult.data.description
      });
    }
  } catch (error) {
    console.log('✗ Error verifying:', error.message);
  }

  console.log('\n=== Test Complete ===');
}

// Run the test
testProjectUpdate().catch(console.error);
