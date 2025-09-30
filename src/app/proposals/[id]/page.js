'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  ArrowLeftIcon,
  DocumentTextIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

export default function ProposalPage() {
  const router = useRouter();
  const { id: routeId } = useParams() || {};

  const [proposal, setProposal] = useState(null);
  const [linkedLead, setLinkedLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    value: '',
    due_date: '',
    notes: '',
    client_name: ''
  });

  // Versions & approvals state
  const [versions, setVersions] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [newVersion, setNewVersion] = useState({
    version_label: '',
    file_url: '',
    original_name: '',
    uploaded_by: '',
    notes: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [approvalComment, setApprovalComment] = useState('');

  // Fetch proposal + linked lead
  useEffect(() => {
    const fetchProposal = async () => {
      if (!routeId) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/proposals/${routeId}`);
        const result = await response.json();

        if (result?.success && result?.data) {
          const proposalData = result.data;
          setProposal(proposalData);

          if (proposalData?.lead_id) {
            try {
              const leadRes = await fetch(`/api/leads/${proposalData.lead_id}`);
              const leadJson = await leadRes.json();
              if (leadJson?.success) setLinkedLead(leadJson.data);
            } catch {
              /* ignore lead fetch errors */
            }
          }

          setFormData({
            title: proposalData?.title || '',
            value: proposalData?.value ?? '',
            due_date: proposalData?.due_date || '',
            notes: proposalData?.notes || '',
            client_name: proposalData?.client_name || ''
          });
        } else {
          console.error('Error fetching proposal:', result?.error);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProposal();
  }, [routeId]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      const response = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      if (result?.success) {
        setProposal(prev => ({ ...prev, ...formData }));
        setIsEditing(false);
        alert('Proposal updated successfully!');
      } else {
        alert('Error updating proposal: ' + (result?.error || 'unknown'));
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error updating proposal');
    }
  };

  const fetchVersions = useCallback(async () => {
    if (!proposal?.id) return;
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/versions`);
      const j = await res.json();
      if (j?.success) setVersions(j.data || []);
    } catch (e) { console.error('versions fetch', e); }
  }, [proposal]);

  const fetchApprovals = useCallback(async () => {
    if (!proposal?.id) return;
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/approvals`);
      const j = await res.json();
      if (j?.success) setApprovals(j.data || []);
    } catch (e) { console.error('approvals fetch', e); }
  }, [proposal]);

  useEffect(() => {
    const fetchMeta = async () => {
      if (!proposal?.id) return;
      await fetchVersions();
      await fetchApprovals();
    };
    fetchMeta();
  }, [proposal, fetchVersions, fetchApprovals]);

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setSelectedFile(f);
      setNewVersion(prev => ({ ...prev, original_name: f.name }));
    } else {
      setSelectedFile(null);
    }
  };

  const addVersion = async () => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      let fileUrl = newVersion.file_url;

      if (selectedFile) {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(selectedFile);
        });

        const upl = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: selectedFile.name, b64: dataUrl })
        });
        const uplj = await upl.json();
        if (!uplj?.success) return alert('Upload failed: ' + (uplj?.error || 'unknown'));
        fileUrl = uplj.data.fileUrl;
      }

      if (!fileUrl) return alert('Provide a file or URL');

      const payload = { ...newVersion, file_url: fileUrl };
      const res = await fetch(`/api/proposals/${proposal.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (j?.success) {
        setNewVersion({ version_label: '', file_url: '', original_name: '', uploaded_by: '', notes: '' });
        setSelectedFile(null);
        fetchVersions();
        alert('Version added');
      } else {
        alert('Failed to add version: ' + (j?.error || 'unknown'));
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add version');
    }
  };

  const recordApproval = async (stage) => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      const res = await fetch(`/api/proposals/${proposal.id}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, changed_by: 'system', comment: approvalComment })
      });
      const j = await res.json();
      if (j?.success) {
        setApprovalComment('');
        await fetchApprovals();

        // refresh proposal to get updated approval_stage
        const pr = await fetch(`/api/proposals/${proposal.id}`);
        const prj = await pr.json();
        if (prj?.success) setProposal(prj.data);
      } else {
        alert('Failed to record approval: ' + (j?.error || 'unknown'));
      }
    } catch (e) {
      console.error(e);
      alert('Failed to record approval');
    }
  };

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'approved': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading proposal details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Proposal not found</p>
            <button
              onClick={() => router.push('/proposals')}
              className="mt-4 px-4 py-2 bg-accent-primary text-white rounded-md hover:bg-accent-primary/90"
            >
              Back to Proposals
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-8 pt-22">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => router.push('/proposals')}
                  className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                <div>
                  <div className="text-sm font-medium text-blue-600 mb-1">
                    Proposal ID: {proposal.proposal_id ?? proposal.id}
                  </div>
                  <h1 className="text-xl font-bold text-accent-primary">
                    {proposal.title}
                  </h1>
                  <p className="text-gray-600 text-sm">{proposal.client}</p>
                  {linkedLead && (
                    <div className="text-sm mt-1">
                      <a href={`/leads/${linkedLead.id}/edit`} className="text-indigo-600 hover:underline">
                        Linked Lead: {linkedLead.company_name}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={async () => {
                    try {
                      if (!proposal?.id) throw new Error('Proposal not loaded');
                      if (!proposal?.title) throw new Error('Proposal title is required');
                      if (!proposal?.client) throw new Error('Client is required in the proposal');
                      if (!window.confirm('Convert this proposal to a project?')) return;

                      const res = await fetch('/api/projects', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: proposal.title,
                          description: proposal.project_description || '',
                          client_name: proposal.client,
                          start_date: new Date().toISOString().split('T')[0],
                          status: 'NEW',
                          type: 'PROPOSAL',
                          priority: 'MEDIUM',
                          progress: 0,
                          budget: proposal.value || null,
                          notes: proposal.notes || '',
                          proposal_id: proposal.id
                        })
                      });

                      const data = await res.json();
                      if (!res.ok) throw new Error(data?.error || 'Failed to create project');

                      alert('Project created successfully!');
                      router.push(`/projects/${data.id}`);
                    } catch (err) {
                      console.error(err);
                      alert('Failed to create project: ' + err.message);
                    }
                  }}
                  className="px-3 py-1.5 text-sm text-white bg-[#64126D] rounded-md hover:bg-[#86288F] transition-colors flex items-center space-x-1"
                >
                  <ArrowRightIcon className="h-3 w-3" />
                  <span>Convert to Project</span>
                </button>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(proposal.status)}`}>
                  {(proposal.status || 'draft').charAt(0).toUpperCase() + (proposal.status || 'draft').slice(1)}
                </span>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  >
                    <PencilIcon className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                ) : (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                    >
                      <XMarkIcon className="h-3 w-3" />
                      <span>Cancel</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-1"
                    >
                      <CheckIcon className="h-3 w-3" />
                      <span>Save</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Proposal Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <DocumentTextIcon className="h-5 w-5 mr-2" />
                  Proposal Details
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="title"
                        value={formData.title}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900">{proposal.title}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                    {isEditing ? (
                      <input
                        type="number"
                        name="value"
                        value={formData.value}
                        onChange={handleFormChange}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900 text-xl font-semibold">
                        {proposal.value !== null && proposal.value !== undefined
                          ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
                              .format(Number(proposal.value) || 0)
                          : 'Not specified'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                    {isEditing ? (
                      <input
                        type="date"
                        name="due_date"
                        value={formData.due_date || ''}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900">
                        {proposal.due_date ? new Date(proposal.due_date).toLocaleDateString() : 'Not set'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Created</label>
                    <p className="text-gray-900">
                      {proposal.created_at ? new Date(proposal.created_at).toLocaleDateString() : '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Client Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Client Information</h3>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                    <p className="text-gray-900">{proposal.client || '—'}</p>
                  </div>

                  {proposal.contact_name && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                      <p className="text-gray-900">{proposal.contact_name}</p>
                    </div>
                  )}

                  {proposal.contact_email && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <p className="text-gray-900">{proposal.contact_email}</p>
                    </div>
                  )}

                  {proposal.phone && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <p className="text-gray-900">{proposal.phone}</p>
                    </div>
                  )}

                  {proposal.city && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                      <p className="text-gray-900">{proposal.city}</p>
                    </div>
                  )}

                  {proposal.priority && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          proposal.priority === 'High'
                            ? 'bg-red-100 text-red-800'
                            : proposal.priority === 'Medium'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {proposal.priority}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Project Description */}
              {proposal.project_description && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Project Description</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{proposal.project_description}</p>
                </div>
              )}

              {/* Notes */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
                {isEditing ? (
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleFormChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Add notes about this proposal..."
                  />
                ) : (
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {proposal.notes || 'No notes added yet.'}
                  </p>
                )}
              </div>

              {/* Versions */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Versions</h3>
                <div className="space-y-3">
                  {versions.length === 0 ? (
                    <p className="text-sm text-gray-500">No versions uploaded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {versions.map(v => (
                        <li key={v.id} className="flex items-center justify-between">
                          <div>
                            <a
                              href={v.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
                              {v.version_label || 'Version'}
                            </a>
                            <div className="text-xs text-gray-500">
                              {v.original_name} • {v.created_at ? new Date(v.created_at).toLocaleString() : '—'}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                      placeholder="Version label (v1, v2)"
                      value={newVersion.version_label}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, version_label: e.target.value }))}
                      className="px-3 py-2 border rounded"
                    />
                    <input
                      placeholder="File URL (publicly accessible)"
                      value={newVersion.file_url}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, file_url: e.target.value }))}
                      className="px-3 py-2 border rounded col-span-2"
                    />
                    <input
                      placeholder="Original filename"
                      value={newVersion.original_name}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, original_name: e.target.value }))}
                      className="px-3 py-2 border rounded"
                    />
                    <input type="file" onChange={handleFileSelect} className="col-span-3" />
                    <input
                      placeholder="Uploaded by"
                      value={newVersion.uploaded_by}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, uploaded_by: e.target.value }))}
                      className="px-3 py-2 border rounded"
                    />
                    <input
                      placeholder="Notes"
                      value={newVersion.notes}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, notes: e.target.value }))}
                      className="px-3 py-2 border rounded col-span-2"
                    />
                    <div className="col-span-3 text-right">
                      <button onClick={addVersion} className="px-3 py-1 bg-accent-primary text-white rounded">
                        Add Version
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Approvals */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Approval Workflow</h3>
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">
                    Current Stage: <strong>{proposal.approval_stage || 'Not set'}</strong>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => recordApproval('Draft')} className="px-3 py-1 bg-gray-200 rounded">Set Draft</button>
                    <button onClick={() => recordApproval('Reviewed')} className="px-3 py-1 bg-yellow-100 rounded">Mark Reviewed</button>
                    <button onClick={() => recordApproval('Approved')} className="px-3 py-1 bg-green-100 rounded">Approve</button>
                    <button onClick={() => recordApproval('Sent')} className="px-3 py-1 bg-blue-100 rounded">Mark Sent</button>
                  </div>
                  <div>
                    <textarea
                      placeholder="Approval comment (optional)"
                      value={approvalComment}
                      onChange={(e) => setApprovalComment(e.target.value)}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>

                  <div>
                    <h4 className="text-sm font-medium">Approval History</h4>
                    {approvals.length === 0 ? (
                      <p className="text-sm text-gray-500">No approvals recorded yet.</p>
                    ) : (
                      <ul className="space-y-2 mt-2">
                        {approvals.map(a => (
                          <li key={a.id} className="text-sm text-gray-700">
                            <div className="font-medium">{a.stage}</div>
                            <div className="text-xs text-gray-500">
                              by {a.changed_by || 'unknown'} on {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                            </div>
                            {a.comment && <div className="mt-1 text-gray-600">{a.comment}</div>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
              {/* End Approvals */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}