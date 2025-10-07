'use client';

import Navbar from '@/components/Navbar';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ChartBarIcon,
  PlusIcon,
  MinusIcon,
} from '@heroicons/react/24/outline';

const STATUS_OPTIONS = ['NEW', 'planning', 'in-progress', 'on-hold', 'completed', 'cancelled'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];
const TYPE_OPTIONS = ['ONGOING', 'CONSULTANCY', 'EPC', 'PMC'];

const INDUSTRY_OPTIONS = [
  'Oil & Gas', 'Petrochemical', 'Solar', 'Power', 'Infrastructure',
  'Water Treatment', 'Manufacturing', 'Mining', 'Chemical', 'Other'
];

const CONTRACT_TYPE_OPTIONS = [
  'EPC (Engineering, Procurement, Construction)',
  'Consultancy', 'PMC (Project Management Consultancy)',
  'Lump Sum', 'Reimbursable',
  'EPCC (Engineering, Procurement, Construction, Commissioning)',
  'FEED (Front End Engineering Design)', 'Detailed Engineering'
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'INR', label: 'INR - Indian Rupee' },
  { value: 'AED', label: 'AED - UAE Dirham' },
  { value: 'SAR', label: 'SAR - Saudi Riyal' },
  { value: 'QAR', label: 'QAR - Qatari Riyal' }
];

const COMMON_INPUT_CLASS = "w-full px-4 py-3 text-sm border border-gray-300 rounded-md";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-2";

const ORGANIZATIONAL_POSITIONS = [
  // Engineering Hierarchy
  'Engineering Head',
  'Manager - Engineering',
  'Project Manager - Engineering', 
  'Head - Business Development & Projects',
  // Engineering Roles
  'Lead Engineer',
  'Area Engineer', 
  'Sr. Engineer',
  'Trainee Engineer',
  // Design Roles
  'Lead 3D/2D Designer',
  'Sr. 3D/2D Designer',
  'Trainee 3D/2D Designer',
  // QA/QC Roles
  'QA/QC',
  'Doc Controller',
  'Checker',
  // Associates by Discipline
  'Associate - Process',
  'Associate - Mech. Static',
  'Associate - Civil/Structural',
  'Associate - E&D'
];

const REPORTING_STRUCTURE = {
  'Engineering Head': [],
  'Manager - Engineering': ['Engineering Head'],
  'Project Manager - Engineering': ['Engineering Head'],
  'Head - Business Development & Projects': ['Engineering Head'],
  'Lead Engineer': ['Manager - Engineering'],
  'Area Engineer': ['Manager - Engineering'],
  'Sr. Engineer': ['Manager - Engineering'],
  'Trainee Engineer': ['Manager - Engineering'],
  'Lead 3D/2D Designer': ['Manager - Engineering'],
  'Sr. 3D/2D Designer': ['Manager - Engineering'],
  'Trainee 3D/2D Designer': ['Manager - Engineering'],
  'QA/QC': ['Manager - Engineering'],
  'Doc Controller': ['Manager - Engineering'],
  'Checker': ['Manager - Engineering'],
  'Associate - Process': ['Head - Business Development & Projects'],
  'Associate - Mech. Static': ['Head - Business Development & Projects'],
  'Associate - Civil/Structural': ['Head - Business Development & Projects'],
  'Associate - E&D': ['Head - Business Development & Projects']
};

// Auto-generate project number with serial sequence
const generateProjectNumber = async () => {
  try {
    // Get the latest project to determine next serial number
    const response = await fetch('/api/projects');
    const data = await response.json();
    
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    
    // Find the highest serial number for current month/year
    let maxSerial = 0;
    if (data.success && Array.isArray(data.data)) {
      const currentPattern = `-${month}-${year}`;
      data.data.forEach(project => {
        if (project.project_id && project.project_id.endsWith(currentPattern)) {
          const serialPart = project.project_id.split('-')[0];
          const serial = parseInt(serialPart, 10);
          if (!isNaN(serial) && serial > maxSerial) {
            maxSerial = serial;
          }
        }
      });
    }
    
    const nextSerial = String(maxSerial + 1).padStart(3, '0');
    return `${nextSerial}-${month}-${year}`;
  } catch (error) {
    // Fallback to timestamp-based serial if API fails
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const srno = String(Date.now() % 999 + 1).padStart(3, '0');
    return `${srno}-${month}-${year}`;
  }
};

const INITIAL_FORM = {
  name: '',
  project_id: '',
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
  budget: '',
  status: 'NEW',
  priority: 'MEDIUM',
  progress: 0,
  assigned_to: '',
  type: 'ONGOING',
  description: '',
  notes: '',
  proposal_id: '',
  // Commercial Details
  project_value: '',
  currency: 'USD',
  payment_terms: '',
  invoicing_status: '',
  cost_to_company: '',
  profitability_estimate: '',
  subcontractors_vendors: '',
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
};

