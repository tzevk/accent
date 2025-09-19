// Test script for the add lead API route
const testAddLead = async () => {
  const testData = {
    company_name: "Test Company Inc",
    contact_name: "John Doe", 
    contact_email: "john.doe@testcompany.com",
    phone: "+1-555-0123",
    city: "Mumbai",
    project_description: "Website development project for e-commerce platform",
    enquiry_type: "Website",
    enquiry_status: "Under Discussion",
    enquiry_date: "2025-09-19",
    lead_source: "Website",
    priority: "High",
    notes: "Potential high-value client, requires urgent follow-up"
  };

  try {
    console.log('Testing POST /api/leads...');
    console.log('Test data:', JSON.stringify(testData, null, 2));
    
    const response = await fetch('http://localhost:3000/api/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData),
    });

    const result = await response.json();
    
    console.log('\n--- Response ---');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n✅ SUCCESS: Lead created successfully!');
      console.log('Created lead ID:', result.data.id);
    } else {
      console.log('\n❌ ERROR:', result.error);
    }
    
  } catch (error) {
    console.error('\n❌ NETWORK ERROR:', error.message);
  }
};

// Test GET route first to verify database connection
const testGetLeads = async () => {
  try {
    console.log('Testing GET /api/leads...');
    
    const response = await fetch('http://localhost:3000/api/leads?page=1&limit=5');
    const result = await response.json();
    
    console.log('\n--- GET Response ---');
    console.log('Status:', response.status);
    console.log('Total leads:', result.data?.pagination?.total || 0);
    console.log('Response success:', result.success);
    
    if (result.success) {
      console.log('✅ GET route working correctly');
      return true;
    } else {
      console.log('❌ GET route failed:', result.error);
      return false;
    }
    
  } catch (error) {
    console.error('❌ GET route error:', error.message);
    return false;
  }
};

// Run tests
const runTests = async () => {
  console.log('🧪 Testing Add Lead API Route\n');
  
  // Test GET first
  const getWorking = await testGetLeads();
  
  if (getWorking) {
    console.log('\n' + '='.repeat(50));
    // Test POST
    await testAddLead();
  } else {
    console.log('\n❌ Skipping POST test due to GET failure');
  }
};

runTests();
