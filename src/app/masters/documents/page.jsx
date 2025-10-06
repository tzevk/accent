'use client';

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

const EMPTY_DOC = { id: '', doc_key: '', name: '', description: '', status: 'active' };
const STATUS_OPTIONS = ['active', 'inactive'];

export default function DocumentMasterPage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY_DOC);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadDocs();
  }, []);

  const loadDocs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/document-master');
      const json = await res.json();
      if (json.success) {
        setDocs(json.data || []);
        if (!selectedId && (json.data || []).length > 0) setSelectedId((json.data || [])[0].id);
      } else {
        setError(json.error || 'Failed to load document master');
        setDocs([]);
      }
    } catch (err) {
      console.error('Document master fetch error', err);
      setError('Failed to load document master');
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!searchTerm) return docs;
    const t = searchTerm.toLowerCase();
    return docs.filter((d) => (d.name || '').toLowerCase().includes(t) || (d.doc_key || '').toLowerCase().includes(t) || (d.description || '').toLowerCase().includes(t));
  }, [docs, searchTerm]);

  const openForm = (id = null) => {
    if (id) {
      const existing = docs.find((d) => d.id === id);
      if (!existing) return;
      setForm({ id: existing.id, doc_key: existing.doc_key, name: existing.name, description: existing.description || '', status: existing.status || 'active' });
      setEditingId(id);
    } else {
      setForm(EMPTY_DOC);
      setEditingId(null);
    }
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.doc_key.trim() || !form.name.trim()) return alert('Key and name are required');
    try {
      const payload = { doc_key: form.doc_key, name: form.name, description: form.description || '', status: form.status || 'active' };
      if (editingId) {
        await fetch('/api/document-master', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingId, ...payload }) });
      } else {
        await fetch('/api/document-master', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setForm(EMPTY_DOC);
      setEditingId(null);
      await loadDocs();
    } catch (err) {
      console.error('Save document error', err);
      alert('Failed to save document');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this document type?')) return;
    try {
      await fetch(`/api/document-master?id=${id}`, { method: 'DELETE' });
      if (selectedId === id) setSelectedId(null);
      await loadDocs();
    } catch (err) {
      console.error('Delete document error', err);
      alert('Failed to delete document');
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">Document Master Catalogue</h1>
                <p className="text-sm text-gray-600">Define document types and metadata used across the app.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by key or name…" className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-accent-primary focus:border-transparent" />
                <button type="button" onClick={() => openForm()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors">
                  <PlusIcon className="h-4 w-4" /> New Document
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <aside className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">Document Types</h2>
                  <span className="text-xs text-gray-500">{filtered.length}</span>
                </div>

                {loading ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : filtered.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">No documents yet. Create one to begin.</div>
                ) : (
                  <div className="space-y-3">
                    {filtered.map((d) => (
                      <div key={d.id} className={`border rounded-lg px-4 py-3 transition-colors ${selectedId === d.id ? 'border-[#7F2487] bg-[#7F2487]/10' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <div className="flex items-start justify-between">
                          <button type="button" onClick={() => setSelectedId(d.id)} className="text-left flex-1">
                            <p className="text-sm font-semibold text-black">{d.name} <span className="text-xs text-gray-500 ml-2">{d.doc_key}</span></p>
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.description || 'No description provided.'}</p>
                            <span className="mt-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">Status: {d.status}</span>
                          </button>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs">
                          <button type="button" onClick={() => openForm(d.id)} className="px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">Edit</button>
                          <button type="button" onClick={() => handleDelete(d.id)} className="px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {showForm && (
                  <div className="mt-5 border-t border-gray-200 pt-4">
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Document Key *</label>
                        <input type="text" value={form.doc_key} onChange={(e) => setForm((p) => ({ ...p, doc_key: e.target.value }))} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Name *</label>
                        <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Status</label>
                        <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent">
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Description</label>
                        <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent" />
                      </div>
                      <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_DOC); }} className="px-4 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                        <button type="submit" className="px-5 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors font-medium">{editingId ? 'Update' : 'Save'}</button>
                      </div>
                    </form>
                  </div>
                )}
              </aside>

              <section className="lg:col-span-2 space-y-4">
                {loading ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">Loading…</div>
                ) : !selectedId ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">Select a document type to view details.</div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-6 py-5">
                    {(() => {
                      const d = docs.find((x) => x.id === selectedId);
                      if (!d) return <p className="text-sm text-gray-500">Document not found</p>;
                      return (
                        <div>
                          <h3 className="text-lg font-semibold text-black">{d.name}</h3>
                          <p className="text-sm text-gray-600 mt-2">Key: <span className="font-medium text-black">{d.doc_key}</span></p>
                          <p className="text-sm text-gray-600 mt-2">Status: <span className="font-medium text-black">{d.status}</span></p>
                          <div className="mt-4 text-sm text-gray-700 whitespace-pre-line">{d.description || 'No description provided.'}</div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