export default function EditProjectPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [companies, setCompanies] = useState([]);

  // activities
  const [activities, setActivities] = useState([]); // catalogue
  const [selectedActivities, setSelectedActivities] = useState([]); // project-level
  const [selectedDisciplines, setSelectedDisciplines] = useState([]); // project-level disciplines
  
  // Assignment management
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [assignmentForm, setAssignmentForm] = useState({
    employee_id: '',
    discipline_id: '',
    activity_id: '',
    sub_activity_id: '',
    organizational_position: '',
    reporting_manager: '',
    assigned_date: new Date().toISOString().slice(0, 10),
    assignment_status: 'Active',
    progress_percentage: '',
    budgeted_cost: '',
    actual_cost: '',
    resource_category: 'Internal',
    vendor_subcontractor: '',
    raci_role: 'Responsible',
    deliverables: [],
    manhours_estimated: '',
    manhours_actual: '',
    start_date: '',
    end_date: '',
    notes: ''
  });

  // Fetch project + companies + employees + users + activities
  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch core data in parallel
        const [projectRes, companyRes, employeesRes, usersRes, activitiesRes] = await Promise.all([
          fetch(`/api/projects/${id}`).catch(() => ({
            ok: false, 
            json: () => ({ success: false, error: 'Failed to fetch project' })
          })),
          fetch('/api/companies').catch(() => ({
            ok: false, 
            json: () => ({ success: false, error: 'Failed to fetch companies' })
          })),
          fetch('/api/employee-master').catch(() => ({
            ok: false, 
            json: () => Promise.resolve({ 
              success: false, 
              error: 'Failed to fetch employees from employee-master',
              data: []
            })
          })),
          fetch('/api/users').catch(() => ({
            ok: false, 
            json: () => ({ success: false, error: 'Failed to fetch users' })
          })),
          fetch('/api/activities').catch(() => ({
            ok: false, 
            json: () => ({ success: false, error: 'Failed to fetch activities' })
          }))
        ]);

        // Process responses with safe JSON parsing
        const [projectJson, companyJson, employeesJson, usersJson, activitiesJson] = await Promise.all([
          projectRes.json().catch(err => {
            console.error('❌ Failed to parse project JSON:', err);
            return { success: false, error: 'Invalid JSON response from project API' };
          }),
          companyRes.json().catch(err => {
            console.error('❌ Failed to parse company JSON:', err);
            return { success: false, error: 'Invalid JSON response from company API', data: [] };
          }),
          employeesRes.json().catch(err => {
            console.error('❌ Failed to parse employees JSON:', err);
            return { success: false, error: 'Invalid JSON response from employee-master API', data: [] };
          }),
          usersRes.json().catch(err => {
            console.error('❌ Failed to parse users JSON:', err);
            return { success: false, error: 'Invalid JSON response from users API', data: [] };
          }),
          activitiesRes.json().catch(err => {
            console.error('❌ Failed to parse activities JSON:', err);
            return { success: false, error: 'Invalid JSON response from activities API', data: [] };
          })
        ]);

        // Set data with error handling
        if (companyJson.success) {
          setCompanies(companyJson.data || []);
        }

        // Employee API handling
        if (employeesJson.success && employeesJson.data && Array.isArray(employeesJson.data)) {
          setEmployees(employeesJson.data);
        } else if (Array.isArray(employeesJson) && employeesJson.length > 0) {
          setEmployees(employeesJson);
        } else {
          
          // Try fallback endpoints
          const fallbackEndpoints = ['/api/employees', '/api/masters/employees'];
          let employeesLoaded = false;
          
          for (const endpoint of fallbackEndpoints) {
            if (employeesLoaded) break;
            try {
              const altRes = await fetch(endpoint);
              const altJson = await altRes.json();
              
              if (altJson.success && altJson.data && Array.isArray(altJson.data) && altJson.data.length > 0) {
                setEmployees(altJson.data);
                employeesLoaded = true;
              } else if (Array.isArray(altJson) && altJson.length > 0) {
                setEmployees(altJson);
                employeesLoaded = true;
              }
            } catch (altErr) {
              // Continue to next endpoint
            }
          }
          
          if (!employeesLoaded) {
            setEmployees([]);
          }
        }

        if (usersJson.success) {
          setUsers(usersJson.data || []);
        }

        if (activitiesJson.success) {
          setActivities(activitiesJson.data || []);
        }
        
        // Try to fetch documents
        try {
          const documentsRes = await fetch('/api/documents');
          const documentsJson = await documentsRes.json();
          if (documentsJson.success) {
            setDocuments(documentsJson.data || []);
          } else {
            setDocuments([]);
          }
        } catch (err) {
          setDocuments([]);
        }

        if (projectJson.success && projectJson.data) {
          const project = projectJson.data;

          // Safe JSON parse helper for fields that may be stored as strings in the DB
          const safeParse = (val, fallback) => {
            if (val == null) return fallback;
            if (typeof val === 'string') {
              try {
                return JSON.parse(val);
              } catch (err) {
                // if it's not valid JSON, return fallback
                return fallback;
              }
            }
            return val;
          };

          const parsedActivities = safeParse(project.activities, []);
          const parsedDisciplines = safeParse(project.disciplines, []);
          const parsedAssignments = safeParse(project.assignments, []);

          // Auto-generate project number if not exists
          const projectId = project.project_id || (await generateProjectNumber());
          
          setForm({
            ...INITIAL_FORM,
            ...project,
            project_id: projectId,
            start_date: project.start_date?.slice(0, 10) || '',
            end_date: project.end_date?.slice(0, 10) || '',
            target_date: project.target_date?.slice(0, 10) || '',
            mobilization_date: project.mobilization_date?.slice(0, 10) || '',
            disciplineDescriptions: project.discipline_descriptions || {},
          });

          // Load existing assignments
          if (Array.isArray(parsedAssignments)) {
            setAssignments(parsedAssignments);
          }

          // Load existing activities
          if (Array.isArray(parsedActivities) && parsedActivities.length > 0) {
            setSelectedActivities(parsedActivities.map((a) => String(a.id || a.activity_id || a)));
          }

          // Load existing disciplines
          if (Array.isArray(parsedDisciplines) && parsedDisciplines.length > 0) {
            setSelectedDisciplines(parsedDisciplines.map((d) => String(d.id || d)));
          }
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  // Ensure employees are loaded
  useEffect(() => {
    const ensureEmployeesLoaded = async () => {
      if (employees.length > 0) return;
      
      const employeeEndpoints = ['/api/employee-master', '/api/employees', '/api/masters/employees'];
      
      for (const endpoint of employeeEndpoints) {
        try {
          const response = await fetch(endpoint);
          const data = await response.json();
          
          if (data.success && Array.isArray(data.data) && data.data.length > 0) {
            setEmployees(data.data);
            return;
          } else if (Array.isArray(data) && data.length > 0) {
            setEmployees(data);
            return;
          }
        } catch (error) {
          // Continue to next endpoint
        }
      }
    };
    
    const timer = setTimeout(ensureEmployeesLoaded, 2000);
    return () => clearTimeout(timer);
  }, [employees.length]);



  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProgressChange = (e) => {
    setForm((prev) => ({ ...prev, progress: Number(e.target.value) }));
  };

  const toggleActivity = (id) => {
    const sid = String(id);
    setSelectedActivities((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };

  const toggleDiscipline = (id) => {
    const sid = String(id);
    setSelectedDisciplines((prev) => {
      const next = prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid];
      if (!next.includes(sid)) {
        const actIdsToRemove = (activities.find((d) => String(d.id) === sid)?.activities || []).map((a) => String(a.id));
        setSelectedActivities((prevActs) => prevActs.filter((a) => !actIdsToRemove.includes(a)));
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          activities: selectedActivities.map((v) =>
            Number.isFinite(Number(v)) ? Number(v) : v
          ),
          disciplines: (selectedDisciplines || []).map((v) =>
            Number.isFinite(Number(v)) ? Number(v) : v
          ),
          discipline_descriptions: form.disciplineDescriptions || {},
          assignments: assignments,
        }),
      });
      if (res.ok) router.push('/projects?view=list');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="p-6">Loading...</p>;

  const tabs = [
    { key: 'basic', label: 'Basic Info' },
    { key: 'commercial', label: 'Commercial Details' },
    { key: 'procurement', label: 'Procurement & Material' },
    { key: 'construction', label: 'Construction / Site' },
    { key: 'risk', label: 'Risk & Issues' },
    { key: 'assign', label: 'Assignments' },
    { key: 'closeout', label: 'Project Closeout' },
    { key: 'notes', label: 'Description & Notes' },
    { key: 'meta', label: 'Activities' },
  ];

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <form onSubmit={handleSubmit} className="px-4 pt-22 pb-8 space-y-6 max-w-[95vw] mx-auto">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={() => router.push('/projects?view=list')}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-black transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-1" />
                  Back to Projects
                </button>
                <div className="mt-3">
                  <h1 className="text-2xl font-bold text-black">
                    Edit Project
                    {form.project_id && (
                      <span className="ml-2 text-lg font-medium text-gray-600">#{form.project_id}</span>
                    )}
                  </h1>
                  {form.name && (
                    <h2 className="mt-1 text-lg font-medium text-gray-800">{form.name}</h2>
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  Update the project details stored in the CRM database.
                </p>
              </div>
            </header>

            {/* Tabs */}
            <div className="flex gap-6 border-b border-gray-200">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`pb-3 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'border-b-2 border-[#7F2487] text-[#7F2487]'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="space-y-8 leading-relaxed">
              <div className="max-w-8xl mx-auto">

                {/* BASIC INFO */}
                {activeTab === 'basic' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-8">
                    <h2 className="text-base font-semibold text-black">Basic Info</h2>
                    <div className="space-y-8">
                      
                      {/* Project Identification */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">Project Identification</h3>
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <label className={LABEL_CLASS}>Project Number</label>
                            <input
                              type="text"
                              name="project_id"
                              value={form.project_id || ''}
                              readOnly
                              className={`${COMMON_INPUT_CLASS} bg-gray-50`}
                              placeholder="Auto-generated on save"
                            />
                            <p className="text-xs text-gray-500 mt-1">Auto-generated format: Serial Number - Month - Year</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Project Name</label>
                            <input
                              type="text"
                              name="name"
                              value={form.name || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Client Information */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">Client Information</h3>
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Client Name</label>
                            <input
                              type="text"
                              name="client_name"
                              value={form.client_name || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Client Contact Details</label>
                            <textarea
                              name="client_contact_details"
                              value={form.client_contact_details || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                              rows="3"
                              placeholder="Contact person, phone, email, address"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Project Location */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">Project Location</h3>
                        <div className="grid md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
                            <input
                              type="text"
                              name="project_location_country"
                              value={form.project_location_country || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                              placeholder="e.g., India, UAE, Saudi Arabia"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                            <input
                              type="text"
                              name="project_location_city"
                              value={form.project_location_city || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                              placeholder="e.g., Mumbai, Dubai, Riyadh"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Site</label>
                            <input
                              type="text"
                              name="project_location_site"
                              value={form.project_location_site || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                              placeholder="e.g., Refinery, Plant, Office Complex"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Project Classification */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">Project Classification</h3>
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
                            <select
                              name="industry"
                              value={form.industry || ''}
                              onChange={handleChange}
                              className={COMMON_INPUT_CLASS}
                            >
                              <option value="">Select Industry</option>
                              {INDUSTRY_OPTIONS.map(industry => (
                                <option key={industry} value={industry}>{industry}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Contract Type</label>
                            <select
                              name="contract_type"
                              value={form.contract_type || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="">Select Contract Type</option>
                              <option value="EPC">EPC (Engineering, Procurement, Construction)</option>
                              <option value="Consultancy">Consultancy</option>
                              <option value="PMC">PMC (Project Management Consultancy)</option>
                              <option value="Lump Sum">Lump Sum</option>
                              <option value="Reimbursable">Reimbursable</option>
                              <option value="EPCC">EPCC (Engineering, Procurement, Construction, Commissioning)</option>
                              <option value="FEED">FEED (Front End Engineering Design)</option>
                              <option value="Detailed Engineering">Detailed Engineering</option>
                              <option value="Construction Management">Construction Management</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Project Timeline */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">Project Timeline</h3>
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Project Start Date</label>
                            <input
                              type="date"
                              name="start_date"
                              value={form.start_date || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Project End Date</label>
                            <input
                              type="date"
                              name="end_date"
                              value={form.end_date || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            />
                          </div>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Project Duration (Planned) - Months</label>
                            <input
                              type="number"
                              name="planned_duration"
                              value={form.planned_duration || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                              placeholder="e.g., 18"
                              min="0"
                              step="0.1"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Project Duration (Actual) - Months</label>
                            <input
                              type="number"
                              name="actual_duration"
                              value={form.actual_duration || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                              placeholder="e.g., 20"
                              min="0"
                              step="0.1"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Project Status & Management */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-200 pb-2">Project Status & Management</h3>
                        <div className="grid md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                            <select
                              name="status"
                              value={form.status || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="NEW">New</option>
                              <option value="Ongoing">Ongoing</option>
                              <option value="Completed">Completed</option>
                              <option value="On Hold">On Hold</option>
                              <option value="Cancelled">Cancelled</option>
                              <option value="planning">Planning</option>
                              <option value="in-progress">In Progress</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                            <select
                              name="priority"
                              value={form.priority || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="LOW">Low</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="HIGH">High</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
                            <select
                              name="company_id"
                              value={form.company_id || ''}
                              onChange={handleChange}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="">Select Company</option>
                              {(companies || []).map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.company_name || c.name || c.companyName || 'Unnamed Company'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* COMMERCIAL DETAILS */}
                {activeTab === 'commercial' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Commercial Details</h2>
                    <div className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Project Value (Contract Price)</label>
                          <input
                            type="number"
                            name="project_value"
                            value={form.project_value || ''}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            placeholder="Enter contract value"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                          <select
                            name="currency"
                            value={form.currency || 'USD'}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          >
                            <option value="USD">USD - US Dollar</option>
                            <option value="INR">INR - Indian Rupee</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms</label>
                        <select
                          name="payment_terms"
                          value={form.payment_terms || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Payment Terms</option>
                          <option value="Milestones">Milestones</option>
                          <option value="Monthly">Monthly</option>
                          <option value="% Completion">% Completion</option>
                          <option value="Advance + Milestones">Advance + Milestones</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Invoicing Status</label>
                        <select
                          name="invoicing_status"
                          value={form.invoicing_status || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Raised">Raised</option>
                          <option value="Pending">Pending</option>
                          <option value="Paid">Paid</option>
                          <option value="Partially Paid">Partially Paid</option>
                        </select>
                      </div>
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Cost to Company</label>
                          <input
                            type="number"
                            name="cost_to_company"
                            value={form.cost_to_company || ''}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            placeholder="Enter total cost"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Profitability Estimate (%)</label>
                          <input
                            type="number"
                            name="profitability_estimate"
                            value={form.profitability_estimate || ''}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            placeholder="Enter percentage"
                            min="0"
                            max="100"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Subcontractors / Vendors List</label>
                        <textarea
                          name="subcontractors_vendors"
                          value={form.subcontractors_vendors || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="List subcontractors/vendors with scope and contract value..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* PROCUREMENT & MATERIAL */}
                {activeTab === 'procurement' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Procurement & Material</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Procurement Status</label>
                        <select
                          name="procurement_status"
                          value={form.procurement_status || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Not Started">Not Started</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="On Hold">On Hold</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Material Delivery Schedule</label>
                        <textarea
                          name="material_delivery_schedule"
                          value={form.material_delivery_schedule || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe material delivery timeline and milestones..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Management</label>
                        <textarea
                          name="vendor_management"
                          value={form.vendor_management || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Vendor management details, contracts, performance..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* CONSTRUCTION / SITE */}
                {activeTab === 'construction' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Construction / Site</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Mobilization Date</label>
                        <input
                          type="date"
                          name="mobilization_date"
                          value={form.mobilization_date || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Site Readiness</label>
                        <select
                          name="site_readiness"
                          value={form.site_readiness || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Ready">Ready</option>
                          <option value="Preparing">Preparing</option>
                          <option value="Delayed">Delayed</option>
                          <option value="Not Ready">Not Ready</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Construction Progress</label>
                        <textarea
                          name="construction_progress"
                          value={form.construction_progress || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe current construction status, milestones achieved..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* RISK & ISSUES */}
                {activeTab === 'risk' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Risk & Issues</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Major Risks Identified</label>
                        <textarea
                          name="major_risks"
                          value={form.major_risks || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="List and describe major project risks..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Mitigation Plans</label>
                        <textarea
                          name="mitigation_plans"
                          value={form.mitigation_plans || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe risk mitigation strategies and action plans..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Change Orders / Variations</label>
                        <textarea
                          name="change_orders"
                          value={form.change_orders || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Document change orders, variations, and their impact..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Claims / Disputes</label>
                        <textarea
                          name="claims_disputes"
                          value={form.claims_disputes || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Record any claims, disputes, or legal issues..."
                        />
                      </div>
                    </div>
                  </section>
                )}
                    

                {/* COMMERCIAL DETAILS */}
                {activeTab === 'commercial' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Commercial Details</h2>
                    <div className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Project Value (Contract Price)</label>
                          <input
                            type="number"
                            name="project_value"
                            value={form.project_value || ''}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            placeholder="Enter contract value"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                          <select
                            name="currency"
                            value={form.currency || 'USD'}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          >
                            <option value="USD">USD - US Dollar</option>
                            <option value="EUR">EUR - Euro</option>
                            <option value="GBP">GBP - British Pound</option>
                            <option value="INR">INR - Indian Rupee</option>
                            <option value="AED">AED - UAE Dirham</option>
                            <option value="SAR">SAR - Saudi Riyal</option>
                            <option value="QAR">QAR - Qatari Riyal</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms</label>
                        <select
                          name="payment_terms"
                          value={form.payment_terms || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Payment Terms</option>
                          <option value="Milestones">Milestones</option>
                          <option value="Monthly">Monthly</option>
                          <option value="% Completion">% Completion</option>
                          <option value="Advance + Milestones">Advance + Milestones</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Invoicing Status</label>
                        <select
                          name="invoicing_status"
                          value={form.invoicing_status || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Raised">Raised</option>
                          <option value="Pending">Pending</option>
                          <option value="Paid">Paid</option>
                          <option value="Partially Paid">Partially Paid</option>
                        </select>
                      </div>
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Cost to Company</label>
                          <input
                            type="number"
                            name="cost_to_company"
                            value={form.cost_to_company || ''}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            placeholder="Enter total cost"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Profitability Estimate (%)</label>
                          <input
                            type="number"
                            name="profitability_estimate"
                            value={form.profitability_estimate || ''}
                            onChange={handleChange}
                            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                            placeholder="Enter percentage"
                            min="0"
                            max="100"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Subcontractors / Vendors List</label>
                        <textarea
                          name="subcontractors_vendors"
                          value={form.subcontractors_vendors || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="List subcontractors/vendors with scope and contract value..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* PROCUREMENT & MATERIAL */}
                {activeTab === 'procurement' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Procurement & Material</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Procurement Status</label>
                        <select
                          name="procurement_status"
                          value={form.procurement_status || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Not Started">Not Started</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="On Hold">On Hold</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Material Delivery Schedule</label>
                        <textarea
                          name="material_delivery_schedule"
                          value={form.material_delivery_schedule || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe material delivery timeline and milestones..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Management</label>
                        <textarea
                          name="vendor_management"
                          value={form.vendor_management || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Vendor management details, contracts, performance..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* CONSTRUCTION / SITE */}
                {activeTab === 'construction' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Construction / Site</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Mobilization Date</label>
                        <input
                          type="date"
                          name="mobilization_date"
                          value={form.mobilization_date || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Site Readiness</label>
                        <select
                          name="site_readiness"
                          value={form.site_readiness || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Ready">Ready</option>
                          <option value="Preparing">Preparing</option>
                          <option value="Delayed">Delayed</option>
                          <option value="Not Ready">Not Ready</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Construction Progress</label>
                        <textarea
                          name="construction_progress"
                          value={form.construction_progress || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe current construction status, milestones achieved..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* RISK & ISSUES */}
                {activeTab === 'risk' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Risk & Issues</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Major Risks Identified</label>
                        <textarea
                          name="major_risks"
                          value={form.major_risks || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="List and describe major project risks..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Mitigation Plans</label>
                        <textarea
                          name="mitigation_plans"
                          value={form.mitigation_plans || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe risk mitigation strategies and action plans..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Change Orders / Variations</label>
                        <textarea
                          name="change_orders"
                          value={form.change_orders || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Document change orders, variations, and their impact..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Claims / Disputes</label>
                        <textarea
                          name="claims_disputes"
                          value={form.claims_disputes || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Record any claims, disputes, or legal issues..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* ASSIGNMENTS */}
                {activeTab === 'assign' && (
                  <section className="bg-white border border-gray-200 rounded-lg p-8 space-y-8">
                    <div className="flex justify-between items-center">
                      <div>
                        <h2 className="text-base font-semibold text-black">Project Assignments & Team Builder</h2>
                        <p className="text-sm text-gray-600 mt-1">
                          Manage team assignments, resources, costs, and deliverables
                          {employees.length === 0 && (
                            <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                              Loading employees... ({employees.length} loaded)
                            </span>
                          )}
                          {employees.length > 0 && (
                            <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                              {employees.length} employees loaded
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignmentForm({
                            employee_id: '',
                            discipline_id: '',
                            activity_id: '',
                            sub_activity_id: '',
                            organizational_position: '',
                            reporting_manager: '',
                            assigned_date: new Date().toISOString().slice(0, 10),
                            assignment_status: 'Active',
                            progress_percentage: '',
                            budgeted_cost: '',
                            actual_cost: '',
                            resource_category: 'Internal',
                            vendor_subcontractor: '',
                            raci_role: 'Responsible',
                            deliverables: [],
                            manhours_estimated: '',
                            manhours_actual: '',
                            start_date: '',
                            end_date: '',
                            notes: ''
                          });
                          setEditingAssignment(null);
                          setShowAssignmentForm(true);
                        }}
                        className="px-4 py-2 bg-[#7F2487] text-white rounded-md text-sm hover:bg-[#6b1e72] flex items-center gap-2"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add Assignment
                      </button>
                    </div>

                    {/* Project Core Details */}
                    <div className="grid md:grid-cols-2 gap-6 p-6 bg-gray-50 rounded-lg">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Project Manager - Engineering</label>
                        <select
                          name="project_manager"
                          value={form.project_manager || ''}
                          onChange={handleChange}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">
                            {employees.length === 0 ? 'Loading employees...' : 'Select Project Manager - Engineering'}
                          </option>
                          {employees.length === 0 ? (
                            <option value="" disabled>No employees loaded - check console for errors</option>
                          ) : (
                            employees.map((emp) => (
                              <option key={emp.id || emp.employee_id} value={emp.id || emp.employee_id}>
                                {emp.first_name || emp.firstName || 'Unknown'} {emp.last_name || emp.lastName || 'Name'} ({emp.employee_id || emp.id || 'No ID'})
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Engineering Head</label>
                        <select
                          name="assigned_to"
                          value={form.assigned_to || ''}
                          onChange={handleChange}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">
                            {employees.length === 0 ? 'Loading employees...' : 'Select Engineering Head'}
                          </option>
                          {employees.length === 0 ? (
                            <option value="" disabled>No employees loaded - check console for errors</option>
                          ) : (
                            employees.map((emp) => (
                              <option key={emp.id || emp.employee_id} value={emp.id || emp.employee_id}>
                                {emp.first_name || emp.firstName || 'Unknown'} {emp.last_name || emp.lastName || 'Name'} ({emp.employee_id || emp.id || 'No ID'})
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Project Status</label>
                        <select
                          name="status"
                          value={form.status || ''}
                          onChange={handleChange}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Priority Level</label>
                        <select
                          name="priority"
                          value={form.priority || ''}
                          onChange={handleChange}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          {PRIORITY_OPTIONS.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Overall Progress</label>
                        <select
                          name="progress"
                          value={form.progress || ''}
                          onChange={handleChange}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Progress Level</option>
                          <option value="30">30% - Initial Phase</option>
                          <option value="60">60% - Mid Phase</option>
                          <option value="90">90% - Final Phase</option>
                        </select>
                      </div>
                    </div>

                    {/* Assignment Form */}
                    {showAssignmentForm && (
                      <div className="border border-gray-200 rounded-lg p-6 bg-blue-50">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">
                          {editingAssignment ? 'Edit Assignment' : 'New Assignment'}
                        </h3>
                        
                        <div className="grid md:grid-cols-3 gap-4 mb-6">
                          {/* Core Assignment Details */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                            <select
                              value={assignmentForm.employee_id}
                              onChange={(e) => setAssignmentForm({...assignmentForm, employee_id: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              required
                            >
                              <option value="">
                                {employees.length === 0 ? 'Loading employees...' : 'Select Employee'}
                              </option>
                              {employees.length === 0 ? (
                                <option value="" disabled>No employees available - API may be down</option>
                              ) : (
                                employees.map((emp) => (
                                  <option key={emp.id || emp.employee_id} value={emp.id || emp.employee_id}>
                                    {emp.first_name || emp.firstName || 'Unknown'} {emp.last_name || emp.lastName || 'Name'} ({emp.employee_id || emp.id || 'No ID'})
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Organizational Position</label>
                            <select
                              value={assignmentForm.organizational_position}
                              onChange={(e) => setAssignmentForm({...assignmentForm, organizational_position: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              required
                            >
                              <option value="">Select Position</option>
                              {ORGANIZATIONAL_POSITIONS.map((position) => (
                                <option key={position} value={position}>
                                  {position}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Reporting Manager</label>
                            <select
                              value={assignmentForm.reporting_manager}
                              onChange={(e) => setAssignmentForm({...assignmentForm, reporting_manager: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              disabled={!assignmentForm.organizational_position}
                            >
                              <option value="">Select Reporting Manager</option>
                              {assignmentForm.organizational_position && REPORTING_STRUCTURE[assignmentForm.organizational_position]?.map((managerPosition) => (
                                <option key={managerPosition} value={managerPosition}>
                                  {managerPosition}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Assignment Status</label>
                            <select
                              value={assignmentForm.assignment_status}
                              onChange={(e) => setAssignmentForm({...assignmentForm, assignment_status: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="Active">Active</option>
                              <option value="Pending">Pending</option>
                              <option value="Completed">Completed</option>
                              <option value="On-hold">On-hold</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Progress Percentage</label>
                            <div className="relative">
                              <input
                                type="number"
                                value={assignmentForm.progress_percentage}
                                onChange={(e) => setAssignmentForm({...assignmentForm, progress_percentage: e.target.value})}
                                min="0"
                                max="100"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md pr-8"
                                placeholder="0"
                              />
                              <span className="absolute right-3 top-2 text-gray-500 text-sm">%</span>
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Date</label>
                            <input
                              type="date"
                              value={assignmentForm.assigned_date}
                              onChange={(e) => setAssignmentForm({...assignmentForm, assigned_date: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            />
                          </div>
                        </div>

                        {/* Work Assignment Section */}
                        <div className="grid md:grid-cols-3 gap-4 mb-6 p-4 bg-white rounded-lg border">
                          <div className="md:col-span-3">
                            <h4 className="font-medium text-gray-800 mb-3">Work Assignment</h4>
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Discipline</label>
                            <select
                              value={assignmentForm.discipline_id}
                              onChange={(e) => {
                                setAssignmentForm({...assignmentForm, discipline_id: e.target.value, activity_id: '', sub_activity_id: ''});
                              }}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="">Select Discipline</option>
                              {activities.map((discipline) => (
                                <option key={discipline.id} value={discipline.id}>
                                  {discipline.discipline || discipline.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Activity</label>
                            <select
                              value={assignmentForm.activity_id}
                              onChange={(e) => {
                                setAssignmentForm({...assignmentForm, activity_id: e.target.value, sub_activity_id: ''});
                              }}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              disabled={!assignmentForm.discipline_id}
                            >
                              <option value="">Select Activity</option>
                              {assignmentForm.discipline_id && activities
                                .find(d => d.id === assignmentForm.discipline_id)?.activities
                                ?.map((activity) => (
                                  <option key={activity.id} value={activity.id}>
                                    {activity.name}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Activity</label>
                            <select
                              value={assignmentForm.sub_activity_id}
                              onChange={(e) => setAssignmentForm({...assignmentForm, sub_activity_id: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              disabled={!assignmentForm.activity_id}
                            >
                              <option value="">Select Sub-Activity (Optional)</option>
                              {assignmentForm.activity_id && activities
                                .find(d => d.id === assignmentForm.discipline_id)?.activities
                                ?.find(a => a.id === assignmentForm.activity_id)?.subActivities
                                ?.map((subActivity) => (
                                  <option key={subActivity.id} value={subActivity.id}>
                                    {subActivity.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>

                        {/* Resource & Cost Tracking */}
                        <div className="grid md:grid-cols-4 gap-4 mb-6 p-4 bg-white rounded-lg border">
                          <div className="md:col-span-4">
                            <h4 className="font-medium text-gray-800 mb-3">Resource & Cost Tracking</h4>
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Budgeted Cost (INR)</label>
                            <input
                              type="number"
                              value={assignmentForm.budgeted_cost}
                              onChange={(e) => setAssignmentForm({...assignmentForm, budgeted_cost: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              placeholder="0.00"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Actual Cost (INR)</label>
                            <input
                              type="number"
                              value={assignmentForm.actual_cost}
                              onChange={(e) => setAssignmentForm({...assignmentForm, actual_cost: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              placeholder="0.00"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Resource Category</label>
                            <select
                              value={assignmentForm.resource_category}
                              onChange={(e) => setAssignmentForm({...assignmentForm, resource_category: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="Internal">Internal</option>
                              <option value="Subcontractor">Subcontractor</option>
                              <option value="Consultant">Consultant</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor/Subcontractor</label>
                            <input
                              type="text"
                              value={assignmentForm.vendor_subcontractor}
                              onChange={(e) => setAssignmentForm({...assignmentForm, vendor_subcontractor: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              placeholder="Enter vendor name if applicable"
                            />
                          </div>
                        </div>

                        {/* RACI Matrix & Time Tracking */}
                        <div className="grid md:grid-cols-4 gap-4 mb-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">RACI Role</label>
                            <select
                              value={assignmentForm.raci_role}
                              onChange={(e) => setAssignmentForm({...assignmentForm, raci_role: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            >
                              <option value="Responsible">Responsible</option>
                              <option value="Accountable">Accountable</option>
                              <option value="Consulted">Consulted</option>
                              <option value="Informed">Informed</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Manhours</label>
                            <input
                              type="number"
                              value={assignmentForm.manhours_estimated}
                              onChange={(e) => setAssignmentForm({...assignmentForm, manhours_estimated: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              placeholder="0"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Actual Manhours</label>
                            <input
                              type="number"
                              value={assignmentForm.manhours_actual}
                              onChange={(e) => setAssignmentForm({...assignmentForm, manhours_actual: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              placeholder="0"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                            <input
                              type="date"
                              value={assignmentForm.start_date}
                              onChange={(e) => setAssignmentForm({...assignmentForm, start_date: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                            <input
                              type="date"
                              value={assignmentForm.end_date}
                              onChange={(e) => setAssignmentForm({...assignmentForm, end_date: e.target.value})}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            />
                          </div>
                        </div>

                        {/* Deliverables Assignment */}
                        <div className="mb-6 p-4 bg-white rounded-lg border">
                          <h4 className="font-medium text-gray-800 mb-3">Deliverables Assignment</h4>
                          <div className="space-y-2">
                            {documents.length > 0 ? (
                              documents.slice(0, 5).map((doc) => (
                                <label key={doc.id} className="flex items-center space-x-3">
                                  <input
                                    type="checkbox"
                                    checked={assignmentForm.deliverables.includes(doc.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setAssignmentForm({
                                          ...assignmentForm,
                                          deliverables: [...assignmentForm.deliverables, doc.id]
                                        });
                                      } else {
                                        setAssignmentForm({
                                          ...assignmentForm,
                                          deliverables: assignmentForm.deliverables.filter(id => id !== doc.id)
                                        });
                                      }
                                    }}
                                    className="rounded text-[#7F2487] focus:ring-[#7F2487]"
                                  />
                                  <span className="text-sm">{doc.document_name || doc.name}</span>
                                </label>
                              ))
                            ) : (
                              <p className="text-sm text-gray-500">No documents available. Create documents in Document Master first.</p>
                            )}
                          </div>
                        </div>

                        {/* Notes */}
                        <div className="mb-6">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                          <textarea
                            value={assignmentForm.notes}
                            onChange={(e) => setAssignmentForm({...assignmentForm, notes: e.target.value})}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                            rows={3}
                            placeholder="Additional notes about this assignment..."
                          />
                        </div>

                        {/* Form Actions */}
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAssignmentForm(false);
                              setEditingAssignment(null);
                            }}
                            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const selectedEmployee = employees.find(e => e.id === assignmentForm.employee_id);
                              const newAssignment = {
                                id: editingAssignment?.id || Date.now(),
                                ...assignmentForm,
                                employee_name: selectedEmployee ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}` : '',
                                employee_id_display: selectedEmployee?.employee_id || '',
                                discipline_name: activities.find(d => d.id === assignmentForm.discipline_id)?.discipline || activities.find(d => d.id === assignmentForm.discipline_id)?.name,
                                activity_name: activities.find(d => d.id === assignmentForm.discipline_id)?.activities?.find(a => a.id === assignmentForm.activity_id)?.name,
                                sub_activity_name: activities.find(d => d.id === assignmentForm.discipline_id)?.activities?.find(a => a.id === assignmentForm.activity_id)?.subActivities?.find(s => s.id === assignmentForm.sub_activity_id)?.name
                              };

                              if (editingAssignment) {
                                setAssignments(assignments.map(a => a.id === editingAssignment.id ? newAssignment : a));
                              } else {
                                setAssignments([...assignments, newAssignment]);
                              }

                              setAssignmentForm({
                                employee_id: '',
                                discipline_id: '',
                                activity_id: '',
                                sub_activity_id: '',
                                organizational_position: '',
                                reporting_manager: '',
                                assigned_date: new Date().toISOString().slice(0, 10),
                                assignment_status: 'Active',
                                progress_percentage: '',
                                budgeted_cost: '',
                                actual_cost: '',
                                resource_category: 'Internal',
                                vendor_subcontractor: '',
                                raci_role: 'Responsible',
                                deliverables: [],
                                manhours_estimated: '',
                                manhours_actual: '',
                                start_date: '',
                                end_date: '',
                                notes: ''
                              });
                              setEditingAssignment(null);
                              setShowAssignmentForm(false);
                            }}
                            className="px-4 py-2 bg-[#7F2487] text-white rounded-md text-sm hover:bg-[#6b1e72]"
                          >
                            {editingAssignment ? 'Update Assignment' : 'Add Assignment'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Current Assignments List */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-4">Current Team Assignments</h3>
                      {assignments.length === 0 ? (
                        <div className="text-center py-8 bg-gray-50 rounded-lg">
                          <p className="text-gray-500">No assignments created yet.</p>
                          <p className="text-sm text-gray-400">Use the 'Add Assignment' button to start building your project team.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {assignments.map((assignment) => (
                            <div key={assignment.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <h4 className="font-medium text-gray-800">
                                    {assignment.employee_name} ({assignment.employee_id_display})
                                    <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                                      assignment.assignment_status === 'Active' ? 'bg-green-100 text-green-800' :
                                      assignment.assignment_status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                      assignment.assignment_status === 'Completed' ? 'bg-blue-100 text-blue-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {assignment.assignment_status}
                                    </span>
                                  </h4>
                                  <p className="text-sm text-gray-600">
                                    <strong>Position:</strong> {assignment.organizational_position || 'Not specified'}
                                  </p>
                                  <p className="text-sm text-gray-600">
                                    <strong>Reports to:</strong> {assignment.reporting_manager || 'Not specified'}
                                  </p>
                                  {(assignment.discipline_name || assignment.activity_name) && (
                                    <p className="text-sm text-gray-600">
                                      <strong>Work:</strong> {assignment.discipline_name}{assignment.activity_name && ` → ${assignment.activity_name}`}{assignment.sub_activity_name && ` → ${assignment.sub_activity_name}`}
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAssignmentForm(assignment);
                                      setEditingAssignment(assignment);
                                      setShowAssignmentForm(true);
                                    }}
                                    className="text-blue-600 hover:text-blue-800 text-sm"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAssignments(assignments.filter(a => a.id !== assignment.id));
                                    }}
                                    className="text-red-600 hover:text-red-800 text-sm"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                              
                              <div className="grid md:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <span className="font-medium">RACI Role:</span>
                                  <span className={`ml-1 px-2 py-1 text-xs rounded ${
                                    assignment.raci_role === 'Responsible' ? 'bg-red-100 text-red-800' :
                                    assignment.raci_role === 'Accountable' ? 'bg-blue-100 text-blue-800' :
                                    assignment.raci_role === 'Consulted' ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-green-100 text-green-800'
                                  }`}>
                                    {assignment.raci_role}
                                  </span>
                                </div>
                                <div>
                                  <span className="font-medium">Progress:</span> {assignment.progress_percentage || '0'}%
                                </div>
                                <div>
                                  <span className="font-medium">Resource:</span> {assignment.resource_category}
                                </div>
                                <div>
                                  <span className="font-medium">Budget:</span> ₹{assignment.budgeted_cost || '0'}
                                </div>
                                <div>
                                  <span className="font-medium">Manhours:</span> {assignment.manhours_estimated || '0'}h (Est.)
                                </div>
                                <div>
                                  <span className="font-medium">Assigned:</span> {assignment.assigned_date}
                                </div>
                              </div>
                              
                              {assignment.notes && (
                                <div className="mt-2 p-2 bg-gray-100 rounded text-sm">
                                  <span className="font-medium">Notes:</span> {assignment.notes}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* NOTES */}
                {activeTab === 'notes' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Description & Notes</h2>
                    <div className="space-y-6">
                      <textarea
                        name="description"
                        value={form.description || ''}
                        onChange={handleChange}
                        rows={3}
                        className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                      />
                      <textarea
                        name="notes"
                        value={form.notes || ''}
                        onChange={handleChange}
                        rows={3}
                        className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                  </section>
                )}

                {/* META / ACTIVITIES */}
                {activeTab === 'meta' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black flex items-center gap-2">
                      <ChartBarIcon className="h-5 w-5 text-[#7F2487]" /> Project Activities
                    </h2>

                    <p className="text-xs text-gray-500">
                      Select disciplines and their activities for this project. Disciplines and activities are managed in the Activity Master.
                    </p>

                    <div className="grid lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2">
                        {(activities || []).map((discipline) => (
                          <div key={discipline.id} className="mb-6">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => toggleDiscipline(discipline.id)}
                                aria-pressed={selectedDisciplines.includes(String(discipline.id))}
                                className={`inline-flex items-center justify-center h-7 w-7 rounded-full border ${selectedDisciplines.includes(String(discipline.id)) ? 'bg-[#7F2487] text-white border-[#7F2487]' : 'bg-white text-gray-600 border-gray-200'}`}
                              >
                                {selectedDisciplines.includes(String(discipline.id)) ? (
                                  <MinusIcon className="h-4 w-4" />
                                ) : (
                                  <PlusIcon className="h-4 w-4" />
                                )}
                              </button>
                              <h3 className="font-semibold text-gray-800 ml-2">{discipline.name}</h3>
                            </div>

                            {selectedDisciplines.includes(String(discipline.id)) && (
                              <>
                                <textarea
                                  placeholder="Add a short description for this discipline in this project (optional)"
                                  value={(form.discipline_descriptions || {})[discipline.id] || ''}
                                  onChange={(e) =>
                                    setForm((p) => ({
                                      ...p,
                                      discipline_descriptions: {
                                        ...(p.discipline_descriptions || {}),
                                        [discipline.id]: e.target.value,
                                      },
                                    }))
                                  }
                                  rows={2}
                                  className="w-full mt-2 px-3 py-2 text-sm border border-gray-300 rounded-md"
                                />

                                <div className="ml-6 grid md:grid-cols-2 gap-2 mt-3">
                                  {(discipline.activities || []).map((act) => (
                                    <div key={act.id} className="flex items-center gap-2 text-sm">
                                      <button
                                        type="button"
                                        onClick={() => toggleActivity(act.id)}
                                        className={`inline-flex items-center justify-center h-7 w-7 rounded-full border ${selectedActivities.includes(String(act.id)) ? 'bg-[#7F2487] text-white border-[#7F2487]' : 'bg-white text-gray-600 border-gray-200'}`}
                                        aria-pressed={selectedActivities.includes(String(act.id))}
                                      >
                                        {selectedActivities.includes(String(act.id)) ? (
                                          <MinusIcon className="h-4 w-4" />
                                        ) : (
                                          <PlusIcon className="h-4 w-4" />
                                        )}
                                      </button>
                                      <span>{act.name}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Preview panel */}
                      <aside className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-gray-800">Preview</h4>
                        <p className="text-xs text-gray-600 mt-1">Selected disciplines & activities for this project</p>
                        <div className="mt-3 space-y-3 text-sm">
                          <div>
                            <p className="text-xs text-gray-500">Disciplines</p>
                            {selectedDisciplines.length === 0 ? (
                              <p className="text-sm text-gray-500 mt-1">No disciplines selected</p>
                            ) : (
                              <ul className="mt-1 space-y-1">
                                {selectedDisciplines.map((id) => {
                                  const d = activities.find((a) => String(a.id) === String(id));
                                  return (
                                    <li key={id} className="flex items-center justify-between">
                                      <span>{d ? d.name : id}</span>
                                      <button type="button" onClick={() => toggleDiscipline(id)} className="text-xs text-red-500">Remove</button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>

                          <div>
                            <p className="text-xs text-gray-500">Activities</p>
                            {selectedActivities.length === 0 ? (
                              <p className="text-sm text-gray-500 mt-1">No activities selected</p>
                            ) : (
                              <ul className="mt-1 space-y-1">
                                {selectedActivities.map((id) => {
                                  // find activity name from activities catalogue
                                  let found = null;
                                  for (const disc of activities) {
                                    const act = (disc.activities || []).find((a) => String(a.id) === String(id));
                                    if (act) { found = act; break; }
                                  }
                                  return (
                                    <li key={id} className="flex items-center justify-between">
                                      <span>{found ? found.name : id}</span>
                                      <button type="button" onClick={() => toggleActivity(id)} className="text-xs text-red-500">Remove</button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>
                      </aside>
                    </div>
                  </section>
                )}

                {/* PROJECT CLOSEOUT */}
                {activeTab === 'closeout' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Project Closeout</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Final Documentation Status</label>
                        <select
                          name="final_documentation_status"
                          value={form.final_documentation_status || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Status</option>
                          <option value="Complete">Complete</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Pending">Pending</option>
                          <option value="Not Started">Not Started</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Lessons Learned</label>
                        <textarea
                          name="lessons_learned"
                          value={form.lessons_learned || ''}
                          onChange={handleChange}
                          rows={5}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Document key lessons learned, best practices, and recommendations for future projects..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Client Feedback</label>
                        <textarea
                          name="client_feedback"
                          value={form.client_feedback || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Record client feedback, satisfaction ratings, testimonials..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Actual Profit/Loss</label>
                        <input
                          type="number"
                          name="actual_profit_loss"
                          value={form.actual_profit_loss || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Enter final profit or loss amount"
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* DESCRIPTION & NOTES */}
                {activeTab === 'notes' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Description & Notes</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Project Description</label>
                        <textarea
                          name="description"
                          value={form.description || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Describe the project scope, objectives, and key details..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Additional Notes</label>
                        <textarea
                          name="notes"
                          value={form.notes || ''}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                          placeholder="Any additional notes, comments, or observations..."
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-4 pt-6">
                  <button
                    type="button"
                    onClick={() => router.push('/projects?view=list')}
                    className="px-6 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>

              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}