'use client';

import { Suspense, useEffect, useMemo, useState, Fragment } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon, PlusIcon, TrashIcon, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, DocumentIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { fetchJSON } from '@/utils/http';

const STATUS_OPTIONS = ['Ongoing', 'Completed', 'On Hold', 'Cancelled'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];
const TYPE_OPTIONS = ['EPC', 'Consultancy', 'PMC', 'Lump Sum', 'Reimbursable'];
const INDUSTRY_OPTIONS = ['Oil & Gas', 'Petrochemical', 'Solar', 'Power', 'Infrastructure', 'Other'];
const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
const PAYMENT_TERMS_OPTIONS = ['Milestones', 'Monthly', '% Completion', 'Other'];
const INVOICING_STATUS_OPTIONS = ['Raised', 'Pending', 'Paid', 'Partially Paid'];
const PROCUREMENT_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed', 'On Hold'];
const SITE_READINESS_OPTIONS = ['Ready', 'Partially Ready', 'Not Ready'];
const DOCUMENTATION_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed'];

const TABS = [
  { id: 'general', label: 'General Info' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'activities', label: 'Project Activities' },
  { id: 'team', label: 'Project Team' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'construction', label: 'Construction' },
  { id: 'risk', label: 'Risk & Issues' },
  { id: 'closeout', label: 'Closeout' }
];

const INITIAL_FORM = {
  // General Information
  project_id: '',
  name: '',
  client_name: '',
  client_contact_details: '',
  project_location_country: '',
  project_location_city: '',
  project_location_site: '',
  industry: '',
  contract_type: '',
  company_id: '',
  project_manager: '',
  start_date: '',
  end_date: '',
  target_date: '',
  project_duration_planned: '',
  project_duration_actual: '',
  status: 'Ongoing',
  priority: 'MEDIUM',
  progress: 0,
  assigned_to: '',
  type: 'EPC',
  description: '',
  notes: '',
  proposal_id: '',
  
  // Commercial Details
  project_value: '',
  currency: 'INR',
  payment_terms: '',
  invoicing_status: '',
  cost_to_company: '',
  profitability_estimate: '',
  subcontractors_vendors: '',
  budget: '',
  
  // Procurement & Material
  procurement_status: '',
  material_delivery_schedule: '',
  vendor_management: '',
  
  // Construction / Site
  mobilization_date: '',
  site_readiness: '',
  construction_progress: '',
  
  // Risk & Issues
  major_risks: '',
  mitigation_plans: '',
  change_orders: '',
  claims_disputes: '',
  
  // Project Closeout
  final_documentation_status: '',
  lessons_learned: '',
  client_feedback: '',
  actual_profit_loss: '',
  
  // Meeting and Document Fields
  project_schedule: '',
  input_document: '',
  list_of_deliverables: '',
  kickoff_meeting: '',
  in_house_meeting: '',
  
  // Enhanced Planning & Meeting Fields
  project_start_milestone: '',
  project_review_milestone: '',
  project_end_milestone: '',
  kickoff_meeting_date: '',
  kickoff_followup_date: '',
  internal_meeting_date: '',
  next_internal_meeting: ''
};

function LoadingFallback() {
  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
        Loading project…
      </div>
    </div>
  );
}

export default function EditProjectPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <EditProjectForm />
    </Suspense>
  );
}

