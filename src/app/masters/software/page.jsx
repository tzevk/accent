"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useState } from 'react';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon
} from '@heroicons/react/24/outline';

const EMPTY_VERSION = { name: '', release_date: '', notes: '' };
const EMPTY_CATEGORY = { name: '', description: '', status: 'active' };
const EMPTY_SOFTWARE = { name: '', provider: '' };

export default function SoftwareMasterPage() {
  // Master data
  const [categories, setCategories] = useState([]);

  // Forms
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY);
  const [softwareForm, setSoftwareForm] = useState(EMPTY_SOFTWARE);
  const [versionForm, setVersionForm] = useState(EMPTY_VERSION);

  // Selection
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedSoftwareId, setSelectedSoftwareId] = useState(null);

  // Editing IDs
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingSoftwareId, setEditingSoftwareId] = useState(null);
  const [editingVersionId, setEditingVersionId] = useState(null);

  // UI toggles
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showSoftwareForm, setShowSoftwareForm] = useState(false);
  const [showVersionForm, setShowVersionForm] = useState(false);

  // Derived lists
  const [softwares, setSoftwares] = useState([]);
  const [versions, setVersions] = useState([]);

  // Misc
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchSoftwareMaster = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/software-master');

      if (!res.ok) {
        let txt = '';
        try { txt = await res.text(); } catch { /* ignore */ }
        const isHtml = String(txt || '').trim().startsWith('<');
        const msg = isHtml ? `Request failed: ${res.status} ${res.statusText || ''}` : txt || `Failed to load software catalogue (status ${res.status})`;
        setError(msg);
        return;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        const txt = await res.text();
        const isHtml = String(txt || '').trim().startsWith('<');
        const msg = isHtml ? `Request failed: ${res.status} ${res.statusText || ''}` : txt || 'Expected JSON response';
        setError(msg);
        return;
      }

      const json = await res.json();
      if (!json?.success) {
        setError(json?.error || 'Failed to load software catalogue');
        return;
      }

      const data = json.data || [];
      setCategories(data);

      if (data.length > 0) {
        const stillExists = data.some((c) => c.id === selectedCategoryId);
        if (!stillExists) setSelectedCategoryId(data[0].id);
      } else {
        setSelectedCategoryId(null);
        setSelectedSoftwareId(null);
      }
    } catch (err) {
      console.error('Error fetching software master:', err);
      setError(err.message || 'Failed to fetch software master data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSoftwareMaster(); }, []);

  useEffect(() => {
    if (!selectedCategoryId) {
      setSoftwares([]);
      setSelectedSoftwareId(null);
      return;
    }
    const cat = categories.find((c) => c.id === selectedCategoryId);
    const list = (cat && cat.softwares) || [];
    setSoftwares(list);
    if (list.length > 0) {
      const exists = list.some((s) => s.id === selectedSoftwareId);
      if (!exists) setSelectedSoftwareId(list[0].id);
    } else {
      setSelectedSoftwareId(null);
    }
  }, [selectedCategoryId, categories, selectedSoftwareId]);

  useEffect(() => {
    if (!selectedSoftwareId) { setVersions([]); return; }
    const sw = softwares.find((s) => s.id === selectedSoftwareId);
    setVersions((sw && sw.versions) || []);
  }, [selectedSoftwareId, softwares]);

  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categories;
    const term = searchTerm.toLowerCase();
    return categories.filter((cat) => {
      const matchCat = String(cat.name || '').toLowerCase().includes(term) || String(cat.description || '').toLowerCase().includes(term);
      const matchSoftware = (cat.softwares || []).some((sw) => String(sw.name || '').toLowerCase().includes(term) || String(sw.provider || '').toLowerCase().includes(term));
      const matchVersion = (cat.softwares || []).some((sw) => (sw.versions || []).some((v) => String(v.name || '').toLowerCase().includes(term)));
      return matchCat || matchSoftware || matchVersion;
    });
  }, [categories, searchTerm]);

  const selectedCategory = useMemo(() => categories.find((c) => c.id === selectedCategoryId) || null, [categories, selectedCategoryId]);
  const selectedSoftware = useMemo(() => softwares.find((s) => s.id === selectedSoftwareId) || null, [softwares, selectedSoftwareId]);

  const totalSoftware = categories.reduce((sum, c) => sum + (c.softwares?.length || 0), 0);
  const totalVersions = categories.reduce((sum, c) => sum + (c.softwares || []).reduce((s2, sw) => s2 + (sw.versions?.length || 0), 0), 0);

  const openCreateCategory = () => { setCategoryForm(EMPTY_CATEGORY); setEditingCategoryId(null); setShowCategoryForm(true); };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    const name = (categoryForm.name || '').trim();
    if (!name) return;
    try {
      setLoading(true); setError('');
      const method = editingCategoryId ? 'PUT' : 'POST';
      const body = editingCategoryId ? { id: editingCategoryId, name, description: categoryForm.description || '', status: categoryForm.status || 'active' } : { name, description: categoryForm.description || '', status: categoryForm.status || 'active' };
      const res = await fetch('/api/software-master', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed to save category');
      await fetchSoftwareMaster();
      setShowCategoryForm(false); setCategoryForm(EMPTY_CATEGORY); setEditingCategoryId(null);
    } catch (err) { console.error('Failed to save category', err); setError(err.message || 'Failed to save category'); } finally { setLoading(false); }
  };

  const handleDeleteCategory = async (id) => {
    if (!confirm('Delete this category and all its software?')) return;
    try {
      setLoading(true); setError('');
      const res = await fetch(`/api/software-master?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete category');
      await fetchSoftwareMaster();
    } catch (err) { console.error('Failed to delete category', err); setError(err.message || 'Failed to delete category'); } finally { setLoading(false); }
  };

  const openCreateSoftware = (categoryId) => {
    const cid = categoryId || (categories[0] && categories[0].id);
    if (!cid) return;
    setSelectedCategoryId(cid); setSoftwareForm(EMPTY_SOFTWARE); setEditingSoftwareId(null); setShowSoftwareForm(true);
  };

  const handleSoftwareSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCategoryId || !softwareForm.name.trim()) return;
    try {
      setLoading(true); setError('');
      const method = editingSoftwareId ? 'PUT' : 'POST';
      const body = editingSoftwareId ? { id: editingSoftwareId, name: softwareForm.name.trim(), provider: softwareForm.provider || '' } : { category_id: selectedCategoryId, name: softwareForm.name.trim(), provider: softwareForm.provider || '' };
      const res = await fetch('/api/software', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed to save software');
      await fetchSoftwareMaster();
      setShowSoftwareForm(false); setSoftwareForm(EMPTY_SOFTWARE); setEditingSoftwareId(null);
    } catch (err) { console.error('Failed to save software', err); setError(err.message || 'Failed to save software'); } finally { setLoading(false); }
  };

  const handleDeleteSoftware = async (id) => {
    if (!confirm('Delete this software and its versions?')) return;
    try {
      setLoading(true); setError('');
      const res = await fetch(`/api/software?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete software');
      await fetchSoftwareMaster();
    } catch (err) { console.error('Failed to delete software', err); setError(err.message || 'Failed to delete software'); } finally { setLoading(false); }
  };

  const openCreateVersion = (softwareId) => {
    const sid = softwareId || (softwares[0] && softwares[0].id);
    if (!sid) return;
    setSelectedSoftwareId(sid); setVersionForm(EMPTY_VERSION); setEditingVersionId(null); setShowVersionForm(true);
  };

  const handleVersionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSoftwareId || !versionForm.name.trim()) return;
    try {
      setLoading(true); setError('');
      const method = editingVersionId ? 'PUT' : 'POST';
      const body = editingVersionId ? { id: editingVersionId, name: versionForm.name.trim(), release_date: versionForm.release_date || '', notes: versionForm.notes || '' } : { software_id: selectedSoftwareId, name: versionForm.name.trim(), release_date: versionForm.release_date || '', notes: versionForm.notes || '' };
      const res = await fetch('/api/software-versions', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.details || 'Failed to save version');
      await fetchSoftwareMaster();
      setShowVersionForm(false); setVersionForm(EMPTY_VERSION); setEditingVersionId(null);
    } catch (err) { console.error('Failed to save version', err); setError(err.message || 'Failed to save version'); } finally { setLoading(false); }
  };

  const handleDeleteVersion = async (id) => {
    if (!confirm('Delete this version?')) return;
    try {
      setLoading(true); setError('');
      const res = await fetch(`/api/software-versions?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.details || 'Failed to delete version');
      await fetchSoftwareMaster();
    } catch (err) { console.error('Failed to delete version', err); setError(err.message || 'Failed to delete version'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Software Master</h1>
          <p className="text-sm text-gray-600">Manage software categories, products and versions</p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 font-bold">×</button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">1. Category {selectedCategoryId && <span className="text-green-600">✓</span>}</label>
              <select value={selectedCategoryId || ''} onChange={(e) => { setSelectedCategoryId(e.target.value ? Number(e.target.value) : null); setSelectedSoftwareId(null); }} className="w-48 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white">
                <option value="">Select Category</option>
                {categories.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
            <div className="flex items-center text-gray-400 pb-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">2. Software {selectedSoftwareId && <span className="text-green-600">✓</span>}</label>
              <select value={selectedSoftwareId || ''} onChange={(e) => setSelectedSoftwareId(e.target.value ? Number(e.target.value) : null)} disabled={!selectedCategoryId} className="w-48 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white disabled:bg-gray-100 disabled:cursor-not-allowed">
                <option value="">Select Software</option>
                {softwares.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
            <div className="flex items-center text-gray-400 pb-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></div>
            <div className="flex gap-2">
              <button onClick={openCreateCategory} className="px-4 py-2.5 bg-[#64126D] text-white rounded-lg text-sm font-medium hover:bg-[#5a1161] flex items-center gap-2"><PlusIcon className="w-4 h-4" />Category</button>
              <button onClick={() => openCreateSoftware(selectedCategoryId)} disabled={!selectedCategoryId} className="px-4 py-2.5 bg-[#4472C4] text-white rounded-lg text-sm font-medium hover:bg-[#3961a8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"><PlusIcon className="w-4 h-4" />Software</button>
              <button onClick={() => openCreateVersion(selectedSoftwareId)} disabled={!selectedSoftwareId} className="px-4 py-2.5 bg-[#7F2487] text-white rounded-lg text-sm font-medium hover:bg-[#6d1f73] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"><PlusIcon className="w-4 h-4" />Version</button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"><div className="text-2xl font-bold text-[#64126D]">{categories.length}</div><div className="text-sm text-gray-600">Categories</div></div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"><div className="text-2xl font-bold text-[#4472C4]">{totalSoftware}</div><div className="text-sm text-gray-600">Software</div></div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"><div className="text-2xl font-bold text-[#7F2487]">{totalVersions}</div><div className="text-sm text-gray-600">Versions</div></div>
        </div>

        {(showCategoryForm || showSoftwareForm || showVersionForm) && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            {showCategoryForm && (
              <form onSubmit={handleCategorySubmit} className="space-y-4">
                <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold text-gray-900">{editingCategoryId ? 'Edit Category' : 'Add Category'}</h3><button type="button" onClick={() => { setShowCategoryForm(false); setCategoryForm(EMPTY_CATEGORY); setEditingCategoryId(null); }} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="e.g., Databases" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><input type="text" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} placeholder="Optional description" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Status</label><select value={categoryForm.status} onChange={(e) => setCategoryForm({ ...categoryForm, status: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                </div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setShowCategoryForm(false); setCategoryForm(EMPTY_CATEGORY); setEditingCategoryId(null); }} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancel</button><button type="submit" className="px-4 py-2 bg-[#64126D] text-white rounded-md text-sm hover:bg-[#5a1161]">{editingCategoryId ? 'Update' : 'Save'}</button></div>
              </form>
            )}
            {showSoftwareForm && (
              <form onSubmit={handleSoftwareSubmit} className="space-y-4">
                <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold text-gray-900">{editingSoftwareId ? 'Edit Software' : 'Add Software'}{selectedCategory && <span className="text-sm font-normal text-gray-500 ml-2">in {selectedCategory.name}</span>}</h3><button type="button" onClick={() => { setShowSoftwareForm(false); setSoftwareForm(EMPTY_SOFTWARE); setEditingSoftwareId(null); }} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" value={softwareForm.name} onChange={(e) => setSoftwareForm({ ...softwareForm, name: e.target.value })} placeholder="e.g., PostgreSQL" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Provider</label><input type="text" value={softwareForm.provider} onChange={(e) => setSoftwareForm({ ...softwareForm, provider: e.target.value })} placeholder="e.g., PostgreSQL Global Development Group" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                </div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setShowSoftwareForm(false); setSoftwareForm(EMPTY_SOFTWARE); setEditingSoftwareId(null); }} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancel</button><button type="submit" className="px-4 py-2 bg-[#4472C4] text-white rounded-md text-sm hover:bg-[#3961a8]">{editingSoftwareId ? 'Update' : 'Save'}</button></div>
              </form>
            )}
            {showVersionForm && (
              <form onSubmit={handleVersionSubmit} className="space-y-4">
                <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold text-gray-900">{editingVersionId ? 'Edit Version' : 'Add Version'}{selectedSoftware && <span className="text-sm font-normal text-gray-500 ml-2">for {selectedSoftware.name}</span>}</h3><button type="button" onClick={() => { setShowVersionForm(false); setVersionForm(EMPTY_VERSION); setEditingVersionId(null); }} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Version *</label><input type="text" value={versionForm.name} onChange={(e) => setVersionForm({ ...versionForm, name: e.target.value })} placeholder="e.g., 14.5" required className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Release Date</label><input type="date" value={versionForm.release_date} onChange={(e) => setVersionForm({ ...versionForm, release_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><input type="text" value={versionForm.notes} onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })} placeholder="Optional notes" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
                </div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setShowVersionForm(false); setVersionForm(EMPTY_VERSION); setEditingVersionId(null); }} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancel</button><button type="submit" className="px-4 py-2 bg-[#7F2487] text-white rounded-md text-sm hover:bg-[#6d1f73]">{editingVersionId ? 'Update' : 'Save'}</button></div>
              </form>
            )}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200"><input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search categories, software or versions…" className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" /></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">Sr.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Software</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Provider</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Version</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Release Date</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(() => {
                  const rows = [];
                  let srNo = 0;
                  filteredCategories.forEach((category) => {
                    const softwareList = category.softwares || [];
                    if (softwareList.length === 0) {
                      srNo++;
                      rows.push(
                        <tr key={`cat-${category.id}`} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-500">{srNo}</td>
                          <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="font-medium text-gray-900">{category.name}</span><span className={`px-2 py-0.5 text-xs rounded-full ${category.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{category.status || 'active'}</span></div>{category.description && <div className="text-xs text-gray-500 mt-0.5">{category.description}</div>}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">—</td>
                          <td className="px-4 py-3 text-sm text-gray-400">—</td>
                          <td className="px-4 py-3 text-sm text-gray-400">—</td>
                          <td className="px-4 py-3 text-sm text-gray-400">—</td>
                          <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1"><button onClick={() => { setCategoryForm({ name: category.name || '', description: category.description || '', status: category.status || 'active' }); setEditingCategoryId(category.id); setShowCategoryForm(true); }} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Edit category"><PencilIcon className="h-4 w-4" /></button><button onClick={() => handleDeleteCategory(category.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Delete category"><TrashIcon className="h-4 w-4" /></button></div></td>
                        </tr>
                      );
                    } else {
                      softwareList.forEach((software, swIdx) => {
                        const versionList = software.versions || [];
                        if (versionList.length === 0) {
                          srNo++;
                          rows.push(
                            <tr key={`sw-${software.id}`} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-500">{srNo}</td>
                              <td className="px-4 py-3">{swIdx === 0 && <><div className="flex items-center gap-2"><span className="font-medium text-gray-900">{category.name}</span><span className={`px-2 py-0.5 text-xs rounded-full ${category.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{category.status || 'active'}</span></div>{category.description && <div className="text-xs text-gray-500 mt-0.5">{category.description}</div>}</>}</td>
                              <td className="px-4 py-3"><span className="font-medium text-gray-900">{software.name}</span></td>
                              <td className="px-4 py-3 text-sm text-gray-600">{software.provider || '—'}</td>
                              <td className="px-4 py-3 text-sm text-gray-400">—</td>
                              <td className="px-4 py-3 text-sm text-gray-400">—</td>
                              <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1"><button onClick={() => { setSoftwareForm({ name: software.name || '', provider: software.provider || '' }); setEditingSoftwareId(software.id); setSelectedCategoryId(category.id); setShowSoftwareForm(true); }} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Edit software"><PencilIcon className="h-4 w-4" /></button><button onClick={() => handleDeleteSoftware(software.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Delete software"><TrashIcon className="h-4 w-4" /></button></div></td>
                            </tr>
                          );
                        } else {
                          versionList.forEach((version, vIdx) => {
                            srNo++;
                            rows.push(
                              <tr key={`ver-${version.id}`} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-500">{srNo}</td>
                                <td className="px-4 py-3">{swIdx === 0 && vIdx === 0 && <><div className="flex items-center gap-2"><span className="font-medium text-gray-900">{category.name}</span><span className={`px-2 py-0.5 text-xs rounded-full ${category.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{category.status || 'active'}</span></div>{category.description && <div className="text-xs text-gray-500 mt-0.5">{category.description}</div>}</>}</td>
                                <td className="px-4 py-3">{vIdx === 0 && <span className="font-medium text-gray-900">{software.name}</span>}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">{vIdx === 0 && (software.provider || '—')}</td>
                                <td className="px-4 py-3"><span className="px-2 py-1 bg-[#7F2487]/10 text-[#7F2487] rounded text-sm font-medium">{version.name}</span></td>
                                <td className="px-4 py-3 text-sm text-gray-600">{version.release_date ? new Date(version.release_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                                <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1"><button onClick={() => { setVersionForm({ name: version.name || '', release_date: version.release_date || '', notes: version.notes || '' }); setEditingVersionId(version.id); setSelectedSoftwareId(software.id); setSelectedCategoryId(category.id); setShowVersionForm(true); }} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Edit version"><PencilIcon className="h-4 w-4" /></button><button onClick={() => handleDeleteVersion(version.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Delete version"><TrashIcon className="h-4 w-4" /></button></div></td>
                              </tr>
                            );
                          });
                        }
                      });
                    }
                  });
                  if (rows.length === 0) return <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">{loading ? 'Loading...' : 'No software data found. Add a category to get started.'}</td></tr>;
                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
