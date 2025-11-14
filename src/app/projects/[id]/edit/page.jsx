 'use client';

// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Suspense, useEffect, useMemo, useState, Fragment, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon, PlusIcon, TrashIcon, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, DocumentIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { fetchJSON } from '@/utils/http';
import Image from 'next/image';

const INITIAL_FORM = {
  // Scope & Annexure fields
  scope_of_work: '',
  input_documents: '',
  deliverables: '',
  software_included: '',
  duration: '',
  mode_of_delivery: '',
  revision: '',
  site_visit: '',
  quotation_validity: '',
  exclusion: '',
  billing_and_payment_terms: '',
  other_terms_and_conditions: '',

  // General project fields (add more as needed)
  budget: '',
  procurement_status: '',
  material_delivery_schedule: '',
  vendor_management: '',
  mobilization_date: '',
  site_readiness: '',
  construction_progress: '',
  major_risks: '',
  mitigation_plans: '',
  change_orders: '',
  claims_disputes: '',
  final_documentation_status: '',
  lessons_learned: '',
  client_feedback: '',
  actual_profit_loss: '',
  project_schedule: '',
  input_document: '',
  list_of_deliverables: '',
  kickoff_meeting: '',
  in_house_meeting: '',
  project_start_milestone: '',
  project_review_milestone: '',
  project_end_milestone: '',
  kickoff_meeting_date: '',
  kickoff_followup_date: '',
  internal_meeting_date: '',
  next_internal_meeting: ''
  ,
  // additional fields surfaced in Project Details
  estimated_manhours: '',
  unit_qty: ''
  ,
  // Minutes - Internal Meeting fields
  internal_meeting_no: '',
  internal_meeting_client_name: '',
  internal_meeting_date: '',
  internal_meeting_organizer: '',
  internal_minutes_drafted: '',
  internal_meeting_location: '',
  internal_client_representative: '',
  internal_meeting_title: '',
  internal_points_discussed: '',
  internal_persons_involved: ''
  ,
  // Kickoff meeting detailed fields
  kickoff_meeting_no: '',
  kickoff_client_name: '',
  kickoff_meeting_organizer: '',
  kickoff_minutes_drafted: '',
  kickoff_meeting_location: '',
  kickoff_client_representative: '',
  kickoff_meeting_title: '',
  kickoff_points_discussed: '',
  kickoff_persons_involved: ''
};

// UI constants used by the edit form (kept local to avoid cross-file imports)
const TABS = [
  { id: 'project_details', label: 'Project Details' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'scope', label: 'Scope' },
  { id: 'minutes_internal_meet', label: 'Meetings' },
  { id: 'documents_received', label: 'List of Documents Received' },
  { id: 'project_schedule', label: 'Project Schedule' },
  { id: 'project_activity', label: 'Project Activity' },
  { id: 'documents_issued', label: 'Documents Issued' },
  { id: 'project_handover', label: 'Project Handover' },
  { id: 'project_manhours', label: 'Project Manhours' },
  { id: 'query_log', label: 'Query Log' },
  { id: 'assumption', label: 'Assumption' },
  { id: 'lessons_learnt', label: 'Lessons Learnt' }
];

