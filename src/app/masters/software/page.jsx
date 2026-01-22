"use client";

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useEffect, useMemo, useState } from 'react';
import { 
  PlusIcon, 
  TrashIcon, 
  CheckIcon, 
  PencilIcon, 
  XMarkIcon,
  FolderIcon,
  ComputerDesktopIcon,
  TagIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon
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

  // Editing states
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSoftware, setEditingSoftware] = useState(null);
  const [editingVersion, setEditingVersion] = useState(null);

  // Bulk add mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSoftware, setBulkSoftware] = useState('');

  // Misc
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  // Show success message
  const showSuccess = (message) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSoftwareMaster(); }, []);

  // Get selected category and its software list
  const selectedCategory = useMemo(() => categories.find((c) => c.id === selectedCategoryId) || null, [categories, selectedCategoryId]);
  const softwares = useMemo(() => (selectedCategory?.softwares || []), [selectedCategory]);
  
  // Get selected software and its versions
  const selectedSoftware = useMemo(() => softwares.find((s) => s.id === selectedSoftwareId) || null, [softwares, selectedSoftwareId]);
  // Reset software selection when category changes
  useEffect(() => {
    if (softwares.length > 0) {
      const exists = softwares.some((s) => s.id === selectedSoftwareId);
      if (!exists) setSelectedSoftwareId(softwares[0].id);
    } else {
      setSelectedSoftwareId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId, softwares]);

  // Filter categories by search term
  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categories;
    const term = searchTerm.toLowerCase();
    return categories.filter((cat) => {
      const matchCat = String(cat.name || '').toLowerCase().includes(term);
      const matchSoftware = (cat.softwares || []).some((sw) => String(sw.name || '').toLowerCase().includes(term));
      return matchCat || matchSoftware;
    });
  }, [categories, searchTerm]);

  // Filter software by search term
  const filteredSoftware = useMemo(() => {
    if (!selectedCategory) return [];
    const softwareList = selectedCategory.softwares || [];
    if (!searchTerm) return softwareList;
    const term = searchTerm.toLowerCase();
    return softwareList.filter(sw => 
      sw.name.toLowerCase().includes(term) || 
      (sw.provider || '').toLowerCase().includes(term)
    );
  }, [selectedCategory, searchTerm]);

  // Filter versions by search term
  const filteredVersions = useMemo(() => {
    if (!selectedSoftware) return [];
    const versionList = selectedSoftware.versions || [];
    if (!searchTerm) return versionList;
    const term = searchTerm.toLowerCase();
    return versionList.filter(v => v.name.toLowerCase().includes(term));
  }, [selectedSoftware, searchTerm]);

  // Stats
  const totalSoftware = categories.reduce((sum, c) => sum + (c.softwares?.length || 0), 0);
  const totalVersions = categories.reduce((sum, c) => sum + (c.softwares || []).reduce((s2, sw) => s2 + (sw.versions?.length || 0), 0), 0);

  // Add Category
  const handleAddCategory = async () => {
    const name = (categoryForm.name || '').trim();
    if (!name) {
      setError('Please enter a category name');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/software-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          description: categoryForm.description || '', 
          status: categoryForm.status || 'active' 
        }),
      });
      
      if (res.ok) {
        await fetchSoftwareMaster();
        setCategoryForm(EMPTY_CATEGORY);
        showSuccess('Category added successfully');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add category');
      }
    } catch (err) {
      console.error('Failed to add category', err);
      setError('Failed to add category');
    } finally {
      setLoading(false);
    }
  };

  // Update Category
  const handleUpdateCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/software-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingCategory.id,
          name: editingCategory.name.trim(),
          description: editingCategory.description || '',
          status: editingCategory.status || 'active'
        })
      });
      
      if (res.ok) {
        await fetchSoftwareMaster();
        setEditingCategory(null);
        showSuccess('Category updated');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update category');
      }
    } catch (err) {
      console.error('Failed to update category', err);
      setError('Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  // Delete Category
  const handleDeleteCategory = async (id) => {
    if (!confirm('Delete this category and all its software?')) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/software-master?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchSoftwareMaster();
        if (selectedCategoryId === id) {
          setSelectedCategoryId(null);
        }
        showSuccess('Category deleted');
      }
    } catch (err) {
      console.error('Failed to delete category', err);
      setError('Failed to delete category');
    } finally {
      setLoading(false);
    }
  };

  // Add Software
  const handleAddSoftware = async () => {
    const name = (softwareForm.name || '').trim();
    if (!name) {
      setError('Please enter a software name');
      return;
    }
    if (!selectedCategoryId) {
      setError('Please select a category first');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/software', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          category_id: selectedCategoryId, 
          name, 
          provider: softwareForm.provider || '' 
        }),
      });
      
      if (res.ok) {
        await fetchSoftwareMaster();
        setSoftwareForm(EMPTY_SOFTWARE);
        showSuccess('Software added successfully');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add software');
      }
    } catch (err) {
      console.error('Failed to add software', err);
      setError('Failed to add software');
    } finally {
      setLoading(false);
    }
  };

  // Add Software in Bulk
  const handleBulkAddSoftware = async () => {
    if (!bulkSoftware.trim()) {
      setError('Please enter at least one software');
      return;
    }
    if (!selectedCategoryId) {
      setError('Please select a category first');
      return;
    }

    const softwareLines = bulkSoftware
      .split(/\n/)
      .map(line => line.trim())
      .map(line => line.replace(/^[\s•\-\*\d\.]+/, '').trim())
      .filter(line => line.length > 0);

    if (softwareLines.length === 0) {
      setError('No valid software names found');
      return;
    }

    setLoading(true);
    setError('');

    let successCount = 0;
    let failCount = 0;

    for (const name of softwareLines) {
      try {
        const res = await fetch('/api/software', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            category_id: selectedCategoryId, 
            name,
            provider: ''
          }),
        });
        
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    await fetchSoftwareMaster();
    setBulkSoftware('');
    setBulkMode(false);
    
    if (failCount === 0) {
      showSuccess(`${successCount} software added successfully`);
    } else {
      showSuccess(`${successCount} added, ${failCount} failed`);
    }
    
    setLoading(false);
  };

  // Update Software
  const handleUpdateSoftware = async () => {
    if (!editingSoftware || !editingSoftware.name.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/software', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSoftware.id,
          name: editingSoftware.name.trim(),
          provider: editingSoftware.provider || ''
        })
      });
      
      if (res.ok) {
        await fetchSoftwareMaster();
        setEditingSoftware(null);
        showSuccess('Software updated');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update software');
      }
    } catch (err) {
      console.error('Failed to update software', err);
      setError('Failed to update software');
    } finally {
      setLoading(false);
    }
  };

  // Delete Software
  const handleDeleteSoftware = async (id) => {
    if (!confirm('Delete this software and its versions?')) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/software?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchSoftwareMaster();
        if (selectedSoftwareId === id) {
          setSelectedSoftwareId(null);
        }
        showSuccess('Software deleted');
      }
    } catch (err) {
      console.error('Failed to delete software', err);
      setError('Failed to delete software');
    } finally {
      setLoading(false);
    }
  };

  // Delete All Software in selected category
  const handleDeleteAllSoftware = async () => {
    if (!selectedCategoryId) return;
    const softwareCount = softwares.length;
    if (softwareCount === 0) {
      setError('No software to delete');
      return;
    }
    if (!confirm(`Delete all ${softwareCount} software from "${selectedCategory?.name}"? This action cannot be undone.`)) return;
    
    setLoading(true);
    try {
      let deleted = 0;
      for (const sw of softwares) {
        const res = await fetch(`/api/software?id=${sw.id}`, { method: 'DELETE' });
        if (res.ok) deleted++;
      }
      await fetchSoftwareMaster();
      showSuccess(`${deleted} software deleted`);
    } catch (err) {
      console.error('Failed to delete all software', err);
      setError('Failed to delete all software');
    } finally {
      setLoading(false);
    }
  };

  // Add Version
  const handleAddVersion = async () => {
    const name = (versionForm.name || '').trim();
    if (!name) {
      setError('Please enter a version name');
      return;
    }
    if (!selectedSoftwareId) {
      setError('Please select a software first');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/software-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          software_id: selectedSoftwareId, 
          name, 
          release_date: versionForm.release_date || '',
          notes: versionForm.notes || ''
        }),
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchSoftwareMaster();
        setVersionForm(EMPTY_VERSION);
        showSuccess('Version added successfully');
      } else {
        setError(data.error || data.details || 'Failed to add version');
      }
    } catch (err) {
      console.error('Failed to add version', err);
      setError('Failed to add version');
    } finally {
      setLoading(false);
    }
  };

  // Update Version
  const handleUpdateVersion = async () => {
    if (!editingVersion || !editingVersion.name.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/software-versions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingVersion.id,
          name: editingVersion.name.trim(),
          release_date: editingVersion.release_date || '',
          notes: editingVersion.notes || ''
        })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchSoftwareMaster();
        setEditingVersion(null);
        showSuccess('Version updated');
      } else {
        setError(data.error || data.details || 'Failed to update version');
      }
    } catch (err) {
      console.error('Failed to update version', err);
      setError('Failed to update version');
    } finally {
      setLoading(false);
    }
  };

  // Delete Version
  const handleDeleteVersion = async (id) => {
    if (!confirm('Delete this version?')) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/software-versions?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchSoftwareMaster();
        showSuccess('Version deleted');
      } else {
        setError(data.error || data.details || 'Failed to delete version');
      }
    } catch (err) {
      console.error('Failed to delete version', err);
      setError('Failed to delete version');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccessGuard resource="software" permission="read" showNavbar={false}>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Software Master</h1>
            <p className="text-sm text-gray-600">
              Manage software categories, products and versions
            </p>
          </div>

          {/* Messages */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 font-bold">×</button>
            </div>
          )}
          {success && (
            <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
              <span>{success}</span>
              <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 font-bold">×</button>
            </div>
          )}

          {/* Quick Stats */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <FolderIcon className="h-5 w-5 text-[#7F2487]" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{categories.length}</div>
                <div className="text-xs text-gray-500">Categories</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <ComputerDesktopIcon className="h-5 w-5 text-[#4472C4]" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{totalSoftware}</div>
                <div className="text-xs text-gray-500">Total Software</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TagIcon className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{totalVersions}</div>
                <div className="text-xs text-gray-500">Total Versions</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <FolderIcon className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {categories.filter(c => (c.softwares?.length || 0) === 0).length}
                </div>
                <div className="text-xs text-gray-500">Empty Categories</div>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search categories, software or versions…"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
              />
            </div>
          </div>

          {/* Three Panel Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* LEFT PANEL - Categories */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Panel Header */}
              <div className="bg-gradient-to-r from-[#7F2487] to-[#9B3A9B] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <FolderIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Categories</h2>
                      <p className="text-xs text-white/70">{categories.length} total</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Category Form */}
              <div className="p-4 border-b border-gray-200 bg-purple-50/50">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                    placeholder="Enter new category name..."
                    className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  />
                  <button
                    onClick={handleAddCategory}
                    disabled={loading || !categoryForm.name.trim()}
                    className="px-4 py-2.5 bg-[#7F2487] text-white rounded-lg text-sm font-medium hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add
                  </button>
                </div>
              </div>

              {/* Categories List */}
              <div className="max-h-[500px] overflow-y-auto">
                {filteredCategories.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <FolderIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No categories found</p>
                    <p className="text-sm mt-1">Add your first category above</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredCategories.map((category, index) => (
                      <div
                        key={category.id}
                        className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${
                          selectedCategoryId === category.id 
                            ? 'bg-purple-100 border-l-4 border-[#7F2487]' 
                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                        onClick={() => setSelectedCategoryId(category.id)}
                      >
                        <span className="text-sm text-gray-400 w-6">{index + 1}.</span>
                        
                        {editingCategory?.id === category.id ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              value={editingCategory.name}
                              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateCategory();
                                if (e.key === 'Escape') setEditingCategory(null);
                              }}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUpdateCategory(); }}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <CheckIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingCategory(null); }}
                              className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {category.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {category.softwares?.length || 0} software
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingCategory({ id: category.id, name: category.name, description: category.description, status: category.status }); 
                                }}
                                className="p-1.5 text-gray-400 hover:text-[#7F2487] hover:bg-purple-50 rounded"
                                title="Edit category"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteCategory(category.id); }}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete category"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                            
                            <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${
                              selectedCategoryId === category.id ? 'text-[#7F2487]' : ''
                            }`} />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* MIDDLE PANEL - Software */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Panel Header */}
              <div className="bg-gradient-to-r from-[#4472C4] to-[#5A8AD8] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <ComputerDesktopIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Software</h2>
                      <p className="text-xs text-white/70">
                        {selectedCategory 
                          ? `${selectedCategory.name} • ${selectedCategory.softwares?.length || 0} software`
                          : `${totalSoftware} total`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Software Form */}
              <div className={`p-4 border-b border-gray-200 ${selectedCategoryId ? 'bg-blue-50/50' : 'bg-gray-50'}`}>
                {selectedCategoryId ? (
                  <div className="space-y-3">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        Adding to: <span className="font-medium text-[#7F2487]">{selectedCategory?.name}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        {(selectedCategory?.softwares?.length || 0) > 0 && (
                          <button
                            type="button"
                            onClick={handleDeleteAllSoftware}
                            disabled={loading}
                            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold transition-all bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50"
                          >
                            <TrashIcon className="h-4 w-4" /> Delete All
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setBulkMode(!bulkMode)}
                          className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-semibold transition-all shadow-sm ${
                            bulkMode 
                              ? 'bg-[#4472C4] text-white shadow-blue-200' 
                              : 'bg-[#7F2387] text-white hover:bg-[#64126D] shadow-purple-200'
                          }`}
                        >
                          {bulkMode ? (
                            <><CheckIcon className="h-4 w-4" /> Bulk Mode ON</>
                          ) : (
                            <><Squares2X2Icon className="h-4 w-4" /> Bulk Add</>
                          )}
                        </button>
                      </div>
                    </div>

                    {bulkMode ? (
                      /* Bulk Add Form */
                      <div className="space-y-3 bg-white p-4 rounded-lg border border-blue-200">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Software names (one per line)
                          </label>
                          <textarea
                            value={bulkSoftware}
                            onChange={(e) => setBulkSoftware(e.target.value)}
                            placeholder={"• Software 1\n• Software 2\n• Software 3"}
                            rows={5}
                            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent font-mono"
                          />
                        </div>
                        
                        {/* Preview */}
                        {bulkSoftware.trim() && (
                          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                            <p className="text-xs font-medium text-gray-600 mb-2">Preview:</p>
                            <div className="flex flex-wrap gap-1">
                              {bulkSoftware
                                .split(/\n/)
                                .map(line => line.trim())
                                .map(line => line.replace(/^[\s•\-\*\d\.]+/, '').trim())
                                .filter(line => line.length > 0)
                                .map((name, idx) => (
                                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                    <span className="font-medium">{idx + 1}.</span> {name}
                                  </span>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                              {bulkSoftware.split(/\n/).map(l => l.trim()).map(l => l.replace(/^[\s•\-\*\d\.]+/, '').trim()).filter(l => l.length > 0).length} software
                            </p>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                          <button
                            type="button"
                            onClick={() => { setBulkMode(false); setBulkSoftware(''); }}
                            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleBulkAddSoftware}
                            disabled={loading || !bulkSoftware.trim()}
                            className="px-4 py-2.5 bg-[#4472C4] text-white rounded-lg text-sm font-medium hover:bg-[#3961a8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                          >
                            <PlusIcon className="w-4 h-4" />
                            Add All Software
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Single Add Form */
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={softwareForm.name}
                          onChange={(e) => setSoftwareForm({ ...softwareForm, name: e.target.value })}
                          placeholder="Enter new software name..."
                          className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddSoftware()}
                        />
                        <input
                          type="text"
                          value={softwareForm.provider}
                          onChange={(e) => setSoftwareForm({ ...softwareForm, provider: e.target.value })}
                          placeholder="Provider"
                          className="w-32 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddSoftware()}
                        />
                        <button
                          onClick={handleAddSoftware}
                          disabled={loading || !softwareForm.name.trim()}
                          className="px-4 py-2.5 bg-[#4472C4] text-white rounded-lg text-sm font-medium hover:bg-[#3961a8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <PlusIcon className="w-4 h-4" />
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-2 text-sm text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[#7F2487]">←</span>
                      Select a category to add software
                    </span>
                  </div>
                )}
              </div>

              {/* Software List */}
              <div className="max-h-[500px] overflow-y-auto">
                {!selectedCategoryId ? (
                  <div className="p-8 text-center text-gray-500">
                    <ComputerDesktopIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Select a category</p>
                    <p className="text-sm mt-1">Choose a category from the left panel to view and manage its software</p>
                  </div>
                ) : filteredSoftware.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <ComputerDesktopIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No software yet</p>
                    <p className="text-sm mt-1">Add software to &ldquo;{selectedCategory?.name}&rdquo;</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredSoftware.map((software, index) => (
                      <div
                        key={software.id}
                        className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${
                          selectedSoftwareId === software.id 
                            ? 'bg-blue-100 border-l-4 border-[#4472C4]' 
                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                        onClick={() => setSelectedSoftwareId(software.id)}
                      >
                        <span className="text-sm text-gray-400 w-6">{index + 1}.</span>
                        
                        {editingSoftware?.id === software.id ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              value={editingSoftware.name}
                              onChange={(e) => setEditingSoftware({ ...editingSoftware, name: e.target.value })}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateSoftware();
                                if (e.key === 'Escape') setEditingSoftware(null);
                              }}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUpdateSoftware(); }}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <CheckIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingSoftware(null); }}
                              className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {software.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {software.provider || 'No provider'} • {software.versions?.length || 0} versions
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingSoftware({ id: software.id, name: software.name, provider: software.provider }); 
                                }}
                                className="p-1.5 text-gray-400 hover:text-[#4472C4] hover:bg-blue-50 rounded"
                                title="Edit software"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteSoftware(software.id); }}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete software"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                            
                            <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${
                              selectedSoftwareId === software.id ? 'text-[#4472C4]' : ''
                            }`} />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT PANEL - Versions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Panel Header */}
              <div className="bg-gradient-to-r from-green-600 to-green-500 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <TagIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Versions</h2>
                      <p className="text-xs text-white/70">
                        {selectedSoftware 
                          ? `${selectedSoftware.name} • ${selectedSoftware.versions?.length || 0} versions`
                          : `${totalVersions} total`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Version Form */}
              <div className={`p-4 border-b border-gray-200 ${selectedSoftwareId ? 'bg-green-50/50' : 'bg-gray-50'}`}>
                {selectedSoftwareId ? (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Adding to: <span className="font-medium text-[#4472C4]">{selectedSoftware?.name}</span>
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={versionForm.name}
                        onChange={(e) => setVersionForm({ ...versionForm, name: e.target.value })}
                        placeholder="Version (e.g., 14.5)"
                        className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddVersion()}
                      />
                      <input
                        type="date"
                        value={versionForm.release_date}
                        onChange={(e) => setVersionForm({ ...versionForm, release_date: e.target.value })}
                        className="w-36 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <button
                        onClick={handleAddVersion}
                        disabled={loading || !versionForm.name.trim()}
                        className="px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <PlusIcon className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-2 text-sm text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[#4472C4]">←</span>
                      Select a software to add versions
                    </span>
                  </div>
                )}
              </div>

              {/* Versions List */}
              <div className="max-h-[500px] overflow-y-auto">
                {!selectedSoftwareId ? (
                  <div className="p-8 text-center text-gray-500">
                    <TagIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Select a software</p>
                    <p className="text-sm mt-1">Choose a software from the middle panel to view and manage its versions</p>
                  </div>
                ) : filteredVersions.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <TagIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No versions yet</p>
                    <p className="text-sm mt-1">Add versions to &ldquo;{selectedSoftware?.name}&rdquo;</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-10">
                          #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Version
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">
                          Release Date
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredVersions.map((version, index) => (
                        <tr key={version.id} className="group hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3">
                            {editingVersion?.id === version.id ? (
                              <input
                                type="text"
                                value={editingVersion.name}
                                onChange={(e) => setEditingVersion({ ...editingVersion, name: e.target.value })}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateVersion();
                                  if (e.key === 'Escape') setEditingVersion(null);
                                }}
                              />
                            ) : (
                              <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">
                                {version.name}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {editingVersion?.id === version.id ? (
                              <input
                                type="date"
                                value={editingVersion.release_date || ''}
                                onChange={(e) => setEditingVersion({ ...editingVersion, release_date: e.target.value })}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-transparent"
                              />
                            ) : (
                              version.release_date 
                                ? new Date(version.release_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                                : '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {editingVersion?.id === version.id ? (
                              <div className="flex justify-center gap-1">
                                <button
                                  onClick={handleUpdateVersion}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                                  title="Save"
                                >
                                  <CheckIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setEditingVersion(null)}
                                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                                  title="Cancel"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setEditingVersion({ 
                                    id: version.id, 
                                    name: version.name,
                                    release_date: version.release_date || '',
                                    notes: version.notes || ''
                                  })}
                                  className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                                  title="Edit version"
                                >
                                  <PencilIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteVersion(version.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                  title="Delete version"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
