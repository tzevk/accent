// Debug script to test project update in browser console
// Copy and paste this into your browser console while on the project edit page

async function debugProjectUpdate() {
  console.log('=== Debug Project Update ===\n');
  
  // Get the project ID from the URL
  const projectId = window.location.pathname.split('/')[2];
  console.log('Project ID:', projectId);
  
  // Test 1: Check what's currently in the form
  console.log('\n1. Checking form data...');
  const formInputs = {
    client_name: document.querySelector('input[name="client_name"]')?.value,
    company_id: document.querySelector('select[name="company_id"]')?.value || 'not found',
    name: document.querySelector('input[name="name"]')?.value,
  };
  console.log('Current form values:', formInputs);
  
  // Test 2: Try a simple PUT request
  console.log('\n2. Testing PUT request...');
  const testPayload = {
    name: formInputs.name || 'Test Project',
    client_name: formInputs.client_name || 'Test Client',
    description: 'Debug test update'
  };
  
  console.log('Payload being sent:', testPayload);
  
  try {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(testPayload)
    });
    
    const result = await response.json();
    console.log('Response status:', response.status);
    console.log('Response body:', result);
    
    if (result.success) {
      console.log('✓ Update successful!');
    } else {
      console.log('✗ Update failed:', result.error);
      console.log('Full error details:', result);
    }
  } catch (error) {
    console.log('✗ Request error:', error.message);
    console.error(error);
  }
  
  console.log('\n=== Debug Complete ===');
}

// Run the debug function
debugProjectUpdate();