const STATUS_OPTIONS = ['NEW', 'planning', 'in-progress', 'on-hold', 'completed', 'cancelled'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];
const TYPE_OPTIONS = ['ONGOING', 'CONSULTANCY', 'EPC', 'PMC'];
const INDUSTRY_OPTIONS = ['Construction', 'Energy', 'Infrastructure', 'Manufacturing', 'IT', 'Healthcare'];
const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_TERMS_OPTIONS = ['Net 30', 'Net 45', 'Net 60', 'Advance'];
const INVOICING_STATUS_OPTIONS = ['Uninvoiced', 'Partially Invoiced', 'Invoiced', 'Paid'];
const PROCUREMENT_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed', 'On Hold'];
const DOCUMENTATION_STATUS_OPTIONS = ['Not Started', 'Drafted', 'Reviewed', 'Finalized'];

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
  const [newScopeActivityName, setNewScopeActivityName] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  // Internal meetings stored as an array (each meeting has same fields as kickoff)
  const [internalMeetings, setInternalMeetings] = useState([]);
  const [newInternalMeetingTitle, setNewInternalMeetingTitle] = useState('');
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

  // Collapsible sections for General / Project Details (Basic, Scope, Unit/Qty, Deliverables)
  const [openSections, setOpenSections] = useState({
    basic: true,
    scope: true,
    unitQty: false,
    deliverables: true
  });

  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  // File management state
  const [inputDocuments, setInputDocuments] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // Input document list management
  const [inputDocumentsList, setInputDocumentsList] = useState([]);
  const [newInputDocument, setNewInputDocument] = useState('');
  const [docMaster, setDocMaster] = useState([]);
  
  // Documentation tab - detailed document management
  const [documentsList, setDocumentsList] = useState([]);
  const [newDocument, setNewDocument] = useState({
    name: '',
    number: '',
    revision: '',
    quantity: '',
    sentBy: '',
    remarks: ''
  });

  // Documents Received - structured table rows
  const [documentsReceived, setDocumentsReceived] = useState([]);
  const [newReceivedDoc, setNewReceivedDoc] = useState({
    sr_no: '',
    date_received: '',
    description: '',
    drawing_number: '',
    revision_number: '',
    unit_qty: '',
    document_sent_by: '',
    remarks: ''
  });
  const newReceivedDescRef = useRef(null);

  // Documents Issued - structured table rows (Document Issued to Client)
  const [documentsIssued, setDocumentsIssued] = useState([]);
  const [newIssuedDoc, setNewIssuedDoc] = useState({
    sr_no: '',
    document_name: '',
    document_number: '',
    revision_number: '',
    issue_date: '',
    remarks: ''
  });
  const newIssuedDescRef = useRef(null);

  // Project Handover - structured rows (handover checklist)
  const [projectHandover, setProjectHandover] = useState([]);
  const [newHandoverRow, setNewHandoverRow] = useState({
    sr_no: '',
    output_by_accent: '',
    requirement_accomplished: '',
    remark: '',
    hand_over: ''
  });
  const newHandoverDescRef = useRef(null);

  // Project Schedule - structured rows
  const [projectSchedule, setProjectSchedule] = useState([]);
  const [newSchedule, setNewSchedule] = useState({
    sr_no: '',
    activity_description: '',
    unit_qty: '',
    start_date: '',
    end_date: '',
    time_required: '',
    status_completed: '',
    remarks: ''
  });
  const newScheduleDescRef = useRef(null);

  // Project Activity / Daily Activity rows
  const [projectActivityRows, setProjectActivityRows] = useState([]);
  const [newActivity, setNewActivity] = useState({
    sr_no: '',
    date: '',
    daily_activity: '',
    unit_qty: '',
    planned_hours: '',
    start_time: '',
    end_time: '',
    actual_hours: '',
    activity_done_by: '',
    status_completed: '',
    remark: ''
  });
  const newActivityDescRef = useRef(null);

  // Project Manhours - structured rows
  const [projectManhours, setProjectManhours] = useState([]);
  const [newManhourRow, setNewManhourRow] = useState({
    sr_no: '',
    month: '',
    name_of_engineer_designer: '',
    engineering: '',
    designer: '',
    drafting: '',
    checking: '',
    coordination: '',
    site_visit: '',
    others: '',
    remarks: ''
  });
  const newManhourNameRef = useRef(null);

  // Query Log - structured rows
  const [queryLog, setQueryLog] = useState([]);
  const [newQuery, setNewQuery] = useState({
    sr_no: '',
    query_description: '',
    query_issued_date: '',
    reply_from_client: '',
    reply_received_date: '',
    query_updated_by: '',
    query_resolved: '',
    remark: ''
  });
  const newQueryDescRef = useRef(null);

  // Assumptions - structured rows
  const [assumptions, setAssumptions] = useState([]);
  const [newAssumption, setNewAssumption] = useState({
    sr_no: '',
    assumption_description: '',
    reason: '',
    assumption_taken_by: '',
    remark: ''
  });
  const newAssumptionDescRef = useRef(null);

  // Lessons Learnt - structured rows
  const [lessonsLearnt, setLessonsLearnt] = useState([]);
  const [newLesson, setNewLesson] = useState({
    sr_no: '',
    what_was_new: '',
    difficulty_faced: '',
    what_you_learn: '',
    areas_of_improvement: '',
    remark: ''
  });
  const newLessonDescRef = useRef(null);

  // Project Planning tab - activity tracking
  const [planningActivities, setPlanningActivities] = useState([]);
  const [newPlanningActivity, setNewPlanningActivity] = useState({
    serialNumber: '',
    activity: '',
    quantity: '',
    startDate: '',
    endDate: '',
    actualCompletionDate: '',
    timeRequired: '',
    actualTimeRequired: ''
  });

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
    if (!id || id === 'undefined') {
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
            actual_profit_loss: project.actual_profit_loss || '',
            estimated_manhours: project.estimated_manhours || project.estimated_hours || '',
            unit_qty: project.unit_qty || project.unit || '',
            // internal minutes fields
            internal_meeting_no: project.internal_meeting_no || '',
            internal_meeting_client_name: project.internal_meeting_client_name || '',
            internal_meeting_date: project.internal_meeting_date || '',
            internal_meeting_organizer: project.internal_meeting_organizer || '',
            internal_minutes_drafted: project.internal_minutes_drafted || '',
            internal_meeting_location: project.internal_meeting_location || '',
            internal_client_representative: project.internal_client_representative || '',
            internal_meeting_title: project.internal_meeting_title || '',
            internal_points_discussed: project.internal_points_discussed || '',
            internal_persons_involved: project.internal_persons_involved || ''
            // kickoff mapping will be set below if present
            ,
            kickoff_meeting_no: project.kickoff_meeting_no || project.kickoff_meeting || '',
            kickoff_client_name: project.kickoff_client_name || '',
            kickoff_meeting_date: project.kickoff_meeting_date || '',
            kickoff_meeting_organizer: project.kickoff_meeting_organizer || '',
            kickoff_minutes_drafted: project.kickoff_minutes_drafted || '',
            kickoff_meeting_location: project.kickoff_meeting_location || '',
            kickoff_client_representative: project.kickoff_client_representative || '',
            kickoff_meeting_title: project.kickoff_meeting_title || '',
            kickoff_points_discussed: project.kickoff_points_discussed || '',
            kickoff_persons_involved: project.kickoff_persons_involved || ''
          });

          // Load team members
          if (project.team_members) {
            try {
              const parsed = typeof project.team_members === 'string' 
                ? JSON.parse(project.team_members) 
                : project.team_members;
              setTeamMembers(Array.isArray(parsed) ? parsed : []);
            } catch {
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
            } catch {
              setProjectActivities([]);
            }
          }

          // Load planning activities
          if (project.planning_activities_list) {
            try {
              const parsed = typeof project.planning_activities_list === 'string' 
                ? JSON.parse(project.planning_activities_list) 
                : project.planning_activities_list;
              setPlanningActivities(Array.isArray(parsed) ? parsed : []);
            } catch {
              setPlanningActivities([]);
            }
          }

          // Load documents list
          if (project.documents_list) {
            try {
              const parsed = typeof project.documents_list === 'string' 
                ? JSON.parse(project.documents_list) 
                : project.documents_list;
              setDocumentsList(Array.isArray(parsed) ? parsed : []);
            } catch {
              setDocumentsList([]);
            }
          }

          // Load input documents list (supports legacy comma-separated or new JSON array format)
          if (project.input_document) {
            let parsedDocs = [];
            try {
              const maybeJson = project.input_document.trim();
              if (maybeJson.startsWith('[')) {
                const arr = JSON.parse(maybeJson);
                if (Array.isArray(arr)) {
                  parsedDocs = arr.map(d => ({
                    id: d.id || Date.now() + Math.random(),
                    text: d.text || d.name || '',
                    name: d.name || d.text || '',
                    fileUrl: d.fileUrl || null,
                    thumbUrl: d.thumbUrl || null,
                    addedAt: d.addedAt || new Date().toISOString()
                  })).filter(d => d.text);
                }
              } else {
                // legacy comma separated
                parsedDocs = project.input_document.split(',').map((doc, index) => ({
                  id: Date.now() + index,
                  text: doc.trim(),
                  name: doc.trim(),
                  fileUrl: null,
                  thumbUrl: null,
                  addedAt: new Date().toISOString()
                })).filter(doc => doc.text);
              }
            } catch {
              // fallback to comma split
              parsedDocs = project.input_document.split(',').map((doc, index) => ({
                id: Date.now() + index,
                text: doc.trim(),
                name: doc.trim(),
                fileUrl: null,
                thumbUrl: null,
                addedAt: new Date().toISOString()
              })).filter(doc => doc.text);
            }
            setInputDocumentsList(parsedDocs);
          }

            // Load documents received list (new structured array)
            if (project.documents_received_list) {
              try {
                const parsed = typeof project.documents_received_list === 'string'
                  ? JSON.parse(project.documents_received_list)
                  : project.documents_received_list;
                setDocumentsReceived(Array.isArray(parsed) ? parsed : []);
              } catch {
                setDocumentsReceived([]);
              }
            } else {
              setDocumentsReceived([]);
            }

            // Load project query log list
            if (project.project_query_log_list) {
              try {
                const parsed = typeof project.project_query_log_list === 'string'
                  ? JSON.parse(project.project_query_log_list)
                  : project.project_query_log_list;
                setQueryLog(Array.isArray(parsed) ? parsed : []);
              } catch {
                setQueryLog([]);
              }
            } else {
              setQueryLog([]);
            }

            // Load project assumption list
            if (project.project_assumption_list) {
              try {
                const parsed = typeof project.project_assumption_list === 'string'
                  ? JSON.parse(project.project_assumption_list)
                  : project.project_assumption_list;
                setAssumptions(Array.isArray(parsed) ? parsed : []);
              } catch {
                setAssumptions([]);
              }
            } else {
              setAssumptions([]);
            }

            // Load project lessons learnt list
            if (project.project_lessons_learnt_list) {
              try {
                const parsed = typeof project.project_lessons_learnt_list === 'string'
                  ? JSON.parse(project.project_lessons_learnt_list)
                  : project.project_lessons_learnt_list;
                setLessonsLearnt(Array.isArray(parsed) ? parsed : []);
              } catch {
                setLessonsLearnt([]);
              }
            } else {
              setLessonsLearnt([]);
            }

                  // Load internal meetings list (new structured array) or fall back to legacy singular internal fields
                  if (project.internal_meetings_list) {
                    try {
                      const parsed = typeof project.internal_meetings_list === 'string'
                        ? JSON.parse(project.internal_meetings_list)
                        : project.internal_meetings_list;
                      setInternalMeetings(Array.isArray(parsed) ? parsed : []);
                    } catch {
                      setInternalMeetings([]);
                    }
                  } else if (project.internal_meeting_no || project.internal_meeting_title || project.internal_persons_involved) {
                    // backfill a single meeting record from legacy fields
                    setInternalMeetings([{
                      id: Date.now(),
                      meeting_no: project.internal_meeting_no || '',
                      client_name: project.internal_meeting_client_name || '',
                      meeting_date: project.internal_meeting_date || '',
                      organizer: project.internal_meeting_organizer || '',
                      minutes_drafted: project.internal_minutes_drafted || '',
                      meeting_location: project.internal_meeting_location || '',
                      client_representative: project.internal_client_representative || '',
                      meeting_title: project.internal_meeting_title || '',
                      points_discussed: project.internal_points_discussed || '',
                      persons_involved: project.internal_persons_involved || ''
                    }]);
                  } else {
                    setInternalMeetings([]);
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
          ...form,
          team_members: JSON.stringify(teamMembers),
          project_activities_list: JSON.stringify(projectActivities),
          planning_activities_list: JSON.stringify(planningActivities),
          documents_list: JSON.stringify(documentsList),
          internal_meetings_list: JSON.stringify(internalMeetings),
          documents_received_list: JSON.stringify(documentsReceived),
          documents_issued_list: JSON.stringify(documentsIssued),
          project_handover_list: JSON.stringify(projectHandover),
          project_manhours_list: JSON.stringify(projectManhours),
          project_query_log_list: JSON.stringify(queryLog),
          project_assumption_list: JSON.stringify(assumptions),
            project_lessons_learnt_list: JSON.stringify(lessonsLearnt),
          project_schedule_list: JSON.stringify(projectSchedule),
          project_activity_list: JSON.stringify(projectActivityRows)
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

  // Input Document List Management
  const addInputDocument = () => {
    if (newInputDocument.trim()) {
      const newDoc = {
        id: Date.now(),
        text: newInputDocument.trim(),
        name: newInputDocument.trim(),
        fileUrl: null,
        thumbUrl: null,
        addedAt: new Date().toISOString()
      };
      const updated = [...inputDocumentsList, newDoc];
      setInputDocumentsList(updated);
      setNewInputDocument('');
      // Persist as JSON array
      setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
    }
  };

  const removeInputDocument = (id) => {
    const updatedList = inputDocumentsList.filter(doc => doc.id !== id);
    setInputDocumentsList(updatedList);
    setForm(prev => ({ ...prev, input_document: JSON.stringify(updatedList) }));
  };

  const handleInputDocumentKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addInputDocument();
    }
  };

  // Load document master for suggestions
  useEffect(() => {
    const loadDocMaster = async () => {
      try {
        const res = await fetchJSON('/api/document-master');
        if (res?.success && Array.isArray(res.data)) {
          setDocMaster(res.data);
        }
      } catch (e) {
        // non-fatal
      }
    };
    loadDocMaster();
  }, []);

  // File upload for input documents (images / svg -> via /api/uploads). Other file types can be added later.
  const handleInputDocumentFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const b64 = reader.result;
        try {
          const uploadResp = await fetchJSON('/api/uploads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, b64 })
          });
          if (uploadResp.success) {
            const newDoc = {
              id: Date.now(),
              text: file.name,
              name: file.name,
              fileUrl: uploadResp.data.fileUrl,
              thumbUrl: uploadResp.data.thumbUrl,
              addedAt: new Date().toISOString()
            };
            const updated = [...inputDocumentsList, newDoc];
            setInputDocumentsList(updated);
            setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
          } else {
            alert(uploadResp.error || 'Upload failed');
          }
        } catch (err) {
          console.error('Upload failed', err);
          alert('Upload failed');
        }
      };
      reader.readAsDataURL(file);
    } catch (e) {
      console.error('File processing error', e);
    } finally {
      // reset input so same file can be re-selected
      event.target.value = '';
    }
  };

  // Documentation Tab - Detailed Document Management
  const addDocument = () => {
    if (newDocument.name.trim()) {
      const doc = {
        id: Date.now(),
        name: newDocument.name.trim(),
        number: newDocument.number.trim(),
        revision: newDocument.revision.trim(),
        quantity: newDocument.quantity.trim(),
        sentBy: newDocument.sentBy.trim(),
        remarks: newDocument.remarks.trim(),
        addedAt: new Date().toISOString()
      };
      setDocumentsList([...documentsList, doc]);
      setNewDocument({
        name: '',
        number: '',
        revision: '',
        quantity: '',
        sentBy: '',
        remarks: ''
      });
    }
  };

  // Documents Received helpers
  const addReceivedDocument = () => {
    // Basic validation: require description
    if (!newReceivedDoc.description || !newReceivedDoc.description.trim()) return;

    // Defaults: auto-increment sr_no and default date to today if not provided
    const defaultSr = newReceivedDoc.sr_no && String(newReceivedDoc.sr_no).trim() !== '' ? newReceivedDoc.sr_no : String(documentsReceived.length + 1);
    const today = new Date().toISOString().slice(0,10);
    const doc = { 
      ...newReceivedDoc, 
      id: Date.now(),
      sr_no: defaultSr,
      date_received: newReceivedDoc.date_received || today
    };
    setDocumentsReceived(prev => [...prev, doc]);
    setNewReceivedDoc({ sr_no: '', date_received: '', description: '', drawing_number: '', revision_number: '', unit_qty: '', document_sent_by: '', remarks: '' });

    // Focus description input for fast entry
    setTimeout(() => {
      newReceivedDescRef.current?.focus();
    }, 10);
  };

  const updateReceivedDocument = (id, field, value) => {
    setDocumentsReceived(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const removeReceivedDocument = (id) => {
    setDocumentsReceived(prev => prev.filter(d => d.id !== id));
  };

  // Documents Issued helpers
  const addIssuedDocument = () => {
    if (!newIssuedDoc.document_name || !newIssuedDoc.document_name.trim()) return;
    const defaultSr = newIssuedDoc.sr_no && String(newIssuedDoc.sr_no).trim() !== '' ? newIssuedDoc.sr_no : String(documentsIssued.length + 1);
    const issueDate = newIssuedDoc.issue_date || new Date().toISOString().slice(0,10);
    const doc = { ...newIssuedDoc, id: Date.now(), sr_no: defaultSr, issue_date: issueDate };
    setDocumentsIssued(prev => [...prev, doc]);
    setNewIssuedDoc({ sr_no: '', document_name: '', document_number: '', revision_number: '', issue_date: '', remarks: '' });
    setTimeout(() => newIssuedDescRef.current?.focus(), 10);
  };

  const updateIssuedDocument = (id, field, value) => {
    setDocumentsIssued(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const removeIssuedDocument = (id) => {
    setDocumentsIssued(prev => prev.filter(d => d.id !== id));
  };

  // Project Handover helpers
  const addHandoverRow = () => {
    if (!newHandoverRow.output_by_accent || !newHandoverRow.output_by_accent.trim()) return;
    const defaultSr = newHandoverRow.sr_no && String(newHandoverRow.sr_no).trim() !== '' ? newHandoverRow.sr_no : String(projectHandover.length + 1);
    const row = { ...newHandoverRow, id: Date.now(), sr_no: defaultSr };
    setProjectHandover(prev => [...prev, row]);
    setNewHandoverRow({ sr_no: '', output_by_accent: '', requirement_accomplished: '', remark: '', hand_over: '' });
    setTimeout(() => newHandoverDescRef.current?.focus(), 10);
  };

  const updateHandoverRow = (id, field, value) => {
    setProjectHandover(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeHandoverRow = (id) => {
    setProjectHandover(prev => prev.filter(r => r.id !== id));
  };

  // Project Manhours helpers
  const addManhourRow = () => {
    if (!newManhourRow.name_of_engineer_designer || !newManhourRow.name_of_engineer_designer.trim()) return;
    const defaultSr = newManhourRow.sr_no && String(newManhourRow.sr_no).trim() !== '' ? newManhourRow.sr_no : String(projectManhours.length + 1);
    const row = { ...newManhourRow, id: Date.now(), sr_no: defaultSr };
    setProjectManhours(prev => [...prev, row]);
    setNewManhourRow({ sr_no: '', month: '', name_of_engineer_designer: '', engineering: '', designer: '', drafting: '', checking: '', coordination: '', site_visit: '', others: '', remarks: '' });
    setTimeout(() => newManhourNameRef.current?.focus(), 10);
  };

  const updateManhourRow = (id, field, value) => {
    setProjectManhours(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeManhourRow = (id) => {
    setProjectManhours(prev => prev.filter(r => r.id !== id));
  };

  // Query Log helpers
  const addQueryRow = () => {
    if (!newQuery.query_description || !newQuery.query_description.trim()) return;
    const defaultSr = newQuery.sr_no && String(newQuery.sr_no).trim() !== '' ? newQuery.sr_no : String(queryLog.length + 1);
    const issuedDate = newQuery.query_issued_date || new Date().toISOString().slice(0,10);
    const row = { ...newQuery, id: Date.now(), sr_no: defaultSr, query_issued_date: issuedDate };
    setQueryLog(prev => [...prev, row]);
    setNewQuery({ sr_no: '', query_description: '', query_issued_date: '', reply_from_client: '', reply_received_date: '', query_updated_by: '', query_resolved: '', remark: '' });
    setTimeout(() => newQueryDescRef.current?.focus(), 10);
  };

  const updateQueryRow = (id, field, value) => {
    setQueryLog(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeQueryRow = (id) => {
    setQueryLog(prev => prev.filter(r => r.id !== id));
  };

  // Assumption helpers
  const addAssumptionRow = () => {
    if (!newAssumption.assumption_description || !newAssumption.assumption_description.trim()) return;
    const defaultSr = newAssumption.sr_no && String(newAssumption.sr_no).trim() !== '' ? newAssumption.sr_no : String(assumptions.length + 1);
    const row = { ...newAssumption, id: Date.now(), sr_no: defaultSr };
    setAssumptions(prev => [...prev, row]);
    setNewAssumption({ sr_no: '', assumption_description: '', reason: '', assumption_taken_by: '', remark: '' });
    setTimeout(() => newAssumptionDescRef.current?.focus(), 10);
  };

  const updateAssumptionRow = (id, field, value) => {
    setAssumptions(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeAssumptionRow = (id) => {
    setAssumptions(prev => prev.filter(r => r.id !== id));
  };

  // Lessons Learnt helpers
  const addLessonRow = () => {
    if (!newLesson.what_was_new || !newLesson.what_was_new.trim()) return;
    const defaultSr = newLesson.sr_no && String(newLesson.sr_no).trim() !== '' ? newLesson.sr_no : String(lessonsLearnt.length + 1);
    const row = { ...newLesson, id: Date.now(), sr_no: defaultSr };
    setLessonsLearnt(prev => [...prev, row]);
    setNewLesson({ sr_no: '', what_was_new: '', difficulty_faced: '', what_you_learn: '', areas_of_improvement: '', remark: '' });
    setTimeout(() => newLessonDescRef.current?.focus(), 10);
  };

  const updateLessonRow = (id, field, value) => {
    setLessonsLearnt(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeLessonRow = (id) => {
    setLessonsLearnt(prev => prev.filter(r => r.id !== id));
  };

  // Project Activity helpers
  const addActivityRow = () => {
    if (!newActivity.daily_activity || !newActivity.daily_activity.trim()) return;
    const defaultSr = newActivity.sr_no && String(newActivity.sr_no).trim() !== '' ? newActivity.sr_no : String(projectActivityRows.length + 1);
    const defaultDate = newActivity.date || new Date().toISOString().slice(0,10);
    const row = { ...newActivity, id: Date.now(), sr_no: defaultSr, date: defaultDate };
    setProjectActivityRows(prev => [...prev, row]);
    setNewActivity({ sr_no: '', date: '', daily_activity: '', unit_qty: '', planned_hours: '', start_time: '', end_time: '', actual_hours: '', activity_done_by: '', status_completed: '', remark: '' });
    setTimeout(() => newActivityDescRef.current?.focus(), 10);
  };

  const updateActivityRow = (id, field, value) => {
    setProjectActivityRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeActivityRow = (id) => {
    setProjectActivityRows(prev => prev.filter(r => r.id !== id));
  };

  // Project Schedule helpers (add/update/remove)
  const addSchedule = () => {
    if (!newSchedule.activity_description || !newSchedule.activity_description.trim()) return;
    const defaultSr = newSchedule.sr_no && String(newSchedule.sr_no).trim() !== '' ? newSchedule.sr_no : String(projectSchedule.length + 1);
    const sch = {
      ...newSchedule,
      id: Date.now(),
      sr_no: defaultSr
    };
    setProjectSchedule(prev => [...prev, sch]);
    setNewSchedule({ sr_no: '', activity_description: '', unit_qty: '', start_date: '', end_date: '', time_required: '', status_completed: '', remarks: '' });
    setTimeout(() => newScheduleDescRef.current?.focus(), 10);
  };

  const updateSchedule = (id, field, value) => {
    setProjectSchedule(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeSchedule = (id) => {
    setProjectSchedule(prev => prev.filter(r => r.id !== id));
  };

  const removeDocument = (id) => {
    setDocumentsList(documentsList.filter(doc => doc.id !== id));
  };

  const updateDocumentField = (field, value) => {
    setNewDocument(prev => ({ ...prev, [field]: value }));
  };

  // Project Planning Tab - Activity Management
  const addPlanningActivity = () => {
    if (newPlanningActivity.activity.trim()) {
      const activity = {
        id: Date.now(),
        serialNumber: newPlanningActivity.serialNumber.trim() || (planningActivities.length + 1).toString(),
        activity: newPlanningActivity.activity.trim(),
        quantity: newPlanningActivity.quantity.trim(),
        startDate: newPlanningActivity.startDate,
        endDate: newPlanningActivity.endDate,
        actualCompletionDate: newPlanningActivity.actualCompletionDate,
        timeRequired: newPlanningActivity.timeRequired.trim(),
        actualTimeRequired: newPlanningActivity.actualTimeRequired.trim(),
        addedAt: new Date().toISOString()
      };
      setPlanningActivities([...planningActivities, activity]);
      setNewPlanningActivity({
        serialNumber: '',
        activity: '',
        quantity: '',
        startDate: '',
        endDate: '',
        actualCompletionDate: '',
        timeRequired: '',
        actualTimeRequired: ''
      });
    }
  };

  const removePlanningActivity = (id) => {
    setPlanningActivities(planningActivities.filter(act => act.id !== id));
  };

  const updatePlanningActivityField = (field, value) => {
    setNewPlanningActivity(prev => ({ ...prev, [field]: value }));
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

  // Scope Activity table helpers (add/update/remove rows with status & deliverables)
  const addScopeActivity = () => {
    const name = (newScopeActivityName || '').trim();
    if (!name) return;
    const row = {
      id: Date.now(),
      type: 'manual',
      name,
      status: 'NEW',
      deliverables: ''
    };
    setProjectActivities(prev => [...prev, row]);
    setNewScopeActivityName('');
  };

  const updateScopeActivity = (id, field, value) => {
    setProjectActivities(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeScopeActivity = (id) => {
    setProjectActivities(prev => prev.filter(r => r.id !== id));
  };

  // Internal Meetings helpers (add/update/remove)
  const addInternalMeeting = () => {
    const meeting = {
      id: Date.now(),
      meeting_no: '',
      client_name: '',
      meeting_date: '',
      organizer: '',
      minutes_drafted: '',
      meeting_location: '',
      client_representative: '',
      meeting_title: newInternalMeetingTitle || '',
      points_discussed: '',
      persons_involved: ''
    };
    setInternalMeetings(prev => [...prev, meeting]);
    setNewInternalMeetingTitle('');
  };

  const updateInternalMeeting = (id, field, value) => {
    setInternalMeetings(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const removeInternalMeeting = (id) => {
    setInternalMeetings(prev => prev.filter(m => m.id !== id));
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
        project_activities_list: JSON.stringify(projectActivities),
        planning_activities_list: JSON.stringify(planningActivities),
        documents_list: JSON.stringify(documentsList),
        internal_meetings_list: JSON.stringify(internalMeetings),
        documents_received_list: JSON.stringify(documentsReceived),
        documents_issued_list: JSON.stringify(documentsIssued),
        project_handover_list: JSON.stringify(projectHandover),
        project_manhours_list: JSON.stringify(projectManhours),
        	project_query_log_list: JSON.stringify(queryLog),
        	project_assumption_list: JSON.stringify(assumptions),
      	project_lessons_learnt_list: JSON.stringify(lessonsLearnt),
        project_schedule_list: JSON.stringify(projectSchedule),
        project_activity_list: JSON.stringify(projectActivityRows)
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
              <div className="px-6 py-3">
                <div className="flex flex-wrap gap-2">
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

            {/* General / Project Details Tab */}
            {(activeTab === 'general' || activeTab === 'project_details') && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-sm font-semibold text-black">General Project Information</h2>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    {/* Basic Details (collapsible) */}
                    <div className="border-t border-gray-200 pt-4">
                      <button type="button" onClick={() => toggleSection('basic')} className="w-full flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ArrowLeftIcon className="h-4 w-4 text-[#7F2487] rotate-180" />
                          <h3 className="text-sm font-semibold text-black">Basic Details</h3>
                        </div>
                        <div className="text-sm text-gray-500">{openSections.basic ? 'Hide' : 'Show'}</div>
                      </button>
                      {openSections.basic && (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Project Number</label>
                            <input type="text" name="project_id" value={form.project_id} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Project Name</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Company</label>
                            <select name="company_id" value={form.company_id} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                              <option value="">Select company</option>
                              {companies.map((c) => (<option key={c.id} value={c.id}>{c.company_name || c.name}</option>))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Project Start Date</label>
                            <input type="date" name="start_date" value={form.start_date} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Project End Date</label>
                            <input type="date" name="end_date" value={form.end_date} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Project Type</label>
                            <select name="contract_type" value={form.contract_type} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]">
                              <option value="">Select Type</option>
                              {TYPE_OPTIONS.map((type) => (<option key={type} value={type}>{type}</option>))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Estimated Manhours</label>
                            <input type="number" name="estimated_manhours" value={form.estimated_manhours} onChange={handleChange} step="0.1" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Suggestions from Document Master */}
                    {docMaster && docMaster.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {docMaster
                          .filter(d => !newInputDocument || (d.name?.toLowerCase().includes(newInputDocument.toLowerCase()) || d.doc_key?.toLowerCase().includes(newInputDocument.toLowerCase())))
                          .slice(0, 8)
                          .map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => {
                                setNewInputDocument(d.name);
                                addInputDocument();
                              }}
                              className="px-2 py-1 text-xs rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                              title={d.description || ''}
                            >
                              {d.name}
                            </button>
                          ))}
                      </div>
                    )}

                    {/* Scope (collapsible) */}
                    <div className="border-t border-gray-200 pt-4">
                      <button type="button" onClick={() => toggleSection('scope')} className="w-full flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ChevronDownIcon className="h-4 w-4 text-[#7F2487]" />
                          <h3 className="text-sm font-semibold text-black">Scope</h3>
                        </div>
                        <div className="text-sm text-gray-500">{openSections.scope ? 'Hide' : 'Show'}</div>
                      </button>
                      {openSections.scope && (
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Description / Scope</label>
                            <textarea name="description" value={form.description} onChange={handleChange} rows={6} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Input Documents</label>
                            <div className="flex gap-2 mb-3">
                              <input type="text" value={newInputDocument} onChange={(e) => setNewInputDocument(e.target.value)} onKeyPress={handleInputDocumentKeyPress} placeholder="Enter document name" className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                              <button type="button" onClick={addInputDocument} className="px-4 py-2 bg-[#7F2487] text-white text-sm rounded-md">Add</button>
                            </div>
                              {inputDocumentsList.length > 0 && (
                                <div className="space-y-2">
                                  {inputDocumentsList.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
                                      <div className="flex items-center gap-3"><DocumentIcon className="h-4 w-4 text-purple-600" /> <span className="text-sm text-black">{doc.text}</span></div>
                                      <button type="button" onClick={() => removeInputDocument(doc.id)} className="text-red-500">Remove</button>
                                    </div>
                                  ))}
                                </div>
                              )}

                            {/* Scope Activity Table moved to Scope tab */}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Unit / Qty (collapsible) */}
                    <div className="border-t border-gray-200 pt-4">
                      <button type="button" onClick={() => toggleSection('unitQty')} className="w-full flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ChevronRightIcon className="h-4 w-4 text-[#7F2487]" />
                          <h3 className="text-sm font-semibold text-black">Unit / Qty</h3>
                        </div>
                        <div className="text-sm text-gray-500">{openSections.unitQty ? 'Hide' : 'Show'}</div>
                      </button>
                      {openSections.unitQty && (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Unit / Qty</label>
                            <input type="text" name="unit_qty" value={form.unit_qty} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Duration Planned (days)</label>
                            <input type="number" name="project_duration_planned" value={form.project_duration_planned} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Duration Actual (days)</label>
                            <input type="number" name="project_duration_actual" value={form.project_duration_actual} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Deliverables (collapsible) */}
                    <div className="border-t border-gray-200 pt-4">
                      <button type="button" onClick={() => toggleSection('deliverables')} className="w-full flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
                          <h3 className="text-sm font-semibold text-black">Deliverables</h3>
                        </div>
                        <div className="text-sm text-gray-500">{openSections.deliverables ? 'Hide' : 'Show'}</div>
                      </button>
                      {openSections.deliverables && (
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">List of Deliverables</label>
                            <textarea name="list_of_deliverables" value={form.list_of_deliverables} onChange={handleChange} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-black mb-1">Upload Deliverable Files</label>
                            <input type="file" multiple onChange={(e) => handleFileUpload(e.target.files, 'deliverables')} className="w-full text-sm" />
                            {deliverables.length > 0 && (
                              <div className="mt-2 space-y-2">
                                {deliverables.map((f) => (
                                  <div key={f.id} className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded">
                                    <div className="text-sm">{f.name} <span className="text-xs text-gray-500">{f.version}</span></div>
                                    <div className="flex items-center gap-2">
                                      <button type="button" onClick={() => removeFile(f.id, 'deliverables')} className="text-red-600 text-xs">Remove</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Meetings Tab: Kickoff + Internal Meetings */}
            {activeTab === 'minutes_internal_meet' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Meetings</h2>
                  <p className="text-xs text-gray-600 mt-1">Kickoff meeting and Internal project meetings</p>
                </div>

                <div className="px-6 py-5 space-y-6">
                  {/* Kickoff Meeting (single) */}
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-black">Kickoff Meeting</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Meeting No</label>
                        <input type="text" name="kickoff_meeting_no" value={form.kickoff_meeting_no} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Client Name</label>
                        <input type="text" name="kickoff_client_name" value={form.kickoff_client_name} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Meeting Organizer</label>
                        <input type="text" name="kickoff_meeting_organizer" value={form.kickoff_meeting_organizer} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Minutes Drafted</label>
                        <input type="text" name="kickoff_minutes_drafted" value={form.kickoff_minutes_drafted} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Meeting Location</label>
                        <input type="text" name="kickoff_meeting_location" value={form.kickoff_meeting_location} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Client Representative</label>
                        <input type="text" name="kickoff_client_representative" value={form.kickoff_client_representative} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Meeting Title</label>
                        <input type="text" name="kickoff_meeting_title" value={form.kickoff_meeting_title} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Meeting Date</label>
                        <input type="date" name="kickoff_meeting_date" value={form.kickoff_meeting_date} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-black mb-1">Points Discussed</label>
                      <textarea name="kickoff_points_discussed" value={form.kickoff_points_discussed} onChange={handleChange} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-black mb-1">Name of persons involved</label>
                      <textarea name="kickoff_persons_involved" value={form.kickoff_persons_involved} onChange={handleChange} rows={2} placeholder="Comma-separated names" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" />
                    </div>
                  </div>

                  {/* Internal Meetings (multiple) */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-black">Internal Project Meetings</h3>
                      <div className="flex items-center gap-2">
                        <input type="text" placeholder="New meeting title" value={newInternalMeetingTitle} onChange={(e) => setNewInternalMeetingTitle(e.target.value)} className="px-3 py-1 text-sm border border-gray-300 rounded-md" />
                        <button type="button" onClick={addInternalMeeting} className="px-3 py-1 bg-[#7F2487] text-white text-sm rounded-md">Add</button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-100 border-b">
                            <th className="text-left py-2 px-2 font-semibold">Meeting No</th>
                            <th className="text-left py-2 px-2 font-semibold">Date</th>
                            <th className="text-left py-2 px-2 font-semibold">Title</th>
                            <th className="text-left py-2 px-2 font-semibold">Organizer</th>
                            <th className="text-left py-2 px-2 font-semibold">Client Rep</th>
                            <th className="text-left py-2 px-2 font-semibold">Location</th>
                            <th className="text-left py-2 px-2 font-semibold">Points Discussed</th>
                            <th className="text-left py-2 px-2 font-semibold">Persons Involved</th>
                            <th className="text-center py-2 px-2 font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {internalMeetings.length === 0 ? (
                            <tr><td colSpan={9} className="text-center py-4 text-gray-500">No internal meetings added</td></tr>
                          ) : (
                            internalMeetings.map((m) => (
                              <tr key={m.id} className="border-b hover:bg-gray-50 align-top">
                                <td className="py-2 px-2"><input type="text" value={m.meeting_no || ''} onChange={(e) => updateInternalMeeting(m.id, 'meeting_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="date" value={m.meeting_date || ''} onChange={(e) => updateInternalMeeting(m.id, 'meeting_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="text" value={m.meeting_title || ''} onChange={(e) => updateInternalMeeting(m.id, 'meeting_title', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="text" value={m.organizer || ''} onChange={(e) => updateInternalMeeting(m.id, 'organizer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="text" value={m.client_representative || ''} onChange={(e) => updateInternalMeeting(m.id, 'client_representative', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="text" value={m.meeting_location || ''} onChange={(e) => updateInternalMeeting(m.id, 'meeting_location', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="text" value={m.points_discussed || ''} onChange={(e) => updateInternalMeeting(m.id, 'points_discussed', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2"><input type="text" value={m.persons_involved || ''} onChange={(e) => updateInternalMeeting(m.id, 'persons_involved', e.target.value)} placeholder="Comma-separated" className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                                <td className="py-2 px-2 text-center"><button type="button" onClick={() => removeInternalMeeting(m.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Project Handover Tab */}
            {activeTab === 'project_handover' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Handover</h2>
                  <p className="text-xs text-gray-600 mt-1">Handover checklist / outputs delivered by Accent</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newHandoverRow.sr_no} onChange={(e)=>setNewHandoverRow(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-2">
                      <input ref={newHandoverDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addHandoverRow(); } }} type="text" placeholder="Output by Accent" value={newHandoverRow.output_by_accent} onChange={(e)=>setNewHandoverRow(prev=>({...prev,output_by_accent:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <select value={newHandoverRow.requirement_accomplished} onChange={(e)=>setNewHandoverRow(prev=>({...prev,requirement_accomplished:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded">
                        <option value="">Requirement Accomplished?</option>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                    </div>
                    <div>
                      <input type="text" placeholder="Remark" value={newHandoverRow.remark} onChange={(e)=>setNewHandoverRow(prev=>({...prev,remark:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <select value={newHandoverRow.hand_over} onChange={(e)=>setNewHandoverRow(prev=>({...prev,hand_over:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded">
                        <option value="">Hand Over</option>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addHandoverRow} disabled={!(newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim())} className={`px-3 py-1 rounded-md text-sm ${newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Handover Row
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Output by Accent</th>
                          <th className="text-left py-2 px-2 font-semibold">Requirement Accomplished</th>
                          <th className="text-left py-2 px-2 font-semibold">Remark</th>
                          <th className="text-left py-2 px-2 font-semibold">Hand Over</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectHandover.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-4 text-gray-500">No handover rows recorded</td></tr>
                        ) : (
                          projectHandover.map(r => (
                            <tr key={r.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={r.sr_no || ''} onChange={(e)=>updateHandoverRow(r.id,'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={r.output_by_accent || ''} onChange={(e)=>updateHandoverRow(r.id,'output_by_accent', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><select value={r.requirement_accomplished || ''} onChange={(e)=>updateHandoverRow(r.id,'requirement_accomplished', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                              <td className="py-2 px-2"><input type="text" value={r.remark || ''} onChange={(e)=>updateHandoverRow(r.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><select value={r.hand_over || ''} onChange={(e)=>updateHandoverRow(r.id,'hand_over', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={()=>removeHandoverRow(r.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Project Manhours Tab */}
            {activeTab === 'project_manhours' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Manhours</h2>
                  <p className="text-xs text-gray-600 mt-1">Track monthly manhours per engineer/designer across activities</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="S.N." value={newManhourRow.sr_no} onChange={(e)=>setNewManhourRow(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="month" placeholder="Month" value={newManhourRow.month} onChange={(e)=>setNewManhourRow(prev=>({...prev,month:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-3">
                      <input ref={newManhourNameRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addManhourRow(); } }} type="text" placeholder="Name of Engineer/Designer" value={newManhourRow.name_of_engineer_designer} onChange={(e)=>setNewManhourRow(prev=>({...prev,name_of_engineer_designer:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="number" placeholder="Engineering" value={newManhourRow.engineering} onChange={(e)=>setNewManhourRow(prev=>({...prev,engineering:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Designer" value={newManhourRow.designer} onChange={(e)=>setNewManhourRow(prev=>({...prev,designer:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Drafting" value={newManhourRow.drafting} onChange={(e)=>setNewManhourRow(prev=>({...prev,drafting:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Checking" value={newManhourRow.checking} onChange={(e)=>setNewManhourRow(prev=>({...prev,checking:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Co-ordation" value={newManhourRow.coordination} onChange={(e)=>setNewManhourRow(prev=>({...prev,coordination:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Site Visit" value={newManhourRow.site_visit} onChange={(e)=>setNewManhourRow(prev=>({...prev,site_visit:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Others" value={newManhourRow.others} onChange={(e)=>setNewManhourRow(prev=>({...prev,others:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Remarks" value={newManhourRow.remarks} onChange={(e)=>setNewManhourRow(prev=>({...prev,remarks:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addManhourRow} disabled={!(newManhourRow.name_of_engineer_designer && newManhourRow.name_of_engineer_designer.trim())} className={`px-3 py-1 rounded-md text-sm ${newManhourRow.name_of_engineer_designer && newManhourRow.name_of_engineer_designer.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Row
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">S.N.</th>
                          <th className="text-left py-2 px-2 font-semibold">Month</th>
                          <th className="text-left py-2 px-2 font-semibold">Name of Engineer/Designer</th>
                          <th className="text-left py-2 px-2 font-semibold">Engineering</th>
                          <th className="text-left py-2 px-2 font-semibold">Designer</th>
                          <th className="text-left py-2 px-2 font-semibold">Drafting</th>
                          <th className="text-left py-2 px-2 font-semibold">Checking</th>
                          <th className="text-left py-2 px-2 font-semibold">Co-ordation</th>
                          <th className="text-left py-2 px-2 font-semibold">Site Visit</th>
                          <th className="text-left py-2 px-2 font-semibold">Others</th>
                          <th className="text-left py-2 px-2 font-semibold">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectManhours.length === 0 ? (
                          <tr><td colSpan={12} className="text-center py-4 text-gray-500">No manhours recorded</td></tr>
                        ) : (
                          projectManhours.map(r => (
                            <tr key={r.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={r.sr_no || ''} onChange={(e)=>updateManhourRow(r.id,'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="month" value={r.month || ''} onChange={(e)=>updateManhourRow(r.id,'month', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={r.name_of_engineer_designer || ''} onChange={(e)=>updateManhourRow(r.id,'name_of_engineer_designer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.engineering || ''} onChange={(e)=>updateManhourRow(r.id,'engineering', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.designer || ''} onChange={(e)=>updateManhourRow(r.id,'designer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.drafting || ''} onChange={(e)=>updateManhourRow(r.id,'drafting', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.checking || ''} onChange={(e)=>updateManhourRow(r.id,'checking', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.coordination || ''} onChange={(e)=>updateManhourRow(r.id,'coordination', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.site_visit || ''} onChange={(e)=>updateManhourRow(r.id,'site_visit', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.others || ''} onChange={(e)=>updateManhourRow(r.id,'others', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={r.remarks || ''} onChange={(e)=>updateManhourRow(r.id,'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={()=>removeManhourRow(r.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Query Log Tab */}
            {activeTab === 'query_log' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Query Log</h2>
                  <p className="text-xs text-gray-600 mt-1">Log project queries and responses</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newQuery.sr_no} onChange={(e)=>setNewQuery(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-3">
                      <input ref={newQueryDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addQueryRow(); } }} type="text" placeholder="Query Description" value={newQuery.query_description} onChange={(e)=>setNewQuery(prev=>({...prev,query_description:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="date" placeholder="Query Issued Date" value={newQuery.query_issued_date} onChange={(e)=>setNewQuery(prev=>({...prev,query_issued_date:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Reply from Client" value={newQuery.reply_from_client} onChange={(e)=>setNewQuery(prev=>({...prev,reply_from_client:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="date" placeholder="Reply Received Date" value={newQuery.reply_received_date} onChange={(e)=>setNewQuery(prev=>({...prev,reply_received_date:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Query updated by" value={newQuery.query_updated_by} onChange={(e)=>setNewQuery(prev=>({...prev,query_updated_by:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <select value={newQuery.query_resolved} onChange={(e)=>setNewQuery(prev=>({...prev,query_resolved:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded">
                        <option value="">Query Resolved?</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Pending">Pending</option>
                      </select>
                    </div>
                    <div>
                      <input type="text" placeholder="Remark" value={newQuery.remark} onChange={(e)=>setNewQuery(prev=>({...prev,remark:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addQueryRow} disabled={!(newQuery.query_description && newQuery.query_description.trim())} className={`px-3 py-1 rounded-md text-sm ${newQuery.query_description && newQuery.query_description.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Query
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Query Description</th>
                          <th className="text-left py-2 px-2 font-semibold">Query Issued Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Reply from Client</th>
                          <th className="text-left py-2 px-2 font-semibold">Reply Received Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Query updated by</th>
                          <th className="text-left py-2 px-2 font-semibold">Query Resolved</th>
                          <th className="text-left py-2 px-2 font-semibold">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queryLog.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-4 text-gray-500">No queries recorded</td></tr>
                        ) : (
                          queryLog.map(q => (
                            <tr key={q.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={q.sr_no || ''} onChange={(e)=>updateQueryRow(q.id,'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={q.query_description || ''} onChange={(e)=>updateQueryRow(q.id,'query_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={q.query_issued_date || ''} onChange={(e)=>updateQueryRow(q.id,'query_issued_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={q.reply_from_client || ''} onChange={(e)=>updateQueryRow(q.id,'reply_from_client', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={q.reply_received_date || ''} onChange={(e)=>updateQueryRow(q.id,'reply_received_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={q.query_updated_by || ''} onChange={(e)=>updateQueryRow(q.id,'query_updated_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><select value={q.query_resolved || ''} onChange={(e)=>updateQueryRow(q.id,'query_resolved', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option><option value="Pending">Pending</option></select></td>
                              <td className="py-2 px-2"><input type="text" value={q.remark || ''} onChange={(e)=>updateQueryRow(q.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={()=>removeQueryRow(q.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Assumption Tab */}
            {activeTab === 'assumption' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Assumptions</h2>
                  <p className="text-xs text-gray-600 mt-1">Record project assumptions and rationale</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newAssumption.sr_no} onChange={(e)=>setNewAssumption(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-3">
                      <input ref={newAssumptionDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addAssumptionRow(); } }} type="text" placeholder="Assumption Description" value={newAssumption.assumption_description} onChange={(e)=>setNewAssumption(prev=>({...prev,assumption_description:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="text" placeholder="Reason" value={newAssumption.reason} onChange={(e)=>setNewAssumption(prev=>({...prev,reason:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Assumption Taken By" value={newAssumption.assumption_taken_by} onChange={(e)=>setNewAssumption(prev=>({...prev,assumption_taken_by:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Remark" value={newAssumption.remark} onChange={(e)=>setNewAssumption(prev=>({...prev,remark:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addAssumptionRow} disabled={!(newAssumption.assumption_description && newAssumption.assumption_description.trim())} className={`px-3 py-1 rounded-md text-sm ${newAssumption.assumption_description && newAssumption.assumption_description.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Assumption
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Assumption Description</th>
                          <th className="text-left py-2 px-2 font-semibold">Reason</th>
                          <th className="text-left py-2 px-2 font-semibold">Assumption Taken By</th>
                          <th className="text-left py-2 px-2 font-semibold">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assumptions.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-4 text-gray-500">No assumptions recorded</td></tr>
                        ) : (
                          assumptions.map(a => (
                            <tr key={a.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={a.sr_no || ''} onChange={(e)=>updateAssumptionRow(a.id,'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={a.assumption_description || ''} onChange={(e)=>updateAssumptionRow(a.id,'assumption_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={a.reason || ''} onChange={(e)=>updateAssumptionRow(a.id,'reason', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={a.assumption_taken_by || ''} onChange={(e)=>updateAssumptionRow(a.id,'assumption_taken_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={a.remark || ''} onChange={(e)=>updateAssumptionRow(a.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={()=>removeAssumptionRow(a.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Lessons Learnt Tab */}
            {activeTab === 'lessons_learnt' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Lessons Learnt</h2>
                  <p className="text-xs text-gray-600 mt-1">Capture learning from the project</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newLesson.sr_no} onChange={(e)=>setNewLesson(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-3">
                      <input ref={newLessonDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addLessonRow(); } }} type="text" placeholder="What was new" value={newLesson.what_was_new} onChange={(e)=>setNewLesson(prev=>({...prev,what_was_new:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div className="md:col-span-2">
                      <input type="text" placeholder="What difficulty face" value={newLesson.difficulty_faced} onChange={(e)=>setNewLesson(prev=>({...prev,difficulty_faced:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-2">
                      <input type="text" placeholder="What you learn" value={newLesson.what_you_learn} onChange={(e)=>setNewLesson(prev=>({...prev,what_you_learn:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-2">
                      <input type="text" placeholder="Areas of Improvement" value={newLesson.areas_of_improvement} onChange={(e)=>setNewLesson(prev=>({...prev,areas_of_improvement:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Remark" value={newLesson.remark} onChange={(e)=>setNewLesson(prev=>({...prev,remark:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addLessonRow} disabled={!(newLesson.what_was_new && newLesson.what_was_new.trim())} className={`px-3 py-1 rounded-md text-sm ${newLesson.what_was_new && newLesson.what_was_new.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Lesson
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">What was new</th>
                          <th className="text-left py-2 px-2 font-semibold">What difficulty face</th>
                          <th className="text-left py-2 px-2 font-semibold">What you learn</th>
                          <th className="text-left py-2 px-2 font-semibold">Areas of Improvement</th>
                          <th className="text-left py-2 px-2 font-semibold">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lessonsLearnt.length === 0 ? (
                          <tr><td colSpan={7} className="text-center py-4 text-gray-500">No lessons recorded</td></tr>
                        ) : (
                          lessonsLearnt.map(l => (
                            <tr key={l.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={l.sr_no || ''} onChange={(e)=>updateLessonRow(l.id,'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={l.what_was_new || ''} onChange={(e)=>updateLessonRow(l.id,'what_was_new', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={l.difficulty_faced || ''} onChange={(e)=>updateLessonRow(l.id,'difficulty_faced', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={l.what_you_learn || ''} onChange={(e)=>updateLessonRow(l.id,'what_you_learn', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={l.areas_of_improvement || ''} onChange={(e)=>updateLessonRow(l.id,'areas_of_improvement', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={l.remark || ''} onChange={(e)=>updateLessonRow(l.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={()=>removeLessonRow(l.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Documents Issued Tab */}
            {activeTab === 'documents_issued' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Document Issued to Client</h2>
                  <p className="text-xs text-gray-600 mt-1">Track documents issued to client (Sr. No., Document Name, Number, Revision, Issue Date, Remarks)</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newIssuedDoc.sr_no} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-2">
                      <input ref={newIssuedDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addIssuedDocument(); } }} type="text" placeholder="Document Name" value={newIssuedDoc.document_name} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,document_name:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="text" placeholder="Document Number" value={newIssuedDoc.document_number} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,document_number:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Revision. No." value={newIssuedDoc.revision_number} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,revision_number:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="date" placeholder="Issue Date" value={newIssuedDoc.issue_date} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,issue_date:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Remarks" value={newIssuedDoc.remarks} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,remarks:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addIssuedDocument} disabled={!(newIssuedDoc.document_name && newIssuedDoc.document_name.trim())} className={`px-3 py-1 rounded-md text-sm ${newIssuedDoc.document_name && newIssuedDoc.document_name.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Document Issued
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Document Name</th>
                          <th className="text-left py-2 px-2 font-semibold">Document Number</th>
                          <th className="text-left py-2 px-2 font-semibold">Revision. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Issue Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documentsIssued.length === 0 ? (
                          <tr><td colSpan={7} className="text-center py-4 text-gray-500">No issued documents recorded</td></tr>
                        ) : (
                          documentsIssued.map(d => (
                            <tr key={d.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={d.sr_no || ''} onChange={(e) => updateIssuedDocument(d.id, 'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.document_name || ''} onChange={(e) => updateIssuedDocument(d.id, 'document_name', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.document_number || ''} onChange={(e) => updateIssuedDocument(d.id, 'document_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.revision_number || ''} onChange={(e) => updateIssuedDocument(d.id, 'revision_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={d.issue_date || ''} onChange={(e) => updateIssuedDocument(d.id, 'issue_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.remarks || ''} onChange={(e) => updateIssuedDocument(d.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={() => removeIssuedDocument(d.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Documents Received Tab */}
            {activeTab === 'documents_received' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">List of Documents Received</h2>
                  <p className="text-xs text-gray-600 mt-1">Record documents received with details</p>
                </div>

                <div className="px-6 py-5">
                      <div className="mb-3 grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newReceivedDoc.sr_no} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="date" placeholder="Date" value={newReceivedDoc.date_received} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,date_received:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-2">
                      <input ref={newReceivedDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addReceivedDocument(); } }} type="text" placeholder="Description / Document Name" value={newReceivedDoc.description} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,description:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="text" placeholder="Drawing Number" value={newReceivedDoc.drawing_number} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,drawing_number:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Revision Number" value={newReceivedDoc.revision_number} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,revision_number:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Unit / Qty" value={newReceivedDoc.unit_qty} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,unit_qty:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Document Sent by" value={newReceivedDoc.document_sent_by} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,document_sent_by:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Remarks" value={newReceivedDoc.remarks} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,remarks:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addReceivedDocument} disabled={!(newReceivedDoc.description && newReceivedDoc.description.trim())} className={`px-3 py-1 rounded-md text-sm ${newReceivedDoc.description && newReceivedDoc.description.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Document
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Output by Accent</th>
                          <th className="text-left py-2 px-2 font-semibold">Requirement Accomplished (Y/N)</th>
                          <th className="text-left py-2 px-2 font-semibold">Remark</th>
                          <th className="text-left py-2 px-2 font-semibold">Hand Over (Y/N)</th>
                          <th className="text-left py-2 px-2 font-semibold">Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Description / Document Name</th>
                          <th className="text-left py-2 px-2 font-semibold">Drawing Number</th>
                          <th className="text-left py-2 px-2 font-semibold">Revision Number</th>
                          <th className="text-left py-2 px-2 font-semibold">Unit / Qty</th>
                          <th className="text-left py-2 px-2 font-semibold">Document Sent by</th>
                          <th className="text-left py-2 px-2 font-semibold">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documentsReceived.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-4 text-gray-500">No documents recorded</td></tr>
                        ) : (
                          documentsReceived.map(d => (
                            <tr key={d.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="text" value={d.sr_no || ''} onChange={(e) => updateReceivedDocument(d.id, 'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={d.date_received || ''} onChange={(e) => updateReceivedDocument(d.id, 'date_received', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.description || ''} onChange={(e) => updateReceivedDocument(d.id, 'description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.drawing_number || ''} onChange={(e) => updateReceivedDocument(d.id, 'drawing_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.revision_number || ''} onChange={(e) => updateReceivedDocument(d.id, 'revision_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.unit_qty || ''} onChange={(e) => updateReceivedDocument(d.id, 'unit_qty', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.document_sent_by || ''} onChange={(e) => updateReceivedDocument(d.id, 'document_sent_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={d.remarks || ''} onChange={(e) => updateReceivedDocument(d.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={() => removeReceivedDocument(d.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Project Schedule Tab */}
            {activeTab === 'project_schedule' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Schedule</h2>
                  <p className="text-xs text-gray-600 mt-1">Add activities/tasks, durations and status</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newSchedule.sr_no} onChange={(e)=>setNewSchedule(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-2">
                      <input ref={newScheduleDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addSchedule(); } }} type="text" placeholder="Activity / Task Description" value={newSchedule.activity_description} onChange={(e)=>setNewSchedule(prev=>({...prev,activity_description:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="text" placeholder="Unit/Qty" value={newSchedule.unit_qty} onChange={(e)=>setNewSchedule(prev=>({...prev,unit_qty:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="date" placeholder="Start Date" value={newSchedule.start_date} onChange={(e)=>setNewSchedule(prev=>({...prev,start_date:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="date" placeholder="Completion Date" value={newSchedule.end_date} onChange={(e)=>setNewSchedule(prev=>({...prev,end_date:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Time/Hours Required" value={newSchedule.time_required} onChange={(e)=>setNewSchedule(prev=>({...prev,time_required:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <select value={newSchedule.status_completed} onChange={(e)=>setNewSchedule(prev=>({...prev,status_completed:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded">
                        <option value="">Status</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Ongoing">Ongoing</option>
                      </select>
                    </div>
                    <div>
                      <input type="text" placeholder="Remarks" value={newSchedule.remarks} onChange={(e)=>setNewSchedule(prev=>({...prev,remarks:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addSchedule} disabled={!(newSchedule.activity_description && newSchedule.activity_description.trim())} className={`px-3 py-1 rounded-md text-sm ${newSchedule.activity_description && newSchedule.activity_description.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Activity
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Activity / Task Description</th>
                          <th className="text-left py-2 px-2 font-semibold">Unit/Qty</th>
                          <th className="text-left py-2 px-2 font-semibold">Activity Start Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Activity Completion Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Time/Hours Required</th>
                          <th className="text-left py-2 px-2 font-semibold">Status Completed</th>
                          <th className="text-left py-2 px-2 font-semibold">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectSchedule.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-4 text-gray-500">No schedule items added</td></tr>
                        ) : (
                          projectSchedule.map(s => (
                            <tr key={s.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="number" value={s.sr_no || ''} onChange={(e) => updateSchedule(s.id, 'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={s.activity_description || ''} onChange={(e) => updateSchedule(s.id, 'activity_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={s.unit_qty || ''} onChange={(e) => updateSchedule(s.id, 'unit_qty', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={s.start_date || ''} onChange={(e) => updateSchedule(s.id, 'start_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={s.end_date || ''} onChange={(e) => updateSchedule(s.id, 'end_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={s.time_required || ''} onChange={(e) => updateSchedule(s.id, 'time_required', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><select value={s.status_completed || ''} onChange={(e) => updateSchedule(s.id, 'status_completed', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded"><option value="">Status</option><option value="Yes">Yes</option><option value="No">No</option><option value="Ongoing">Ongoing</option></select></td>
                              <td className="py-2 px-2"><input type="text" value={s.remarks || ''} onChange={(e) => updateSchedule(s.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={() => removeSchedule(s.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Project Activity / Daily Activity Tab */}
            {activeTab === 'project_activity' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Activity / Daily Activity</h2>
                  <p className="text-xs text-gray-600 mt-1">Record daily work and time spent</p>
                </div>

                <div className="px-6 py-5">
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div>
                      <input type="number" min="0" placeholder="Sr. No." value={newActivity.sr_no} onChange={(e)=>setNewActivity(prev=>({...prev,sr_no:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="date" placeholder="Date" value={newActivity.date} onChange={(e)=>setNewActivity(prev=>({...prev,date:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div className="md:col-span-3">
                      <input ref={newActivityDescRef} onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addActivityRow(); } }} type="text" placeholder="Daily Activity / Task Description" value={newActivity.daily_activity} onChange={(e)=>setNewActivity(prev=>({...prev,daily_activity:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                      <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                    </div>
                    <div>
                      <input type="text" placeholder="Unit/Qty" value={newActivity.unit_qty} onChange={(e)=>setNewActivity(prev=>({...prev,unit_qty:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Planned Hours" value={newActivity.planned_hours} onChange={(e)=>setNewActivity(prev=>({...prev,planned_hours:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="time" placeholder="Start Time" value={newActivity.start_time} onChange={(e)=>setNewActivity(prev=>({...prev,start_time:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="time" placeholder="End Time" value={newActivity.end_time} onChange={(e)=>setNewActivity(prev=>({...prev,end_time:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="number" placeholder="Actual Hours" value={newActivity.actual_hours} onChange={(e)=>setNewActivity(prev=>({...prev,actual_hours:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <input type="text" placeholder="Activity Done By" value={newActivity.activity_done_by} onChange={(e)=>setNewActivity(prev=>({...prev,activity_done_by:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                    <div>
                      <select value={newActivity.status_completed} onChange={(e)=>setNewActivity(prev=>({...prev,status_completed:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded">
                        <option value="">Status</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Ongoing">Ongoing</option>
                      </select>
                    </div>
                    <div>
                      <input type="text" placeholder="Remark" value={newActivity.remark} onChange={(e)=>setNewActivity(prev=>({...prev,remark:e.target.value}))} className="w-full px-2 py-1 text-sm border rounded" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <button type="button" onClick={addActivityRow} disabled={!(newActivity.daily_activity && newActivity.daily_activity.trim())} className={`px-3 py-1 rounded-md text-sm ${newActivity.daily_activity && newActivity.daily_activity.trim() ? 'bg-[#7F2487] text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                      Add Row
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left py-2 px-2 font-semibold">Sr. No.</th>
                          <th className="text-left py-2 px-2 font-semibold">Date</th>
                          <th className="text-left py-2 px-2 font-semibold">Daily Activity</th>
                          <th className="text-left py-2 px-2 font-semibold">Unit/Qty</th>
                          <th className="text-left py-2 px-2 font-semibold">Planned Hours</th>
                          <th className="text-left py-2 px-2 font-semibold">Start Time</th>
                          <th className="text-left py-2 px-2 font-semibold">End Time</th>
                          <th className="text-left py-2 px-2 font-semibold">Actual Hours Consumed</th>
                          <th className="text-left py-2 px-2 font-semibold">Activity Done By</th>
                          <th className="text-left py-2 px-2 font-semibold">Status Completed</th>
                          <th className="text-left py-2 px-2 font-semibold">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectActivityRows.length === 0 ? (
                          <tr><td colSpan={12} className="text-center py-4 text-gray-500">No activity rows added</td></tr>
                        ) : (
                          projectActivityRows.map(r => (
                            <tr key={r.id} className="border-b hover:bg-gray-50">
                              <td className="py-2 px-2"><input type="number" value={r.sr_no || ''} onChange={(e) => updateActivityRow(r.id, 'sr_no', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="date" value={r.date || ''} onChange={(e) => updateActivityRow(r.id, 'date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={r.daily_activity || ''} onChange={(e) => updateActivityRow(r.id, 'daily_activity', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={r.unit_qty || ''} onChange={(e) => updateActivityRow(r.id, 'unit_qty', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.planned_hours || ''} onChange={(e) => updateActivityRow(r.id, 'planned_hours', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="time" value={r.start_time || ''} onChange={(e) => updateActivityRow(r.id, 'start_time', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="time" value={r.end_time || ''} onChange={(e) => updateActivityRow(r.id, 'end_time', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="number" value={r.actual_hours || ''} onChange={(e) => updateActivityRow(r.id, 'actual_hours', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><input type="text" value={r.activity_done_by || ''} onChange={(e) => updateActivityRow(r.id, 'activity_done_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2"><select value={r.status_completed || ''} onChange={(e) => updateActivityRow(r.id, 'status_completed', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded"><option value="">Status</option><option value="Yes">Yes</option><option value="No">No</option><option value="Ongoing">Ongoing</option></select></td>
                              <td className="py-2 px-2"><input type="text" value={r.remark || ''} onChange={(e) => updateActivityRow(r.id, 'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" /></td>
                              <td className="py-2 px-2 text-center"><button type="button" onClick={() => removeActivityRow(r.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Scope of Work Tab */}
            {activeTab === 'scope' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Scope of Work</h2>
                  <p className="text-xs text-gray-600 mt-1">Define project scope and input documentation</p>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Description</label>
                    <textarea 
                      name="description" 
                      value={form.description} 
                      onChange={handleChange} 
                      rows={8} 
                      placeholder="Describe the project scope, objectives, and key requirements..." 
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Input Documents</label>
                    
                    {/* Add new document input */}
                    <div className="flex gap-2 mb-3">
                      <input 
                        type="text"
                        value={newInputDocument}
                        onChange={(e) => setNewInputDocument(e.target.value)}
                        onKeyPress={handleInputDocumentKeyPress}
                        placeholder="Enter document name (e.g., Specification Rev 2.1)..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                      />
                      <button
                        type="button"
                        onClick={addInputDocument}
                        className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add
                      </button>
                    </div>

                    {/* List of added documents */}
                    {inputDocumentsList.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {inputDocumentsList.map((doc) => (
                          <div 
                            key={doc.id} 
                            className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg group hover:bg-purple-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <DocumentIcon className="h-4 w-4 text-purple-600 flex-shrink-0" />
                              <span className="text-sm text-gray-900">{doc.text}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeInputDocument(doc.id)}
                              className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Remove document"
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Scope Activity Table (moved into Scope tab) */}
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-black mb-2">Project Activity / Status / Deliverables</h4>
                      <div className="mb-2 flex gap-2">
                        <input type="text" value={newScopeActivityName} onChange={(e) => setNewScopeActivityName(e.target.value)} placeholder="Add activity name" className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md" />
                        <button type="button" onClick={addScopeActivity} className="px-3 py-2 bg-[#7F2487] text-white rounded-md text-sm">Add</button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-100 border-b">
                              <th className="text-left py-2 px-2 font-semibold">Activity</th>
                              <th className="text-left py-2 px-2 font-semibold">Status</th>
                              <th className="text-left py-2 px-2 font-semibold">Deliverables</th>
                              <th className="text-center py-2 px-2 font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projectActivities.length === 0 ? (
                              <tr><td colSpan={4} className="text-center py-4 text-gray-500">No activities added for scope</td></tr>
                            ) : (
                              projectActivities.map((act) => (
                                <tr key={act.id} className="border-b hover:bg-gray-50">
                                  <td className="py-2 px-2">
                                    <input type="text" value={act.name} onChange={(e) => updateScopeActivity(act.id, 'name', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded" />
                                  </td>
                                  <td className="py-2 px-2">
                                    <select value={act.status || 'NEW'} onChange={(e) => updateScopeActivity(act.id, 'status', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded">
                                      {STATUS_OPTIONS.map(s => (<option key={s} value={s}>{s}</option>))}
                                    </select>
                                  </td>
                                  <td className="py-2 px-2">
                                    <input type="text" value={act.deliverables || ''} onChange={(e) => updateScopeActivity(act.id, 'deliverables', e.target.value)} placeholder="Comma-separated deliverables" className="w-full text-sm px-2 py-1 border border-gray-200 rounded" />
                                  </td>
                                  <td className="py-2 px-2 text-center">
                                    <button type="button" onClick={() => removeScopeActivity(act.id)} className="text-red-600 text-xs px-2 py-1 rounded border border-red-100">Remove</button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
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
                No team members assigned. Click Add Team Member to begin.
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

            {/* Project Planning Tab */}
            {activeTab === 'planning' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Project Planning</h2>
                  <p className="text-xs text-gray-600 mt-1">Track activities, timelines, and deliverables</p>
                </div>
                <div className="px-6 py-5 space-y-6">
                  {/* Activity Tracking Section */}
                  <div>
                    <h3 className="text-sm font-semibold text-black mb-4">Activity Tracking</h3>
                    
                    {/* Add New Activity Form */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Serial No.</label>
                          <input 
                            type="text"
                            value={newPlanningActivity.serialNumber}
                            onChange={(e) => updatePlanningActivityField('serialNumber', e.target.value)}
                            placeholder="Auto"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Activity *</label>
                          <input 
                            type="text"
                            value={newPlanningActivity.activity}
                            onChange={(e) => updatePlanningActivityField('activity', e.target.value)}
                            placeholder="Enter activity name..."
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                          <input 
                            type="text"
                            value={newPlanningActivity.quantity}
                            onChange={(e) => updatePlanningActivityField('quantity', e.target.value)}
                            placeholder="e.g., 10 units"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                          <input 
                            type="date"
                            value={newPlanningActivity.startDate}
                            onChange={(e) => updatePlanningActivityField('startDate', e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                          <input 
                            type="date"
                            value={newPlanningActivity.endDate}
                            onChange={(e) => updatePlanningActivityField('endDate', e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Actual Completion</label>
                          <input 
                            type="date"
                            value={newPlanningActivity.actualCompletionDate}
                            onChange={(e) => updatePlanningActivityField('actualCompletionDate', e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Time Required</label>
                          <input 
                            type="text"
                            value={newPlanningActivity.timeRequired}
                            onChange={(e) => updatePlanningActivityField('timeRequired', e.target.value)}
                            placeholder="e.g., 5 days"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Actual Time</label>
                          <input 
                            type="text"
                            value={newPlanningActivity.actualTimeRequired}
                            onChange={(e) => updatePlanningActivityField('actualTimeRequired', e.target.value)}
                            placeholder="e.g., 6 days"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={addPlanningActivity}
                          className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
                        >
                          <PlusIcon className="h-4 w-4" />
                          Add Activity
                        </button>
                      </div>
                    </div>

                    {/* Activities List */}
                    {planningActivities.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border border-gray-200 rounded-lg">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">S.No</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">Activity</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">Quantity</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">Start Date</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">End Date</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">Actual Completion</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">Time Required</th>
                              <th className="px-3 py-2 text-left font-semibold text-gray-700">Actual Time</th>
                              <th className="px-3 py-2 text-center font-semibold text-gray-700">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {planningActivities.map((activity, index) => (
                              <tr key={activity.id} className="border-t border-gray-200 hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-900">{activity.serialNumber}</td>
                                <td className="px-3 py-2 text-gray-900 font-medium">{activity.activity}</td>
                                <td className="px-3 py-2 text-gray-900">{activity.quantity || '—'}</td>
                                <td className="px-3 py-2 text-gray-900">{activity.startDate || '—'}</td>
                                <td className="px-3 py-2 text-gray-900">{activity.endDate || '—'}</td>
                                <td className="px-3 py-2 text-gray-900">{activity.actualCompletionDate || '—'}</td>
                                <td className="px-3 py-2 text-gray-900">{activity.timeRequired || '—'}</td>
                                <td className="px-3 py-2 text-gray-900">{activity.actualTimeRequired || '—'}</td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removePlanningActivity(activity.id)}
                                    className="text-red-500 hover:text-red-700 transition-colors"
                                    title="Remove activity"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
                        No activities added yet. Use the form above to add planning activities.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Documentation Tab */}
            {activeTab === 'documentation' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Input Documentation</h2>
                  <p className="text-xs text-gray-600 mt-1">Manage all project-related documents and specifications</p>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Input Documents</label>
                    
                    {/* Add new document input */}
                    <div className="flex gap-2 mb-3">
                      <input 
                        type="text"
                        value={newInputDocument}
                        onChange={(e) => setNewInputDocument(e.target.value)}
                        onKeyPress={handleInputDocumentKeyPress}
                        placeholder="Enter document name (e.g., Technical Specification Rev 3.0)..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                      />
                      <button
                        type="button"
                        onClick={addInputDocument}
                        className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add
                      </button>
                      <label className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-500 cursor-pointer transition-colors flex items-center gap-1">
                        <PlusIcon className="h-4 w-4" />
                        Upload
                        <input type="file" accept="image/*,.svg" onChange={handleInputDocumentFileUpload} className="hidden" />
                      </label>
                    </div>

                    {/* List of added documents */}
                    {inputDocumentsList.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {inputDocumentsList.map((doc) => (
                          <div 
                            key={doc.id} 
                            className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg group hover:bg-blue-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <DocumentIcon className="h-4 w-4 text-blue-600 flex-shrink-0" />
                              {doc.fileUrl ? (
                                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 hover:underline" title="Open document">
                                  {doc.name || doc.text}
                                </a>
                              ) : (
                                <span className="text-sm text-gray-900">{doc.name || doc.text}</span>
                              )}
                              {doc.thumbUrl && (
                                <Image src={doc.thumbUrl} alt={doc.name || 'thumb'} width={32} height={32} className="rounded object-cover border border-blue-200" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500 hidden md:inline">{new Date(doc.addedAt).toLocaleDateString()}</span>
                              <button
                                type="button"
                                onClick={() => removeInputDocument(doc.id)}
                                className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove document"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!inputDocumentsList.length && (
                      <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
                        <DocumentIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p>No documents added yet</p>
                        <p className="text-xs mt-1">Use the input above to add documents to the list</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Meetings & Communications Tab */}
            {activeTab === 'meetings' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-black">Meetings & Communications</h2>
                  <p className="text-xs text-gray-600 mt-1">Kickoff meetings, internal discussions, and follow-ups</p>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Kickoff Meeting</label>
                    <textarea 
                      name="kickoff_meeting" 
                      value={form.kickoff_meeting} 
                      onChange={handleChange} 
                      rows={4} 
                      placeholder="Document kickoff meeting details, attendees, and key decisions..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">In-House Meetings</label>
                    <textarea 
                      name="in_house_meeting" 
                      value={form.in_house_meeting} 
                      onChange={handleChange} 
                      rows={4} 
                      placeholder="Track internal team meetings, discussions, and action items..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" 
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Kickoff Meeting Date</label>
                      <input 
                        type="date" 
                        name="kickoff_meeting_date" 
                        value={form.kickoff_meeting_date} 
                        onChange={handleChange} 
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Follow-up Meeting Date</label>
                      <input 
                        type="date" 
                        name="followup_meeting_date" 
                        value={form.followup_meeting_date} 
                        onChange={handleChange} 
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]" 
                      />
                    </div>
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
