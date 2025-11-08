'use client';

import { useState } from 'react';
import { ArrowDownTrayIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

export default function PDFTestPage() {
  const [downloadingId, setDownloadingId] = useState(null);

  const downloadProposalPDF = async (id) => {
    try {
      setDownloadingId(id);
      
      // Direct download of server-generated PDF
      const res = await fetch(`/api/proposals/pdf?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`PDF Export failed (${res.status})`);
      
      // Get the filename from response headers
      const contentDisposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
      let filename = `quotation_${id}.pdf`;
      if (contentDisposition) {
        const match = /filename="([^"]+)"/i.exec(contentDisposition);
        if (match) {
          filename = match[1];
        }
      }
      
      // Download the PDF
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // Success toast
      const toast = document.createElement('div');
      toast.textContent = `✅ PDF downloaded: ${filename}`;
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.right = '20px';
      toast.style.background = '#1E293B';
      toast.style.color = 'white';
      toast.style.padding = '10px 16px';
      toast.style.borderRadius = '8px';
      toast.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)';
      toast.style.zIndex = 9999;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      
    } catch (err) {
      console.error('PDF Download failed:', err);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const openPDFPreview = (id) => {
    const url = `/api/proposals/export-pdf?id=${id}`;
    window.open(url, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">PDF Export Test</h1>
        
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Test Proposal PDF Export</h2>
          <p className="text-gray-600 mb-6">
            This page allows you to test the PDF export functionality for proposals.
            The PDF format matches the quotation template shown in the provided images.
          </p>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div>
                <h3 className="font-medium text-gray-900">Demo Proposal (ID: 1)</h3>
                <p className="text-sm text-gray-500">Demo Software Development Project</p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => openPDFPreview(1)}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  <DocumentTextIcon className="h-4 w-4 mr-2" />
                  Preview HTML
                </button>
                <button
                  onClick={() => downloadProposalPDF(1)}
                  disabled={downloadingId === 1}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-[#64126D] hover:bg-[#86288F] disabled:opacity-50"
                >
                  {downloadingId === 1 ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </button>
              </div>
            </div>
            
            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div>
                <h3 className="font-medium text-gray-900">Real Proposal (ID: 4)</h3>
                <p className="text-sm text-gray-500">VVF Ltd - Detail Engineering Vega SCI R4 plant</p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => openPDFPreview(4)}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  <DocumentTextIcon className="h-4 w-4 mr-2" />
                  Preview HTML
                </button>
                <button
                  onClick={() => downloadProposalPDF(4)}
                  disabled={downloadingId === 4}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-[#64126D] hover:bg-[#86288F] disabled:opacity-50"
                >
                  {downloadingId === 4 ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 mb-2">PDF Format Features:</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Company logo and ANNEXURE - I header</li>
            <li>• Client information section with quotation details</li>
            <li>• Work items table with scope, quantity, rate, and amount</li>
            <li>• Amount in words conversion</li>
            <li>• GST, PAN, and TAN registration details</li>
            <li>• General terms and conditions</li>
            <li>• Signature section with company details</li>
          </ul>
        </div>
      </div>
    </div>
  );
}