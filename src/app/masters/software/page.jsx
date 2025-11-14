"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

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

      const res = await fetch('/api/software/versions', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to save version');

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
      const res = await fetch(`/api/software/versions?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete version');

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
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-24 pb-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">
                  Software Master Catalogue
                </h1>
                <p className="text-sm text-gray-600">
                  Manage software categories, software products and their
                  versions.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search categories, software or versions…"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                />
                <button
                  onClick={openCreateCategory}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-[#7F2487] text-white rounded-md text-xs"
                >
                  <PlusIcon className="h-3 w-3" />
                  Add Category
                </button>
              </div>
            </div>

            {loading && (
              <div className="text-xs text-gray-500">Loading…</div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Categories column */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">
                    Categories
                  </h2>
                  <div />
                </div>

                {showCategoryForm && (
                  <form
                    onSubmit={handleCategorySubmit}
                    className="space-y-3 border border-gray-200 rounded-md p-3"
                  >
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
                          Name
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
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
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
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
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
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCategoryForm(false);
                          setCategoryForm(EMPTY_CATEGORY);
                          setEditingCategoryId(null);
                        }}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-xs text-black"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-2 bg-green-600 text-white rounded-md text-xs"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {filteredCategories.length === 0 && (
                    <div className="text-xs text-gray-500">
                      No categories found.
                    </div>
                  )}
                  {filteredCategories.map((cat) => (
                    <div
                      key={cat.id}
                      className={`p-2 rounded border ${
                        selectedCategoryId === cat.id
                          ? 'border-green-300 bg-green-50'
                          : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{cat.name}</div>
                          <div className="text-xs text-gray-500">
                            {cat.description}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1">
                            Status: {cat.status || 'active'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setSelectedCategoryId(cat.id)}
                            className="px-2 py-1 text-[11px] bg-gray-50 rounded border border-gray-200"
                          >
                            Select
                          </button>
                          <button
                            onClick={() => {
                              setCategoryForm({
                                name: cat.name || '',
                                description: cat.description || '',
                                status: cat.status || 'active',
                              });
                              setEditingCategoryId(cat.id);
                              setShowCategoryForm(true);
                            }}
                            className="p-1 text-xs bg-yellow-50 rounded border border-yellow-100"
                            title="Edit category"
                          >
                            <PencilIcon className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(cat.id)}
                            className="p-1 text-xs bg-red-50 text-red-700 rounded border border-red-100"
                            title="Delete category"
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Software column */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">Software</h2>
                  <div>
                    <button
                      onClick={() =>
                        openCreateSoftware(
                          selectedCategoryId ||
                            (categories[0] && categories[0].id)
                        )
                      }
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded-md text-xs"
                    >
                      <PlusIcon className="h-3 w-3" /> Add Software
                    </button>
                  </div>
                </div>

                {selectedCategory && (
                  <p className="text-[11px] text-gray-500 mb-1">
                    Selected category: <span className="font-medium">{selectedCategory.name}</span>
                  </p>
                )}

                {showSoftwareForm && (
                  <form
                    onSubmit={handleSoftwareSubmit}
                    className="space-y-3 border border-gray-200 rounded-md p-3"
                  >
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
                          Name
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
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
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
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowSoftwareForm(false);
                          setSoftwareForm(EMPTY_SOFTWARE);
                          setEditingSoftwareId(null);
                        }}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-xs text-black"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-2 bg-green-600 text-white rounded-md text-xs"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {softwares.length === 0 && (
                    <div className="text-xs text-gray-500">
                      No software for this category.
                    </div>
                  )}
                  {softwares.map((sw) => (
                    <div
                      key={sw.id}
                      className={`p-2 rounded border ${
                        selectedSoftwareId === sw.id
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{sw.name}</div>
                          <div className="text-xs text-gray-500">
                            {sw.provider}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1">
                            Versions: {(sw.versions || []).length}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setSelectedSoftwareId(sw.id)}
                            className="px-2 py-1 text-[11px] bg-gray-50 rounded border border-gray-200"
                          >
                            Select
                          </button>
                          <button
                            onClick={() => {
                              setSoftwareForm({
                                name: sw.name || '',
                                provider: sw.provider || '',
                              });
                              setEditingSoftwareId(sw.id);
                              setShowSoftwareForm(true);
                            }}
                            className="p-1 text-xs bg-yellow-50 rounded border border-yellow-100"
                            title="Edit software"
                          >
                            <PencilIcon className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteSoftware(sw.id)}
                            className="p-1 text-xs bg-red-50 text-red-700 rounded border border-red-100"
                            title="Delete software"
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Versions column */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">Versions</h2>
                  <div>
                    <button
                      onClick={() =>
                        openCreateVersion(
                          selectedSoftwareId || (softwares[0] && softwares[0].id)
                        )
                      }
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded-md text-xs"
                    >
                      <PlusIcon className="h-3 w-3" /> Add Version
                    </button>
                  </div>
                </div>

                {selectedSoftware && (
                  <p className="text-[11px] text-gray-500 mb-1">
                    Selected software:{' '}
                    <span className="font-medium">{selectedSoftware.name}</span>
                  </p>
                )}

                {showVersionForm && (
                  <form
                    onSubmit={handleVersionSubmit}
                    className="space-y-3 border border-gray-200 rounded-md p-3"
                  >
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
                          Version
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
                          placeholder="e.g., v1.0.0"
                          required
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
                          Release Date
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
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">
                          Notes
                        </label>
                        <input
                          type="text"
                          value={versionForm.notes}
                          onChange={(e) =>
                            setVersionForm({
                              ...versionForm,
                              notes: e.target.value,
                            })
                          }
                          placeholder="Optional notes"
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowVersionForm(false);
                          setVersionForm(EMPTY_VERSION);
                          setEditingVersionId(null);
                        }}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-xs text-black"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-2 bg-green-600 text-white rounded-md text-xs"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {versions.length === 0 && (
                    <div className="text-xs text-gray-500">
                      No versions available.
                    </div>
                  )}
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="p-2 rounded border border-gray-100 bg-white flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="text-sm font-medium">{v.name}</div>
                        <div className="text-xs text-gray-500">
                          {v.release_date
                            ? `Released: ${v.release_date}`
                            : ''}
                          {v.notes ? ` • ${v.notes}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
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
                          className="p-1 text-xs bg-yellow-50 rounded border border-yellow-100"
                          title="Edit version"
                        >
                          <PencilIcon className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteVersion(v.id)}
                          className="p-1 text-xs bg-red-50 text-red-700 rounded border border-red-100"
                          title="Delete version"
                        >
                          <TrashIcon className="h-3 w-3" />
                        </button>
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