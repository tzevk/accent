'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  DocumentTextIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
  DocumentIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

const ALLOWED_EXT_LABELS = 'PDF, DOCX, PPTX, JPG, PNG';

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Reusable Document Upload component for Projects, Purchase Orders, and Invoices.
 *
 * Props:
 *   entityType  - 'project' | 'purchase_order' | 'invoice'
 *   entityId    - the numeric ID of the entity
 *   className   - optional extra CSS classes
 */
export default function DocumentUpload({ entityType, entityId, className = '' }) {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const ALLOWED_EXTENSIONS = '.pdf,.doc,.docx,.pptx,.ppt,.jpg,.jpeg,.png';

  // Fetch existing documents
  const fetchDocuments = useCallback(async () => {
    if (!entityId) return;
    try {
      const res = await fetch(`/api/document-upload?entity_type=${entityType}&entity_id=${entityId}`);
      const data = await res.json();
      if (data.success) {
        setDocuments(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch documents', err);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Upload handler
  const handleUpload = async (files) => {
    if (!files?.length || !entityId) return;

    setUploading(true);
    setError(null);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('entity_type', entityType);
        formData.append('entity_id', entityId);

        const res = await fetch('/api/document-upload', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!data.success) {
          setError(data.error || 'Upload failed');
        }
      }
      await fetchDocuments();
    } catch (err) {
      setError('Upload failed: ' + (err.message || 'Unknown error'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Delete handler
  const handleDelete = async (docId) => {
    if (!confirm('Delete this document?')) return;
    try {
      const res = await fetch(`/api/document-upload?id=${docId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setDocuments(prev => prev.filter(d => d.id !== docId));
      } else {
        setError(data.error || 'Delete failed');
      }
    } catch {
      setError('Delete failed');
    }
  };

  // Drag & drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      handleUpload(Array.from(e.dataTransfer.files));
    }
  };

  const getFileIcon = (doc) => {
    const ext = (doc.original_name || doc.file_name || '').toLowerCase().split('.').pop();
    if (['jpg', 'jpeg', 'png'].includes(ext)) return <PhotoIcon className="h-5 w-5 text-green-500" />;
    if (['pdf'].includes(ext)) return <DocumentTextIcon className="h-5 w-5 text-red-500" />;
    if (['doc', 'docx'].includes(ext)) return <DocumentTextIcon className="h-5 w-5 text-blue-500" />;
    if (['pptx', 'ppt'].includes(ext)) return <DocumentIcon className="h-5 w-5 text-orange-500" />;
    return <DocumentIcon className="h-5 w-5 text-gray-500" />;
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Upload Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
          ${dragActive 
            ? 'border-purple-500 bg-purple-50' 
            : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
          }
          ${uploading ? 'opacity-60 pointer-events-none' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS}
          multiple
          onChange={(e) => handleUpload(Array.from(e.target.files))}
          className="hidden"
        />
        <ArrowUpTrayIcon className="h-8 w-8 mx-auto text-gray-400 mb-2" />
        <p className="text-sm font-medium text-gray-700">
          {uploading ? 'Uploading…' : 'Click or drag files to upload'}
        </p>
        <p className="text-xs text-gray-500 mt-1">PDF, DOCX, PPTX, JPG, PNG (max 20MB)</p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <XMarkIcon className="h-4 w-4 cursor-pointer" onClick={() => setError(null)} />
          {error}
        </div>
      )}

      {/* Documents List */}
      {documents.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700">
              Uploaded Documents ({documents.length})
            </h4>
          </div>
          <ul className="divide-y divide-gray-100">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {getFileIcon(doc)}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.original_name}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(doc.file_size)}
                      {doc.created_at && ` • ${new Date(doc.created_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                    title="Download"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