function EditProjectForm() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id;

  const [activeTab, setActiveTab] = useState('general');
  const [companies, setCompanies] = useState([]);
  const [functions, setFunctions] = useState([]); // Top-level disciplines/functions
  const [activities, setActivities] = useState([]);
  const [subActivities, setSubActivities] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [projectActivities, setProjectActivities] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedActivities, setExpandedActivities] = useState({}); // Track which activities are expanded
  // Sub-Activity dropdown UI state (per-activity)
  const [openSubActivityDropdowns, setOpenSubActivityDropdowns] = useState({});
  const [subActivitySearch, setSubActivitySearch] = useState({});
  
  // Collapsible sections state for enhanced General Info
  const [expandedSections, setExpandedSections] = useState({
    planning: true,      // Project Planning section
    documentation: true, // Documentation section  
    meetings: true       // Meetings section
  });

  // File management state
  const [inputDocuments, setInputDocuments] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // Fetch all required data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch companies
        try {
          const companiesData = await fetchJSON('/api/companies');
          if (companiesData.success) setCompanies(companiesData.data || []);
        } catch (err) {
          console.warn('Failed to fetch companies', err);
        }

        // Fetch functions (disciplines)
        try {
          const functionsData = await fetchJSON('/api/activity-master');
          if (functionsData.success) {
            console.log('Functions loaded:', functionsData.data);
            console.log('Number of functions:', functionsData.data?.length);
            setFunctions(functionsData.data || []);
          }
        } catch (err) {
          console.warn('Failed to fetch functions', err);
        }

        // Fetch activities
        try {
          const activitiesData = await fetchJSON('/api/activity-master/activities');
          if (activitiesData.success) {
            console.log('Activities loaded:', activitiesData.data);
            setActivities(activitiesData.data || []);
          }
        } catch (err) {
          console.warn('Failed to fetch activities', err);
        }

        // Fetch sub-activities
        try {
          const subActivitiesData = await fetchJSON('/api/activity-master/subactivities');
          if (subActivitiesData.success) {
            console.log('Sub-activities loaded:', subActivitiesData.data);
            setSubActivities(subActivitiesData.data || []);
          }
        } catch (err) {
          console.warn('Failed to fetch sub-activities', err);
        }

        // Fetch employees (request a large limit so we get all employees, not paginated)
        try {
          const employeesData = await fetchJSON('/api/employees?limit=10000&page=1');
          // employees API returns an object with shape { employees, departments, pagination }
          // older/other APIs return { success: true, data: [...] } — support both shapes
          if (employeesData) {
            if (Array.isArray(employeesData.employees)) {
              console.log('Employees loaded:', employeesData.employees);
              setEmployees(employeesData.employees || []);
            } else if (employeesData.success && Array.isArray(employeesData.data)) {
              console.log('Employees loaded (legacy shape):', employeesData.data);
              setEmployees(employeesData.data || []);
            } else {
              // Fallback: if the API returned an array directly
              if (Array.isArray(employeesData)) {
                console.log('Employees loaded (raw array):', employeesData);
                setEmployees(employeesData);
              }
            }
          }
        } catch (err) {
          console.warn('Failed to fetch employees', err);
        }
      } catch (error) {
        console.error('Failed to fetch data', error);
      }
    };
    fetchData();
  }, []);

  // Fetch existing project data
  useEffect(() => {
    if (!id) {
      setError('Invalid project ID');
      setLoading(false);
      return;
    }

    const fetchProject = async () => {
      try {
        const result = await fetchJSON(`/api/projects/${id}`);
        
        if (result.success && result.data) {
          const project = result.data;
          setForm({
            project_id: project.project_id || '',
            name: project.name || '',
            client_name: project.client_name || '',
            client_contact_details: project.client_contact_details || '',
            project_location_country: project.project_location_country || '',
            project_location_city: project.project_location_city || '',
            project_location_site: project.project_location_site || '',
            industry: project.industry || '',
            contract_type: project.contract_type || project.type || '',
            company_id: project.company_id || '',
            project_manager: project.project_manager || '',
            start_date: project.start_date || '',
            end_date: project.end_date || '',
            target_date: project.target_date || '',
            project_duration_planned: project.project_duration_planned || '',
            project_duration_actual: project.project_duration_actual || '',
            status: project.status || 'Ongoing',
            priority: project.priority || 'MEDIUM',
            progress: project.progress || 0,
            assigned_to: project.assigned_to || '',
            type: project.type || 'EPC',
            description: project.description || '',
            notes: project.notes || '',
            proposal_id: project.proposal_id || '',
            project_value: project.project_value || '',
            currency: project.currency || 'INR',
            payment_terms: project.payment_terms || '',
            invoicing_status: project.invoicing_status || '',
            cost_to_company: project.cost_to_company || '',
            profitability_estimate: project.profitability_estimate || '',
            subcontractors_vendors: project.subcontractors_vendors || '',
            budget: project.budget || '',
            procurement_status: project.procurement_status || '',
            material_delivery_schedule: project.material_delivery_schedule || '',
            vendor_management: project.vendor_management || '',
            mobilization_date: project.mobilization_date || '',
            site_readiness: project.site_readiness || '',
            construction_progress: project.construction_progress || '',
            major_risks: project.major_risks || '',
            mitigation_plans: project.mitigation_plans || '',
            change_orders: project.change_orders || '',
            claims_disputes: project.claims_disputes || '',
            final_documentation_status: project.final_documentation_status || '',
            lessons_learned: project.lessons_learned || '',
            client_feedback: project.client_feedback || '',
            actual_profit_loss: project.actual_profit_loss || ''
          });

          // Load team members
          if (project.team_members) {
            try {
              const parsed = typeof project.team_members === 'string' 
                ? JSON.parse(project.team_members) 
                : project.team_members;
              setTeamMembers(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              setTeamMembers([]);
            }
          }

          // Load project activities
          if (project.project_activities_list) {
            try {
              const parsed = typeof project.project_activities_list === 'string' 
                ? JSON.parse(project.project_activities_list) 
                : project.project_activities_list;
              setProjectActivities(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              setProjectActivities([]);
            }
          }
        } else {
          setError(result.error || 'Failed to load project');
        }
      } catch (error) {
        console.error('Failed to fetch project', error);
        setError(error?.message || 'Unable to load project');
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [id]);

  // Note: projectActivities is loaded from database or manually selected by user
  // It's not auto-populated from Activity Master to allow users to select specific activities

  // Auto-save with debouncing
  const [autoSaveTimeout, setAutoSaveTimeout] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [saving, setSaving] = useState(false);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
    };
  }, [autoSaveTimeout]);

  const autoSave = async (formData) => {
    try {
      setSaving(true);
      const result = await fetchJSON(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          projectActivities,
          teamMembers
        }),
      });

      if (result.success) {
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    const newForm = { ...form, [name]: value };
    setForm(newForm);

    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    // Set new timeout for auto-save (2 seconds after user stops typing)
    const timeout = setTimeout(() => {
      autoSave(newForm);
    }, 2000);
    
    setAutoSaveTimeout(timeout);
  };

  const handleProgressChange = (event) => {
    const value = Number(event.target.value);
    setForm((prev) => ({ ...prev, progress: Number.isNaN(value) ? 0 : value }));
  };

  // Project Activities Management
  const toggleProjectActivity = (activityId, type) => {
    let activity = null;
    let functionId = null;
    
    if (type === 'activity') {
      // Find activity in nested structure
      for (const func of functions) {
        const found = func.activities?.find(a => a.id === activityId);
        if (found) {
          activity = found;
          functionId = func.id;
          break;
        }
      }
    } else {
      // Find sub-activity in nested structure
      for (const func of functions) {
        for (const act of (func.activities || [])) {
          const found = act.subActivities?.find(sa => sa.id === activityId);
          if (found) {
            activity = found;
            functionId = func.id;
            break;
          }
        }
        if (activity) break;
      }
    }
    
    if (!activity) return;

    const exists = projectActivities.find(pa => pa.id === activityId && pa.type === type);
    
    if (exists) {
      setProjectActivities(projectActivities.filter(pa => !(pa.id === activityId && pa.type === type)));
    } else {
      setProjectActivities([...projectActivities, {
        id: activityId,
        type,
        name: activity.activity_name || activity.name,
        function_id: functionId,
        activity_id: activity.activity_id || null
      }]);
    }
  };

  // Toggle activity expansion
  const toggleActivityExpansion = (activityKey) => {
    setExpandedActivities(prev => ({
      ...prev,
      [activityKey]: !prev[activityKey]
    }));
  };

  // Team Member Management
  const addTeamMember = () => {
    setTeamMembers([...teamMembers, {
      id: Date.now(),
      employee_id: '',
      activity_id: '',
      discipline: '',
      sub_activity: '',
      required_hours: '',
      actual_hours: '',
      planned_start_date: '',
      planned_end_date: '',
      actual_completion_date: '',
      cost: '',
      manhours: 0
    }]);
  };

  const removeTeamMember = (id) => {
    setTeamMembers(teamMembers.filter(member => member.id !== id));
  };

  const updateTeamMember = (id, field, value) => {
    setTeamMembers(teamMembers.map(member => {
      if (member.id === id) {
        const updated = { ...member, [field]: value };
        // numeric derived fields
        if (field === 'required_hours') {
          updated.manhours = parseFloat(value) || 0;
        }
        // when discipline changes, clear activity and sub-activity to avoid mismatches
        if (field === 'discipline') {
          updated.activity_id = '';
          updated.sub_activity = '';
        }
        // when activity changes, clear any selected sub_activity
        if (field === 'activity_id') {
          updated.sub_activity = '';
        }
        return updated;
      }
      return member;
    }));
  };

  // File Management
  const handleFileUpload = async (files, documentType) => {
    if (!files || files.length === 0) return;
    
    setUploadingFiles(true);
    
    try {
      const uploadedFiles = [];
      
      for (const file of Array.from(files)) {
        // Validate file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          alert(`File ${file.name} is too large. Maximum size is 10MB.`);
          continue;
        }
        
        // Validate file type
        const allowedTypes = ['.pdf', '.docx', '.doc', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        if (!allowedTypes.includes(fileExtension)) {
          alert(`File ${file.name} type is not supported. Allowed: PDF, DOCX, XLS, PNG, JPG`);
          continue;
        }
        
        // Generate version number
        const existingFiles = documentType === 'input' ? inputDocuments : deliverables;
        const baseName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
        const existingVersions = existingFiles.filter(f => f.name.startsWith(baseName));
        const version = existingVersions.length > 0 ? `v${existingVersions.length + 1}.0` : 'v1.0';
        
        // Create file object
        const fileObj = {
          id: Date.now() + Math.random(),
          name: file.name,
          version: version,
          size: file.size,
          type: file.type,
          uploadDate: new Date().toISOString(),
          tag: 'Reference', // Default tag
          file: file // Store actual file for upload
        };
        
        uploadedFiles.push(fileObj);
      }
      
      // Update appropriate state
      if (documentType === 'input') {
        setInputDocuments(prev => [...prev, ...uploadedFiles]);
      } else {
        setDeliverables(prev => [...prev, ...uploadedFiles]);
      }
      
    } catch (error) {
      console.error('File upload error:', error);
      alert('Failed to upload files');
    } finally {
      setUploadingFiles(false);
    }
  };

  const removeFile = (fileId, documentType) => {
    if (documentType === 'input') {
      setInputDocuments(prev => prev.filter(f => f.id !== fileId));
    } else {
      setDeliverables(prev => prev.filter(f => f.id !== fileId));
    }
  };

  const updateFileTag = (fileId, tag, documentType) => {
    if (documentType === 'input') {
      setInputDocuments(prev => prev.map(f => f.id === fileId ? { ...f, tag } : f));
    } else {
      setDeliverables(prev => prev.map(f => f.id === fileId ? { ...f, tag } : f));
    }
  };

  // Calculate totals
  const totalManhours = useMemo(() => {
    return teamMembers.reduce((sum, member) => sum + (parseFloat(member.manhours) || 0), 0);
  }, [teamMembers]);

  const totalCost = useMemo(() => {
    return teamMembers.reduce((sum, member) => sum + (parseFloat(member.cost) || 0), 0);
  }, [teamMembers]);

  const handleCancel = () => {
    router.push(`/projects/${id}`);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      alert('Project name is required');
      return;
    }
    if (!form.company_id) {
      alert('Company is required');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        project_duration_planned: form.project_duration_planned ? Number(form.project_duration_planned) : null,
        project_duration_actual: form.project_duration_actual ? Number(form.project_duration_actual) : null,
        project_value: form.project_value ? Number(form.project_value) : null,
        cost_to_company: form.cost_to_company ? Number(form.cost_to_company) : null,
        profitability_estimate: form.profitability_estimate ? Number(form.profitability_estimate) : null,
        budget: form.budget ? Number(form.budget) : null,
        actual_profit_loss: form.actual_profit_loss ? Number(form.actual_profit_loss) : null,
        progress: Number(form.progress) || 0,
        team_members: JSON.stringify(teamMembers),
        project_activities_list: JSON.stringify(projectActivities)
      };

      const result = await fetchJSON(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (result.success) {
        router.push(`/projects/${id}`);
      } else {
        alert(result.error || 'Failed to update project');
      }
    } catch (error) {
      console.error('Project update error', error);
      alert(error?.message || 'Failed to update project');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingFallback />;

  if (error) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <button onClick={() => router.push('/projects')} className="text-sm text-[#7F2487] hover:underline">
              Back to Projects
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
        <div className="h-full overflow-y-auto">
          <form onSubmit={handleSubmit} className="px-8 pt-22 pb-8 space-y-6">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-black transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-1" />
                  Back to Project
                </button>
                <h1 className="mt-3 text-2xl font-bold text-black">Edit Project</h1>
                <p className="text-sm text-gray-600">
                  Comprehensive project management with activities and team builder
                </p>
              </div>
              
              {/* Auto-save Status */}
              <div className="flex items-center space-x-3">
                {saving && (
                  <div className="flex items-center text-xs text-blue-600">
                    <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </div>
                )}
                
                {lastSaved && !saving && (
                  <div className="flex items-center text-xs text-green-600">
                    <CheckCircleIcon className="h-3 w-3 mr-1" />
                    Saved {new Date(lastSaved).toLocaleTimeString()}
                  </div>
                )}
                
                <button
                  type="submit"
                  disabled={submitting || saving}
                  className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Saving...' : 'Save Project'}
                </button>
              </div>
            </header>

            {/* Tab Navigation */}
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-3 overflow-x-auto">
                <div className="flex space-x-1 min-w-max">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                        activeTab === tab.id
                          ? 'bg-[#7F2487] text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-sm font-semibold text-black">General Project Information</h2>
                  </div>
                  <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Project ID / Code</label>
                      <input type="text" name="project_id" value={form.project_id} onChange={handleChange} placeholder="e.g., 001-10-2024" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Project Name *</label>
                      <input type="text" name="name" value={form.name} onChange={handleChange} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Client Name</label>
                      <input type="text" name="client_name" value={form.client_name} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Company *</label>
                      <select name="company_id" value={form.company_id} onChange={handleChange} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                        <option value="">Select company</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.company_name || c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-black mb-1">Client Contact Details</label>
                      <textarea name="client_contact_details" value={form.client_contact_details} onChange={handleChange} rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Location - Country</label>
                      <input type="text" name="project_location_country" value={form.project_location_country} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Location - City</label>
                      <input type="text" name="project_location_city" value={form.project_location_city} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Location - Site</label>
                      <input type="text" name="project_location_site" value={form.project_location_site} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Industry</label>
                      <select name="industry" value={form.industry} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                        <option value="">Select Industry</option>
                        {INDUSTRY_OPTIONS.map((ind) => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Contract Type</label>
                      <select name="contract_type" value={form.contract_type} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                        <option value="">Select Type</option>
                        {TYPE_OPTIONS.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Project Manager</label>
                      <input type="text" name="project_manager" value={form.project_manager} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Start Date</label>
                      <input type="date" name="start_date" value={form.start_date} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">End Date</label>
                      <input type="date" name="end_date" value={form.end_date} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Duration Planned (days)</label>
                      <input type="number" name="project_duration_planned" value={form.project_duration_planned} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Duration Actual (days)</label>
                      <input type="number" name="project_duration_actual" value={form.project_duration_actual} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Status</label>
                      <select name="status" value={form.status} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                        {STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Priority</label>
                      <select name="priority" value={form.priority} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                        {PRIORITY_OPTIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Assigned To</label>
                      <input type="text" name="assigned_to" value={form.assigned_to} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-black mb-1">Progress (%)</label>
                      <input type="range" value={form.progress} min="0" max="100" onChange={handleProgressChange} className="w-full" />
                      <p className="text-xs text-gray-500 mt-1">{form.progress}% complete</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-black mb-1">Description</label>
                      <textarea name="description" value={form.description} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                  </div>
                </section>

                {/* Enhanced Meeting & Documents with Collapsible Sections */}
                <div className="space-y-4">
                  {/* Section 1: Project Planning */}
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedSections(prev => ({ ...prev, planning: !prev.planning }))}
                      className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                    >
                      <div>
                        <h3 className="text-sm font-semibold text-black flex items-center">
                          Project Planning
                          <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">2 items</span>
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">Schedule, deliverables, and project roadmap</p>
                      </div>
                      {expandedSections.planning ? 
                        <ChevronDownIcon className="h-5 w-5 text-gray-400" /> : 
                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                      }
                    </button>
                    
                    {expandedSections.planning && (
                      <div className="px-6 pb-5 border-t border-gray-100 space-y-4">
                        {/* Project Schedule with Timeline */}
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                          <label className="block text-sm font-medium text-blue-900 mb-3 flex items-center">
                            Project Schedule & Timeline
                          </label>
                          
                          {/* Date Pickers for Key Milestones */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                            <div>
                              <label className="block text-xs font-medium text-blue-800 mb-1">Project Start</label>
                              <input 
                                type="date" 
                                name="project_start_milestone" 
                                value={form.project_start_milestone || form.start_date} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500" 
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-blue-800 mb-1">Mid Review</label>
                              <input 
                                type="date" 
                                name="project_review_milestone" 
                                value={form.project_review_milestone || ''} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500" 
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-blue-800 mb-1">Project End</label>
                              <input 
                                type="date" 
                                name="project_end_milestone" 
                                value={form.project_end_milestone || form.end_date} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500" 
                              />
                            </div>
                          </div>
                          
                          <textarea 
                            name="project_schedule" 
                            value={form.project_schedule} 
                            onChange={handleChange} 
                            rows={3} 
                            placeholder="Define phases, milestones, and key deliverables timeline..." 
                            className="w-full px-3 py-2 text-sm border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500 bg-white" 
                          />
                        </div>

                        {/* List of Deliverables with Tagging */}
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
                          <label className="block text-sm font-medium text-green-900 mb-3 flex items-center">
                            Project Deliverables
                          </label>
                          <textarea 
                            name="list_of_deliverables" 
                            value={form.list_of_deliverables} 
                            onChange={handleChange} 
                            rows={3} 
                            placeholder="List all deliverables with status tags: [FINAL], [DRAFT], [REFERENCE]..." 
                            className="w-full px-3 py-2 text-sm border border-green-300 rounded-md focus:ring-2 focus:ring-green-500 bg-white" 
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">Final</span>
                            <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">Draft</span>
                            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">Reference</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Section 2: Documentation */}
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedSections(prev => ({ ...prev, documentation: !prev.documentation }))}
                      className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                    >
                      <div>
                        <h3 className="text-sm font-semibold text-black flex items-center">
                          Documentation
                          <span className="ml-2 px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-full">Input Docs</span>
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">Input documents, references, and file management</p>
                      </div>
                      {expandedSections.documentation ? 
                        <ChevronDownIcon className="h-5 w-5 text-gray-400" /> : 
                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                      }
                    </button>
                    
                    {expandedSections.documentation && (
                      <div className="px-6 pb-5 border-t border-gray-100">
                        <div className="bg-gradient-to-r from-purple-50 to-violet-50 p-4 rounded-lg border border-purple-200">
                          <label className="block text-sm font-medium text-purple-900 mb-3 flex items-center">
                            Input Documents & References
                          </label>
                          
                          {/* File Upload Area */}
                          <div className="mb-4 p-4 border-2 border-dashed border-purple-300 rounded-lg bg-white hover:border-purple-400 transition-colors">
                            <input
                              type="file"
                              multiple
                              accept=".pdf,.docx,.doc,.xls,.xlsx,.png,.jpg,.jpeg"
                              onChange={(e) => handleFileUpload(e.target.files, 'input')}
                              className="hidden"
                              id="input-file-upload"
                            />
                            <div className="text-center">
                              <svg className="mx-auto h-8 w-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                              <p className="mt-1 text-xs text-purple-600">
                                <label htmlFor="input-file-upload" className="font-medium text-purple-700 hover:text-purple-800 cursor-pointer">Upload files</label>
                                {' '}or drag and drop
                              </p>
                              <p className="text-xs text-purple-500">PDF, DOCX, XLS up to 10MB</p>
                            </div>
                          </div>

                          {/* Uploaded Files List */}
                          {inputDocuments.length > 0 && (
                            <div className="mb-4 space-y-2">
                              {inputDocuments.map((file) => (
                                <div key={file.id} className="flex items-center justify-between p-3 bg-white border border-purple-200 rounded-lg">
                                  <div className="flex items-center space-x-3">
                                    <div className="flex-shrink-0">
                                      <DocumentIcon className="h-5 w-5 text-purple-500" />
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                                      <p className="text-xs text-gray-500">
                                        {file.version} • {(file.size / 1024 / 1024).toFixed(2)} MB • {new Date(file.uploadDate).toLocaleDateString()}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <select
                                      value={file.tag}
                                      onChange={(e) => updateFileTag(file.id, e.target.value, 'input')}
                                      className="text-xs border border-purple-300 rounded px-2 py-1"
                                    >
                                      <option value="Reference">Reference</option>
                                      <option value="Final">Final</option>
                                      <option value="Client Input">Client Input</option>
                                      <option value="Draft">Draft</option>
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => removeFile(file.id, 'input')}
                                      className="text-red-500 hover:text-red-700"
                                    >
                                      <XMarkIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          
                          <textarea 
                            name="input_document" 
                            value={form.input_document} 
                            onChange={handleChange} 
                            rows={3} 
                            placeholder="List input documents, specifications, references, client requirements..." 
                            className="w-full px-3 py-2 text-sm border border-purple-300 rounded-md focus:ring-2 focus:ring-purple-500 bg-white" 
                          />
                          
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-full">Specs v2.1</span>
                            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">Drawings v1.3</span>
                            <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded-full">Requirements v1.0</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Section 3: Meetings */}
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedSections(prev => ({ ...prev, meetings: !prev.meetings }))}
                      className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                    >
                      <div>
                        <h3 className="text-sm font-semibold text-black flex items-center">
                          Meetings & Communications
                          <span className="ml-2 px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded-full">2 types</span>
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">Kickoff meetings, internal discussions, and follow-ups</p>
                      </div>
                      {expandedSections.meetings ? 
                        <ChevronDownIcon className="h-5 w-5 text-gray-400" /> : 
                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                      }
                    </button>
                    
                    {expandedSections.meetings && (
                      <div className="px-6 pb-5 border-t border-gray-100 space-y-4">
                        {/* Kickoff Meeting */}
                        <div className="bg-gradient-to-r from-orange-50 to-red-50 p-4 rounded-lg border border-orange-200">
                          <label className="block text-sm font-medium text-orange-900 mb-3 flex items-center">
                            Kickoff Meeting
                          </label>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-medium text-orange-800 mb-1">Meeting Date</label>
                              <input 
                                type="datetime-local" 
                                name="kickoff_meeting_date" 
                                value={form.kickoff_meeting_date || ''} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-orange-300 rounded-md focus:ring-2 focus:ring-orange-500" 
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-orange-800 mb-1">Next Follow-up</label>
                              <input 
                                type="date" 
                                name="kickoff_followup_date" 
                                value={form.kickoff_followup_date || ''} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-orange-300 rounded-md focus:ring-2 focus:ring-orange-500" 
                              />
                            </div>
                          </div>
                          
                          <textarea 
                            name="kickoff_meeting" 
                            value={form.kickoff_meeting} 
                            onChange={handleChange} 
                            rows={3} 
                            placeholder="Participants, agenda, key decisions, action items..." 
                            className="w-full px-3 py-2 text-sm border border-orange-300 rounded-md focus:ring-2 focus:ring-orange-500 bg-white" 
                          />
                        </div>

                        {/* In-House Meeting */}
                        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-4 rounded-lg border border-indigo-200">
                          <label className="block text-sm font-medium text-indigo-900 mb-3 flex items-center">
                            Internal Team Meetings
                          </label>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-medium text-indigo-800 mb-1">Last Meeting</label>
                              <input 
                                type="datetime-local" 
                                name="internal_meeting_date" 
                                value={form.internal_meeting_date || ''} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500" 
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-indigo-800 mb-1">Next Scheduled</label>
                              <input 
                                type="datetime-local" 
                                name="next_internal_meeting" 
                                value={form.next_internal_meeting || ''} 
                                onChange={handleChange} 
                                className="w-full px-3 py-2 text-sm border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500" 
                              />
                            </div>
                          </div>
                          
                          <textarea 
                            name="in_house_meeting" 
                            value={form.in_house_meeting} 
                            onChange={handleChange} 
                            rows={3} 
                            placeholder="Team discussions, progress updates, internal decisions, blockers..." 
                            className="w-full px-3 py-2 text-sm border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 bg-white" 
                          />
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {/* Commercial Tab */}
            {activeTab === 'commercial' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Commercial Details</h2>
                </div>
                <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Project Value</label>
                    <input type="number" name="project_value" value={form.project_value} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Currency</label>
                    <select name="currency" value={form.currency} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                      {CURRENCY_OPTIONS.map((c) => (<option key={c} value={c}>{c}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Payment Terms</label>
                    <select name="payment_terms" value={form.payment_terms} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                      <option value="">Select Terms</option>
                      {PAYMENT_TERMS_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Invoicing Status</label>
                    <select name="invoicing_status" value={form.invoicing_status} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                      <option value="">Select Status</option>
                      {INVOICING_STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Cost to Company</label>
                    <input type="number" name="cost_to_company" value={form.cost_to_company} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Profitability Estimate (%)</label>
                    <input type="number" name="profitability_estimate" value={form.profitability_estimate} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Budget</label>
                    <input type="number" name="budget" value={form.budget} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-black mb-1">Subcontractors / Vendors</label>
                    <textarea name="subcontractors_vendors" value={form.subcontractors_vendors} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                </div>
              </section>
            )}

            {/* Activities Tab */}
            {activeTab === 'activities' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Activities from Master</h2>
                  <p className="text-xs text-gray-500">Select activities and choose sub-activities using the dropdown text box</p>
                </div>
                <div className="px-6 py-5">
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-xs font-semibold text-blue-900">Selected Activities: {projectActivities.length}</p>
                  </div>
                  
                  {/* Table View with Dropdown Sub-activities */}
                  <div className="overflow-x-auto">
                    {functions.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p className="text-sm">No disciplines/functions found in Activity Master.</p>
                        <p className="text-xs mt-2">Please add functions and activities in the Activity Master.</p>
                      </div>
                    ) : (
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-100 border-b-2 border-gray-300">
                            <th className="text-left py-3 px-4 font-semibold w-1/3">Discipline</th>
                            <th className="text-left py-3 px-4 font-semibold w-1/3">Activity</th>
                            <th className="text-left py-3 px-4 font-semibold w-1/3">Sub-Activity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {functions.map((func) => {
                            const funcActivities = func.activities || [];
                            
                            if (funcActivities.length === 0) {
                              return (
                                <tr key={func.id} className="border-b border-gray-200">
                                  <td className="py-3 px-4">
                                    <span className="font-semibold text-[#7F2487]">{func.function_name}</span>
                                  </td>
                                  <td className="py-3 px-4 text-gray-400 italic" colSpan="2">No activities defined</td>
                                </tr>
                              );
                            }
                            
                            return funcActivities.map((activity, actIdx) => {
                              const activityKey = `${func.id}-${activity.id}`;
                              const activitySubActivities = activity.subActivities || [];
                              const hasSubActivities = activitySubActivities.length > 0;
                              const isActivitySelected = projectActivities.some(pa => pa.id === activity.id && pa.type === 'activity');
                              const open = !!openSubActivityDropdowns[activityKey];
                              const query = subActivitySearch[activityKey] || '';
                              const filteredSubActivities = query
                                ? activitySubActivities.filter(sa => sa.name.toLowerCase().includes(query.toLowerCase()))
                                : activitySubActivities;
                              const selectedSubActivities = projectActivities.filter(pa => pa.type === 'subactivity' && pa.activity_id === activity.id);
                              
                              return (
                                <Fragment key={activityKey}>
                                  {/* Main Activity Row */}
                                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                                    <td className="py-3 px-4">
                                      {actIdx === 0 && (
                                        <span className="font-semibold text-[#7F2487]">{func.function_name}</span>
                                      )}
                                    </td>
                                    <td className="py-3 px-4">
                                      <div className="flex items-center space-x-2">
                                        {/* Activity Checkbox */}
                                        <label className="flex items-center space-x-2 cursor-pointer flex-1">
                                          <input
                                            type="checkbox"
                                            checked={isActivitySelected}
                                            onChange={() => toggleProjectActivity(activity.id, 'activity')}
                                            className="w-4 h-4 text-[#7F2487] rounded focus:ring-[#7F2487]"
                                          />
                                          <span className="text-sm text-black font-medium">{activity.activity_name}</span>
                                        </label>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4">
                                      {hasSubActivities ? (
                                        <div className="relative">
                                          {/* Trigger input-like button */}
                                          <button
                                            type="button"
                                            onClick={() => setOpenSubActivityDropdowns(prev => ({ ...prev, [activityKey]: !prev[activityKey] }))}
                                            className="w-full text-left px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:ring-2 focus:ring-[#7F2487]"
                                          >
                                            {selectedSubActivities.length > 0
                                              ? `${selectedSubActivities.length} selected`
                                              : 'Select sub-activities'}
                                          </button>

                                          {/* Dropdown Panel */}
                                          {open && (
                                            <div className="absolute z-10 mt-1 w-72 max-w-[80vw] bg-white border border-gray-200 rounded-md shadow-lg p-2">
                                              <div className="flex items-center gap-2 mb-2">
                                                <input
                                                  type="text"
                                                  value={query}
                                                  onChange={(e) => setSubActivitySearch(prev => ({ ...prev, [activityKey]: e.target.value }))}
                                                  placeholder="Search…"
                                                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => setOpenSubActivityDropdowns(prev => ({ ...prev, [activityKey]: false }))}
                                                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                                >
                                                  Done
                                                </button>
                                              </div>
                                              <div className="max-h-48 overflow-auto pr-1">
                                                {filteredSubActivities.length === 0 ? (
                                                  <div className="text-xs text-gray-500 p-2">No matching sub-activities</div>
                                                ) : (
                                                  filteredSubActivities.map((subActivity) => {
                                                    const isSubActivitySelected = projectActivities.some(
                                                      pa => pa.id === subActivity.id && pa.type === 'subactivity'
                                                    );
                                                    return (
                                                      <label key={subActivity.id} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                                                        <input
                                                          type="checkbox"
                                                          checked={isSubActivitySelected}
                                                          onChange={() => toggleProjectActivity(subActivity.id, 'subactivity')}
                                                          className="w-3.5 h-3.5 text-[#7F2487] rounded focus:ring-[#7F2487]"
                                                        />
                                                        <span className="text-xs text-gray-700">{subActivity.name}</span>
                                                      </label>
                                                    );
                                                  })
                                                )}
                                              </div>
                                              {selectedSubActivities.length > 0 && (
                                                <div className="mt-2 flex items-center justify-between gap-2">
                                                  <div className="flex flex-wrap gap-1">
                                                    {selectedSubActivities.slice(0,3).map(sa => (
                                                      <span key={sa.id} className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                                                        {sa.name}
                                                      </span>
                                                    ))}
                                                    {selectedSubActivities.length > 3 && (
                                                      <span className="text-[10px] text-gray-500">+{selectedSubActivities.length - 3} more</span>
                                                    )}
                                                  </div>
                                                  <button
                                                    type="button"
                                                    onClick={() => setProjectActivities(projectActivities.filter(pa => !(pa.type === 'subactivity' && pa.activity_id === activity.id)))}
                                                    className="text-[10px] text-red-700 hover:underline"
                                                  >
                                                    Clear
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                  </tr>
                                </Fragment>
                              );
                            });
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Selected Activities Summary */}
                  {projectActivities.length > 0 && (
                    <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-md">
                      <h4 className="text-sm font-semibold text-green-900 mb-2">Selected for this Project:</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {projectActivities.map((pa, idx) => (
                          <div key={idx} className="text-xs text-green-800 flex items-center">
                            <CheckCircleIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                            <span className="truncate">{pa.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Team Builder Tab */}
            {activeTab === 'team' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-black">Project Team</h2>
                    <p className="text-xs text-gray-500">Assign employees to activities with hours and costs</p>
                  </div>
                  <button
                    type="button"
                    onClick={addTeamMember}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72]"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Team Member
                  </button>
                </div>
                <div className="px-6 py-5">
                  {/* Summary */}
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-xs font-semibold text-blue-900">Total Manhours: {totalManhours.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-xs font-semibold text-green-900">Total Cost: {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(totalCost)}</p>
                    </div>
                  </div>

                  {teamMembers.length === 0 ? (
                    <div className="text-center py-12 text-sm text-gray-500">
                      No team members assigned. Click "Add Team Member" to begin.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-100 border-b-2 border-gray-300">
                            <th className="text-left py-2 px-3 font-semibold">Name</th>
                            <th className="text-left py-2 px-3 font-semibold">Discipline</th>
                            <th className="text-left py-2 px-3 font-semibold">Activity</th>
                            <th className="text-left py-2 px-3 font-semibold">Sub-Activity</th>
                            <th className="text-left py-2 px-3 font-semibold">Required Hours</th>
                            <th className="text-left py-2 px-3 font-semibold">Actual Hours</th>
                            <th className="text-left py-2 px-3 font-semibold">Start Date</th>
                            <th className="text-left py-2 px-3 font-semibold">End Date</th>
                            <th className="text-left py-2 px-3 font-semibold">Actual Date</th>
                            <th className="text-left py-2 px-3 font-semibold">Manhours</th>
                            <th className="text-left py-2 px-3 font-semibold">Cost</th>
                            <th className="text-center py-2 px-3 font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamMembers.map((member) => {
                            const employee = employees.find(e => String(e.id) === String(member.employee_id));
                            const selectedActivity = projectActivities.find(pa => String(pa.id) === String(member.activity_id) && pa.type === 'activity');

                            // Find the function/discipline for this activity or use explicit member.discipline
                            let functionName = '—';
                            if (member.discipline) {
                              const func = functions.find(f => String(f.id) === String(member.discipline));
                              if (func) functionName = func.function_name;
                            } else if (selectedActivity && selectedActivity.function_id) {
                              const func = functions.find(f => String(f.id) === String(selectedActivity.function_id));
                              if (func) functionName = func.function_name;
                            }
                            
                            return (
                              <tr key={member.id} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="py-2 px-3">
                                  <select
                                    value={member.employee_id}
                                    onChange={(e) => updateTeamMember(member.id, 'employee_id', e.target.value)}
                                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  >
                                    <option value="">Select Employee</option>
                                    {employees.map((emp) => (
                                      <option key={emp.id} value={emp.id}>
                                        {emp.first_name} {emp.last_name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                    <td className="py-2 px-3">
                                      <select
                                        value={member.discipline || ''}
                                        onChange={(e) => updateTeamMember(member.id, 'discipline', e.target.value)}
                                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                      >
                                        <option value="">Select Discipline</option>
                                        {functions.map((f) => (
                                          <option key={f.id} value={f.id}>{f.function_name}</option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="py-2 px-3">
                                      <select
                                        value={member.activity_id}
                                        onChange={(e) => updateTeamMember(member.id, 'activity_id', e.target.value)}
                                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                      >
                                        <option value="">Select Activity</option>
                                        {projectActivities
                                          .filter(pa => pa.type === 'activity' && (!member.discipline || String(pa.function_id) === String(member.discipline)))
                                          .map((pa) => (
                                            <option key={`${pa.id}-${pa.type}`} value={pa.id}>
                                              {pa.name}
                                            </option>
                                          ))}
                                      </select>
                                    </td>
                                <td className="py-2 px-3">
                                  <select
                                    value={member.sub_activity || ''}
                                    onChange={(e) => updateTeamMember(member.id, 'sub_activity', e.target.value)}
                                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  >
                                    <option value="">Select Sub-Activity</option>
                                    {projectActivities
                                      .filter(pa => pa.type === 'subactivity' && String(pa.activity_id) === String(member.activity_id))
                                      .map((pa) => (
                                        <option key={`${pa.id}-${pa.type}`} value={pa.id}>
                                          {pa.name}
                                        </option>
                                      ))}
                                  </select>
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="number"
                                    value={member.required_hours}
                                    onChange={(e) => updateTeamMember(member.id, 'required_hours', e.target.value)}
                                    min="0"
                                    step="0.1"
                                    className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="number"
                                    value={member.actual_hours}
                                    onChange={(e) => updateTeamMember(member.id, 'actual_hours', e.target.value)}
                                    min="0"
                                    step="0.1"
                                    className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="date"
                                    value={member.planned_start_date || ''}
                                    onChange={(e) => updateTeamMember(member.id, 'planned_start_date', e.target.value)}
                                    className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="date"
                                    value={member.planned_end_date}
                                    onChange={(e) => updateTeamMember(member.id, 'planned_end_date', e.target.value)}
                                    className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="date"
                                    value={member.actual_completion_date}
                                    onChange={(e) => updateTeamMember(member.id, 'actual_completion_date', e.target.value)}
                                    className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="number"
                                    value={member.manhours}
                                    readOnly
                                    className="w-20 px-2 py-1 text-xs border border-gray-300 rounded bg-gray-50"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="number"
                                    value={member.cost}
                                    onChange={(e) => updateTeamMember(member.id, 'cost', e.target.value)}
                                    min="0"
                                    step="0.01"
                                    className="w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeTeamMember(member.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-red-100 text-red-700 hover:bg-red-200"
                                  >
                                    <TrashIcon className="h-3 w-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Procurement Tab */}
            {activeTab === 'procurement' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Procurement & Material</h2>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Procurement Status</label>
                    <select name="procurement_status" value={form.procurement_status} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                      <option value="">Select Status</option>
                      {PROCUREMENT_STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Material Delivery Schedule</label>
                    <textarea name="material_delivery_schedule" value={form.material_delivery_schedule} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Vendor Management</label>
                    <textarea name="vendor_management" value={form.vendor_management} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                </div>
              </section>
            )}

            {/* Construction Tab */}
            {activeTab === 'construction' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Construction / Site</h2>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Mobilization Date</label>
                    <input type="date" name="mobilization_date" value={form.mobilization_date} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Site Readiness</label>
                    <select name="site_readiness" value={form.site_readiness} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                      <option value="">Select Status</option>
                      {SITE_READINESS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Construction Progress</label>
                    <textarea name="construction_progress" value={form.construction_progress} onChange={handleChange} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                </div>
              </section>
            )}

            {/* Risk Tab */}
            {activeTab === 'risk' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Risk & Issues</h2>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Major Risks</label>
                    <textarea name="major_risks" value={form.major_risks} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Mitigation Plans</label>
                    <textarea name="mitigation_plans" value={form.mitigation_plans} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Change Orders</label>
                    <textarea name="change_orders" value={form.change_orders} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Claims / Disputes</label>
                    <textarea name="claims_disputes" value={form.claims_disputes} onChange={handleChange} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                </div>
              </section>
            )}

            {/* Closeout Tab */}
            {activeTab === 'closeout' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Closeout</h2>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Documentation Status</label>
                    <select name="final_documentation_status" value={form.final_documentation_status} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                      <option value="">Select Status</option>
                      {DOCUMENTATION_STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Actual Profit/Loss</label>
                    <input type="number" name="actual_profit_loss" value={form.actual_profit_loss} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Lessons Learned</label>
                    <textarea name="lessons_learned" value={form.lessons_learned} onChange={handleChange} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Client Feedback</label>
                    <textarea name="client_feedback" value={form.client_feedback} onChange={handleChange} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Additional Notes</label>
                    <textarea name="notes" value={form.notes} onChange={handleChange} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                  </div>
                </div>
              </section>
            )}

            {/* Submit Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 text-sm rounded-md bg-gray-100 text-black hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] disabled:opacity-60 disabled:cursor-not-allowed font-medium"
              >
                {submitting ? 'Saving…' : 'Update Project'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
