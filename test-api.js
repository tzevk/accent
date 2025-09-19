// Test the actual API endpoint
async function testLoginAPI() {
  const baseUrl = 'http://localhost:3000'
  
  console.log('🧪 Testing login API endpoint...')
  
  // Test the /api/login endpoint
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin@crmaccent.com',
        password: 'admin123'
      })
    })
    
    const data = await response.json()
    
    console.log(`📡 /api/login - Status: ${response.status}`)
    console.log('Response:', data)
    
    if (response.ok && data.success) {
      console.log('✅ Login API working correctly!')
    } else {
      console.log('❌ Login API failed')
    }
    
  } catch (error) {
    console.error('❌ Error testing /api/login:', error.message)
  }
  
  // Test the /api/auth/login endpoint
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin@crmaccent.com',
        password: 'admin123'
      })
    })
    
    const data = await response.json()
    
    console.log(`\n📡 /api/auth/login - Status: ${response.status}`)
    console.log('Response:', data)
    
    if (response.ok && data.success) {
      console.log('✅ Auth login API working correctly!')
    } else {
      console.log('❌ Auth login API failed')
    }
    
  } catch (error) {
    console.error('❌ Error testing /api/auth/login:', error.message)
  }
}

testLoginAPI()
