"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useState } from 'react';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  MagnifyingGlassIcon,
  FolderIcon,
  CubeIcon,
  CodeBracketSquareIcon,
  CheckCircleIcon,
  XCircleIcon
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

  // -------- Helpers --------

  const fetchSoftwareMaster = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/software-master');

      // If the response is an HTTP error, try to read it as text so we
      // don't attempt to parse HTML/error pages as JSON (causes
      // "Unexpected token '<', "<!DOCTYPE ... is not valid JSON").
      if (!res.ok) {
        let txt = '';
        try {
          txt = await res.text();
        } catch {
          /* ignore */
        }
        // If server returned HTML (e.g. Next.js 404 page), show a concise
        // status-based message instead of dumping raw HTML into the UI.
        const isHtml = String(txt || '').trim().startsWith('<');
        const msg = isHtml
          ? `Request failed: ${res.status} ${res.statusText || ''}`
          : txt || `Failed to load software catalogue (status ${res.status})`;
        setError(msg);
        return;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        // Server returned non-JSON (likely an HTML error page) — read text and surface a helpful message.
        const txt = await res.text();
        const isHtml = String(txt || '').trim().startsWith('<');
        const msg = isHtml ? `Request failed: ${res.status} ${res.statusText || ''}` : txt || 'Expected JSON response from /api/software-master';
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

      // Ensure selected category still exists, else pick first
      if (data.length > 0) {
        const stillExists = data.some((c) => c.id === selectedCategoryId);
        if (!stillExists) {
          setSelectedCategoryId(data[0].id);
        }
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

  // -------- Effects --------

  // Initial load
  useEffect(() => {
    fetchSoftwareMaster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selected category changes, update softwares list
  useEffect(() => {
    if (!selectedCategoryId) {
      setSoftwares([]);
      setSelectedSoftwareId(null);
      return;
    }
    const cat = categories.find((c) => c.id === selectedCategoryId);
    const list = (cat && cat.softwares) || [];
    setSoftwares(list);

    // Ensure selected software belongs to this category
    if (list.length > 0) {
      const exists = list.some((s) => s.id === selectedSoftwareId);
      if (!exists) {
        setSelectedSoftwareId(list[0].id);
      }
    } else {
      setSelectedSoftwareId(null);
    }
  }, [selectedCategoryId, categories, selectedSoftwareId]);

  // When selected software changes, update versions list
  useEffect(() => {
    if (!selectedSoftwareId) {
      setVersions([]);
      return;
    }
    const sw = softwares.find((s) => s.id === selectedSoftwareId);
    setVersions((sw && sw.versions) || []);
  }, [selectedSoftwareId, softwares]);

  // -------- Derived values --------

  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categories;
    const term = searchTerm.toLowerCase();

    return categories.filter((cat) => {
      const name = String(cat.name || '').toLowerCase();
      const desc = String(cat.description || '').toLowerCase();
      const matchCat = name.includes(term) || desc.includes(term);

      const matchSoftware = (cat.softwares || []).some((sw) => {
        const swName = String(sw.name || '').toLowerCase();
        const swProvider = String(sw.provider || '').toLowerCase();
        return swName.includes(term) || swProvider.includes(term);
      });

      const matchVersion = (cat.softwares || []).some((sw) =>
        (sw.versions || []).some((v) =>
          String(v.name || '').toLowerCase().includes(term)
        )
      );

      return matchCat || matchSoftware || matchVersion;
    });
  }, [categories, searchTerm]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) || null,
    [categories, selectedCategoryId]
  );

  const selectedSoftware = useMemo(
    () => softwares.find((s) => s.id === selectedSoftwareId) || null,
    [softwares, selectedSoftwareId]
  );

  // -------- Category CRUD --------

  const openCreateCategory = () => {
    setCategoryForm(EMPTY_CATEGORY);
    setEditingCategoryId(null);
    setShowCategoryForm(true);
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    const name = (categoryForm.name || '').trim();
    if (!name) return;

    try {
      setLoading(true);
      setError('');
      const method = editingCategoryId ? 'PUT' : 'POST';
      const body = editingCategoryId
        ? {
            id: editingCategoryId,
            name,
            description: categoryForm.description || '',
            status: categoryForm.status || 'active',
          }
        : {
            name,
            description: categoryForm.description || '',
            status: categoryForm.status || 'active',
          };

      const res = await fetch('/api/software-master', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error('Failed to save category');
      }

      await fetchSoftwareMaster();
      setShowCategoryForm(false);
      setCategoryForm(EMPTY_CATEGORY);
      setEditingCategoryId(null);
    } catch (err) {
      console.error('Failed to save category', err);
      setError(err.message || 'Failed to save category');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!confirm('Delete this category and all its software?')) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/software-master?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete category');

      await fetchSoftwareMaster();
    } catch (err) {
      console.error('Failed to delete category', err);
      setError(err.message || 'Failed to delete category');
    } finally {
      setLoading(false);
    }
  };

  // -------- Software CRUD --------

  const openCreateSoftware = (categoryId) => {
    const cid = categoryId || (categories[0] && categories[0].id);
    if (!cid) return;

    setSelectedCategoryId(cid);
    setSoftwareForm(EMPTY_SOFTWARE);
    setEditingSoftwareId(null);
    setShowSoftwareForm(true);
  };

  const handleSoftwareSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCategoryId || !softwareForm.name.trim()) return;

    try {
      setLoading(true);
      setError('');
      const method = editingSoftwareId ? 'PUT' : 'POST';
      const body = editingSoftwareId
        ? {
            id: editingSoftwareId,
            name: softwareForm.name.trim(),
            provider: softwareForm.provider || '',
          }
        : {
            category_id: selectedCategoryId,
            name: softwareForm.name.trim(),
            provider: softwareForm.provider || '',
          };

      const res = await fetch('/api/software', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to save software');

      await fetchSoftwareMaster();
      setShowSoftwareForm(false);
      setSoftwareForm(EMPTY_SOFTWARE);
      setEditingSoftwareId(null);
    } catch (err) {
      console.error('Failed to save software', err);
      setError(err.message || 'Failed to save software');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSoftware = async (id) => {
    if (!confirm('Delete this software and its versions?')) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/software?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete software');

      await fetchSoftwareMaster();
    } catch (err) {
      console.error('Failed to delete software', err);
      setError(err.message || 'Failed to delete software');
    } finally {
      setLoading(false);
    }
  };

  // -------- Version CRUD --------

  const openCreateVersion = (softwareId) => {
    const sid = softwareId || (softwares[0] && softwares[0].id);
    if (!sid) return;

    setSelectedSoftwareId(sid);
    setVersionForm(EMPTY_VERSION);
    setEditingVersionId(null);
    setShowVersionForm(true);
  };

  const handleVersionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSoftwareId || !versionForm.name.trim()) return;

    try {
      setLoading(true);
      setError('');
      const method = editingVersionId ? 'PUT' : 'POST';
      const body = editingVersionId
        ? {
            id: editingVersionId,
            name: versionForm.name.trim(),
            release_date: versionForm.release_date || '',
            notes: versionForm.notes || '',
          }
        : {
            software_id: selectedSoftwareId,
            name: versionForm.name.trim(),
            release_date: versionForm.release_date || '',
            notes: versionForm.notes || '',
          };

      console.log('Saving version:', { method, body });

      const res = await fetch('/api/software-versions', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      console.log('Save version response:', data);

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.details || 'Failed to save version');
      }

      await fetchSoftwareMaster();
      setShowVersionForm(false);
      setVersionForm(EMPTY_VERSION);
      setEditingVersionId(null);
    } catch (err) {
      console.error('Failed to save version', err);
      setError(err.message || 'Failed to save version');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVersion = async (id) => {
    if (!confirm('Delete this version?')) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/software-versions?id=${id}`, {
        method: 'DELETE',
      });
      
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.details || 'Failed to delete version');
      }

      await fetchSoftwareMaster();
    } catch (err) {
      console.error('Failed to delete version', err);
      setError(err.message || 'Failed to delete version');
    } finally {
      setLoading(false);
    }
  };

  // -------- Render --------

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-pink-50/20 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-24 pb-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 bg-clip-text text-transparent mb-2">
                  Software Master Catalogue
                </h1>
                <p className="text-gray-600 flex items-center gap-2">
                  <CodeBracketSquareIcon className="h-5 w-5 text-purple-600" />
                  Manage software categories, products and their versions
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative">
                  <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search categories, software or versions…"
                    className="pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent shadow-sm w-full sm:w-64 transition-all"
                  />
                </div>
                <button
                  onClick={openCreateCategory}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-xl text-sm font-medium shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5"
                >
                  <PlusIcon className="h-5 w-5" />
                  Add Category
                </button>
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-purple-600 bg-purple-50 px-4 py-3 rounded-xl border border-purple-200">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-600 border-t-transparent"></div>
                Loading…
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-start gap-3 shadow-sm">
                <XCircleIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1">{error}</div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Categories column */}
              <section className="bg-white/80 backdrop-blur-sm border border-purple-100 rounded-2xl shadow-xl p-6 space-y-4 hover:shadow-2xl transition-shadow duration-300">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-gradient-to-br from-green-100 to-emerald-100 rounded-lg">
                      <FolderIcon className="h-5 w-5 text-green-600" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900">
                      Categories
                    </h2>
                  </div>
                  <div className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                    {filteredCategories.length}
                  </div>
                </div>

                {showCategoryForm && (
                  <form
                    onSubmit={handleCategorySubmit}
                    className="space-y-4 border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 shadow-md"
                  >
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={categoryForm.name}
                          onChange={(e) =>
                            setCategoryForm({
                              ...categoryForm,
                              name: e.target.value,
                            })
                          }
                          placeholder="e.g., Databases"
                          required
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Description
                        </label>
                        <input
                          type="text"
                          value={categoryForm.description}
                          onChange={(e) =>
                            setCategoryForm({
                              ...categoryForm,
                              description: e.target.value,
                            })
                          }
                          placeholder="Optional description"
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Status
                        </label>
                        <select
                          value={categoryForm.status}
                          onChange={(e) =>
                            setCategoryForm({
                              ...categoryForm,
                              status: e.target.value,
                            })
                          }
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all bg-white"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCategoryForm(false);
                          setCategoryForm(EMPTY_CATEGORY);
                          setEditingCategoryId(null);
                        }}
                        className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 transition-colors shadow-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all"
                      >
                        {editingCategoryId ? 'Update' : 'Save'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {filteredCategories.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <FolderIcon className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">No categories found.</p>
                    </div>
                  )}
                  {filteredCategories.map((cat) => (
                    <div
                      key={cat.id}
                      className={`group p-4 rounded-xl border-2 transition-all duration-300 cursor-pointer ${
                        selectedCategoryId === cat.id
                          ? 'border-green-400 bg-gradient-to-br from-green-50 to-emerald-50 shadow-md scale-[1.02]'
                          : 'border-gray-200 bg-white hover:border-green-300 hover:shadow-md hover:scale-[1.01]'
                      }`}
                      onClick={() => setSelectedCategoryId(cat.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-base font-semibold text-gray-900 truncate">{cat.name}</div>
                            {cat.status === 'active' ? (
                              <CheckCircleIcon className="h-4 w-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <XCircleIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            )}
                          </div>
                          <div className="text-xs text-gray-600 line-clamp-2 mb-2">
                            {cat.description || 'No description'}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              cat.status === 'active' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {cat.status || 'active'}
                            </span>
                            <span className="text-[10px] text-gray-500">
                              {(cat.softwares || []).length} software
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCategoryForm({
                                name: cat.name || '',
                                description: cat.description || '',
                                status: cat.status || 'active',
                              });
                              setEditingCategoryId(cat.id);
                              setShowCategoryForm(true);
                            }}
                            className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg border border-amber-200 transition-colors"
                            title="Edit category"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCategory(cat.id);
                            }}
                            className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200 transition-colors"
                            title="Delete category"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Software column */}
              <section className="bg-white/80 backdrop-blur-sm border border-blue-100 rounded-2xl shadow-xl p-6 space-y-4 hover:shadow-2xl transition-shadow duration-300">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-lg">
                      <CubeIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900">Software</h2>
                  </div>
                  <button
                    onClick={() =>
                      openCreateSoftware(
                        selectedCategoryId ||
                          (categories[0] && categories[0].id)
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-medium shadow-md hover:shadow-lg transition-all"
                  >
                    <PlusIcon className="h-4 w-4" /> Add Software
                  </button>
                </div>

                {selectedCategory && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-blue-800">
                      Category: <span className="font-semibold">{selectedCategory.name}</span>
                    </p>
                  </div>
                )}

                {showSoftwareForm && (
                  <form
                    onSubmit={handleSoftwareSubmit}
                    className="space-y-4 border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 shadow-md"
                  >
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={softwareForm.name}
                          onChange={(e) =>
                            setSoftwareForm({
                              ...softwareForm,
                              name: e.target.value,
                            })
                          }
                          placeholder="e.g., PostgreSQL"
                          required
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Provider
                        </label>
                        <input
                          type="text"
                          value={softwareForm.provider}
                          onChange={(e) =>
                            setSoftwareForm({
                              ...softwareForm,
                              provider: e.target.value,
                            })
                          }
                          placeholder="e.g., PostgreSQL Global Development Group"
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowSoftwareForm(false);
                          setSoftwareForm(EMPTY_SOFTWARE);
                          setEditingSoftwareId(null);
                        }}
                        className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 transition-colors shadow-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all"
                      >
                        {editingSoftwareId ? 'Update' : 'Save'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {softwares.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <CubeIcon className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">No software for this category.</p>
                    </div>
                  )}
                  {softwares.map((sw) => (
                    <div
                      key={sw.id}
                      className={`group p-4 rounded-xl border-2 transition-all duration-300 cursor-pointer ${
                        selectedSoftwareId === sw.id
                          ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-md scale-[1.02]'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md hover:scale-[1.01]'
                      }`}
                      onClick={() => setSelectedSoftwareId(sw.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-semibold text-gray-900 truncate mb-1">
                            {sw.name}
                          </div>
                          <div className="text-xs text-gray-600 truncate mb-2">
                            {sw.provider || 'No provider specified'}
                          </div>
                          <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">
                            {(sw.versions || []).length} version{(sw.versions || []).length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSoftwareForm({
                                name: sw.name || '',
                                provider: sw.provider || '',
                              });
                              setEditingSoftwareId(sw.id);
                              setShowSoftwareForm(true);
                            }}
                            className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg border border-amber-200 transition-colors"
                            title="Edit software"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSoftware(sw.id);
                            }}
                            className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200 transition-colors"
                            title="Delete software"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Versions column */}
              <section className="bg-white/80 backdrop-blur-sm border border-purple-100 rounded-2xl shadow-xl p-6 space-y-4 hover:shadow-2xl transition-shadow duration-300">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg">
                      <CodeBracketSquareIcon className="h-5 w-5 text-purple-600" />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900">Versions</h2>
                  </div>
                  <button
                    onClick={() =>
                      openCreateVersion(
                        selectedSoftwareId || (softwares[0] && softwares[0].id)
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg text-xs font-medium shadow-md hover:shadow-lg transition-all"
                  >
                    <PlusIcon className="h-4 w-4" /> Add Version
                  </button>
                </div>

                {selectedSoftware && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-purple-800">
                      Software: <span className="font-semibold">{selectedSoftware.name}</span>
                    </p>
                  </div>
                )}

                {showVersionForm && (
                  <form
                    onSubmit={handleVersionSubmit}
                    className="space-y-4 border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 shadow-md"
                  >
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Version <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={versionForm.name}
                          onChange={(e) =>
                            setVersionForm({
                              ...versionForm,
                              name: e.target.value,
                            })
                          }
                          placeholder="e.g., 14.5 or 2023.1.0"
                          required
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Release Date <span className="text-gray-400 text-xs">(Optional)</span>
                        </label>
                        <input
                          type="date"
                          value={versionForm.release_date}
                          onChange={(e) =>
                            setVersionForm({
                              ...versionForm,
                              release_date: e.target.value,
                            })
                          }
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Notes
                        </label>
                        <textarea
                          rows={2}
                          value={versionForm.notes}
                          onChange={(e) =>
                            setVersionForm({
                              ...versionForm,
                              notes: e.target.value,
                            })
                          }
                          placeholder="Optional release notes or comments"
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all resize-none"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowVersionForm(false);
                          setVersionForm(EMPTY_VERSION);
                          setEditingVersionId(null);
                        }}
                        className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 transition-colors shadow-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all"
                      >
                        {editingVersionId ? 'Update' : 'Save'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {versions.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <CodeBracketSquareIcon className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">No versions available.</p>
                    </div>
                  )}
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="group p-4 rounded-xl border-2 border-gray-200 bg-white hover:border-purple-300 hover:shadow-md transition-all duration-300"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-3 py-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg text-sm font-semibold">
                              {v.name}
                            </span>
                          </div>
                          {v.release_date && (
                            <div className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                              <span className="font-medium">Released:</span>
                              <span>{new Date(v.release_date).toLocaleDateString('en-US', { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric' 
                              })}</span>
                            </div>
                          )}
                          {v.notes && (
                            <div className="text-xs text-gray-500 line-clamp-2 mt-1">
                              {v.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setVersionForm({
                                name: v.name || '',
                                release_date: v.release_date || '',
                                notes: v.notes || '',
                              });
                              setEditingVersionId(v.id);
                              setShowVersionForm(true);
                            }}
                            className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg border border-amber-200 transition-colors"
                            title="Edit version"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteVersion(v.id)}
                            className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200 transition-colors"
                            title="Delete version"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}