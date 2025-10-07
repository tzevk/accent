import { NextResponse } from 'next/server';

// This is a simple redirect/proxy to the document-master API
// for compatibility with the assignment functionality
export async function GET() {
  try {
    // Since we're in the same application, we can import and use the document-master API directly
    const documentMasterModule = await import('../document-master/route.js');
    return documentMasterModule.GET();
  } catch (error) {
    console.error('Documents API error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to load documents', 
      details: error.message 
    }, { status: 500 });
  }
}

// Also support the same operations as document-master
export async function POST(request) {
  try {
    const documentMasterModule = await import('../document-master/route.js');
    return documentMasterModule.POST(request);
  } catch (error) {
    console.error('Documents API POST error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to create document', 
      details: error.message 
    }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const documentMasterModule = await import('../document-master/route.js');
    return documentMasterModule.PUT(request);
  } catch (error) {
    console.error('Documents API PUT error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update document', 
      details: error.message 
    }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const documentMasterModule = await import('../document-master/route.js');
    return documentMasterModule.DELETE(request);
  } catch (error) {
    console.error('Documents API DELETE error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to delete document', 
      details: error.message 
    }, { status: 500 });
  }
}