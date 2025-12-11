 'use client';

// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Suspense, useEffect, useMemo, useState, Fragment, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon, PlusIcon, TrashIcon, CheckCircleIcon, ChevronDownIcon, DocumentIcon, XMarkIcon, UserIcon, ClockIcon } from '@heroicons/react/24/outline';
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
  client_name: '',
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
  unit_qty: '',
  project_team: ''
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
  { id: 'project_team_tab', label: 'Project Team' },
  { id: 'input_documents', label: 'Input Documents' },
  { id: 'scope', label: 'Scope' },
  { id: 'software', label: 'Software' },
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

const TYPE_OPTIONS = ['ONGOING', 'CONSULTANCY', 'EPC', 'PMC'];
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
  const [activities, setActivities] = useState([]); // Standalone activities list
  const [subActivities, setSubActivities] = useState([]); // Standalone subactivities list
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
  // Sub-Activity dropdown UI state (per-activity)
  const [openSubActivityDropdowns, setOpenSubActivityDropdowns] = useState({});
  const [subActivitySearch, setSubActivitySearch] = useState({});

  // Collapsible sections for General / Project Details (Basic, Scope, Unit/Qty, Deliverables)
  const [openSections, setOpenSections] = useState({
    basic: true,
    scope: true,
    unitQty: false,
    deliverables: true,
    teamMemberAdd: true,
    currentTeam: true
  });

  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  // Input document list management with categories and full document details
  const [inputDocumentsList, setInputDocumentsList] = useState([]);
  const [newInputDocument, setNewInputDocument] = useState({ 
    sr_no: '',
    date_received: '',
    description: '',
    drawing_number: '',
    revision_number: '',
    unit_qty: '',
    document_sent_by: '',
    remarks: '',
    category: 'lot', 
    lotNumber: '', 
    subLot: '' 
  });
  const [docMaster, setDocMaster] = useState([]);
  
  // Project Team Management
  const [projectTeamMembers, setProjectTeamMembers] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [teamMemberSearch, setTeamMemberSearch] = useState('');
  
  // Software Management
  const [softwareItems, setSoftwareItems] = useState([]);
  const [softwareCategories, setSoftwareCategories] = useState([]);
  const [selectedSoftwareCategory, setSelectedSoftwareCategory] = useState('');
  const [selectedSoftware, setSelectedSoftware] = useState('');
  const [selectedSoftwareVersion, setSelectedSoftwareVersion] = useState('');
  
  // Documentation tab - detailed document management
  const [documentsList, setDocumentsList] = useState([]);

  // Documents Received - structured table rows
  const [documentsReceived, setDocumentsReceived] = useState([]);
  const [newReceivedDoc, setNewReceivedDoc] = useState({
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

  // Project Manhours - structured rows
  const [projectManhours, setProjectManhours] = useState([]);
  const [newManhourRow, setNewManhourRow] = useState({
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
    assumption_description: '',
    reason: '',
    assumption_taken_by: '',
    remark: ''
  });
  const newAssumptionDescRef = useRef(null);

  // Lessons Learnt - structured rows
  const [lessonsLearnt, setLessonsLearnt] = useState([]);
  const [newLesson, setNewLesson] = useState({
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
            project_team: project.project_team || '',
            // Scope & Deliverables fields
            scope_of_work: project.scope_of_work || '',
            input_documents: typeof project.input_documents === 'object' && project.input_documents !== null ? JSON.stringify(project.input_documents) : (project.input_documents || ''),
            deliverables: project.deliverables || '',
            list_of_deliverables: project.list_of_deliverables || '',
            software_included: project.software_included || '',
            duration: project.duration || '',
            mode_of_delivery: project.mode_of_delivery || '',
            revision: project.revision || '',
            site_visit: project.site_visit || '',
            quotation_validity: project.quotation_validity || '',
            exclusion: project.exclusion || '',
            billing_and_payment_terms: project.billing_and_payment_terms || '',
            other_terms_and_conditions: project.other_terms_and_conditions || '',
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

          // Fetch proposal if proposal_id exists to auto-populate common fields
          if (project.proposal_id) {
            try {
              const proposalResult = await fetchJSON(`/api/proposals/${project.proposal_id}`);
              if (proposalResult.success && proposalResult.data) {
                const proposal = proposalResult.data;
                // Map all common fields from proposal to project
                setForm(prev => ({
                  ...prev,
                  // Company/Client information - fetch from proposal
                  company_id: proposal.company_id || prev.company_id,
                  client_name: proposal.client_name || prev.client_name,
                  name: prev.name || proposal.client_name, // Use proposal client_name as project name if not set
                  client_contact_details: proposal.client_contact_details || prev.client_contact_details,
                  
                  // Scope & Deliverables
                  scope_of_work: proposal.scope_of_work || prev.scope_of_work,
                  deliverables: proposal.deliverables || prev.deliverables,
                  input_documents: typeof proposal.input_documents === 'object' && proposal.input_documents !== null ? JSON.stringify(proposal.input_documents) : (proposal.input_documents || prev.input_documents),
                  list_of_deliverables: proposal.list_of_deliverables || prev.list_of_deliverables,
                  
                  // Project specifications
                  software_included: proposal.software_included || prev.software_included,
                  duration: proposal.duration || prev.duration,
                  mode_of_delivery: proposal.mode_of_delivery || prev.mode_of_delivery,
                  revision: proposal.revision || prev.revision,
                  site_visit: proposal.site_visit || prev.site_visit,
                  
                  // Financial terms
                  billing_and_payment_terms: proposal.billing_and_payment_terms || prev.billing_and_payment_terms,
                  payment_terms: proposal.payment_terms || prev.payment_terms,
                  quotation_validity: proposal.quotation_validity || prev.quotation_validity,
                  project_value: proposal.total_amount || proposal.project_value || prev.project_value,
                  currency: proposal.currency || prev.currency,
                  
                  // Terms & Conditions
                  exclusion: proposal.exclusion || prev.exclusion,
                  other_terms_and_conditions: proposal.other_terms_and_conditions || prev.other_terms_and_conditions,
                  
                  // Project details
                  estimated_manhours: proposal.estimated_manhours || proposal.estimated_hours || prev.estimated_manhours,
                  unit_qty: proposal.unit_qty || proposal.unit || prev.unit_qty,
                  description: proposal.description || proposal.project_description || prev.description,
                  notes: proposal.notes || prev.notes
                }));

                // Fetch proposal activities if they exist and project activities are empty
                if (!project.project_activities_list || projectActivities.length === 0) {
                  if (proposal.activities) {
                    try {
                      const proposalActivities = typeof proposal.activities === 'string' 
                        ? JSON.parse(proposal.activities) 
                        : proposal.activities;
                      
                      if (Array.isArray(proposalActivities) && proposalActivities.length > 0) {
                        // Map proposal activities to project activities format
                        const mappedActivities = proposalActivities.map(act => ({
                          id: act.id || Date.now() + Math.random(),
                          type: act.type || 'activity',
                          source: 'proposal',
                          name: act.name || act.activity_name || '',
                          status: act.status || 'NEW',
                          deliverables: act.deliverables || '',
                          manhours: act.manhours || 0,
                          assigned_users: act.assigned_users || [],
                          function_name: act.function_name || 'From Proposal'
                        }));
                        setProjectActivities(mappedActivities);
                      }
                    } catch (err) {
                      console.warn('Failed to parse proposal activities:', err);
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('Failed to fetch proposal:', err);
            }
          }

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

            // Load software items
            if (project.software_items) {
              try {
                const parsed = typeof project.software_items === 'string'
                  ? JSON.parse(project.software_items)
                  : project.software_items;
                setSoftwareItems(Array.isArray(parsed) ? parsed : []);
              } catch {
                setSoftwareItems([]);
              }
            } else {
              setSoftwareItems([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetch Software Master data
  useEffect(() => {
    const fetchSoftwareMaster = async () => {
      try {
        const res = await fetch('/api/software-master');
        const json = await res.json();
        if (json?.success && Array.isArray(json.data)) {
          setSoftwareCategories(json.data);
        }
      } catch (error) {
        console.error('Failed to fetch software master:', error);
      }
    };
    fetchSoftwareMaster();
  }, []);

  // Fetch all employees for team selection
  useEffect(() => {
    const fetchEmployees = async () => {
      setEmployeesLoading(true);
      try {
        const res = await fetch('/api/employees?limit=1000&status=active');
        const json = await res.json();
        if (json?.employees && Array.isArray(json.employees)) {
          setAllEmployees(json.employees);
        }
      } catch (error) {
        console.error('Failed to fetch employees:', error);
      } finally {
        setEmployeesLoading(false);
      }
    };
    fetchEmployees();
  }, []);

  // Load project team members from project data
  useEffect(() => {
    if (form.project_team) {
      try {
        const teamData = typeof form.project_team === 'string' 
          ? JSON.parse(form.project_team) 
          : form.project_team;
        if (Array.isArray(teamData)) {
          setProjectTeamMembers(teamData);
        }
      } catch (error) {
        console.error('Failed to parse project_team:', error);
      }
    }
  }, [form.project_team]);

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

  const autoSave = async () => {
    try {
      setSaving(true);
      
      // Prepare payload - remove empty company_id if client_name is present
      // Also exclude project_id as it's the primary key and should not be updated
      const { project_id, ...formWithoutPk } = form;
      const payload = {
        ...formWithoutPk,
        project_team: JSON.stringify(projectTeamMembers),
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
        project_activity_list: JSON.stringify(projectActivities),
        software_items: JSON.stringify(softwareItems)
      };
      
      // If company_id is empty, remove it from payload to avoid validation errors
      if (!payload.company_id || payload.company_id === '') {
        delete payload.company_id;
      }
      
      console.log('AutoSave - Sending to /api/projects/' + id);
      
      const result = await fetchJSON(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (result.success) {
        setLastSaved(new Date());
        console.log('AutoSave successful');
      } else {
        console.error('Auto-save failed:', result.error || result.message, result.details);
        // Don't show error for autosave failures to avoid interrupting user
      }
    } catch (error) {
      console.error('Auto-save error:', error?.message || error);
      // Check if it's a 401 authentication error
      if (error?.message?.includes('Unauthorized') || error?.message?.includes('401')) {
        console.warn('Session expired - please sign in again');
        // Optionally redirect to signin after a delay
        // setTimeout(() => router.push('/signin'), 3000);
      }
      // Silently fail autosave to avoid interrupting user experience
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

  // Input Document List Management with Categories and Full Details
  const addInputDocument = () => {
    if (newInputDocument.description.trim()) {
      const newDoc = {
        id: Date.now(),
        sr_no: newInputDocument.sr_no || String(inputDocumentsList.length + 1),
        date_received: newInputDocument.date_received || new Date().toISOString().split('T')[0],
        description: newInputDocument.description.trim(),
        drawing_number: newInputDocument.drawing_number || '',
        revision_number: newInputDocument.revision_number || '',
        unit_qty: newInputDocument.unit_qty || '',
        document_sent_by: newInputDocument.document_sent_by || '',
        remarks: newInputDocument.remarks || '',
        category: newInputDocument.category || 'others',
        lotNumber: newInputDocument.lotNumber || '',
        subLot: newInputDocument.subLot || '',
        addedAt: new Date().toISOString()
      };
      const updated = [...inputDocumentsList, newDoc];
      setInputDocumentsList(updated);
      setNewInputDocument({ 
        sr_no: '',
        date_received: '',
        description: '',
        drawing_number: '',
        revision_number: '',
        unit_qty: '',
        document_sent_by: '',
        remarks: '',
        category: 'lot', 
        lotNumber: '', 
        subLot: '' 
      });
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
    if (e.key === 'Enter' && (e.target.name === 'description' || e.target.name === 'drawing_number')) {
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
      } catch {
        // non-fatal
      }
    };
    loadDocMaster();
  }, []);

  // Software Management Functions
  const addSoftwareItem = () => {
    if (!selectedSoftwareCategory || !selectedSoftware || !selectedSoftwareVersion) {
      alert('Please select category, software, and version');
      return;
    }

    const category = softwareCategories.find(c => c.id === selectedSoftwareCategory);
    const software = category?.softwares?.find(s => s.id === selectedSoftware);
    const version = software?.versions?.find(v => v.id === selectedSoftwareVersion);

    if (!category || !software || !version) return;

    // Check if already added
    const exists = softwareItems.some(
      item => item.software_id === selectedSoftware && item.version_id === selectedSoftwareVersion
    );

    if (exists) {
      alert('This software version is already added');
      return;
    }

    const newItem = {
      id: Date.now(),
      category_id: category.id,
      category_name: category.name,
      software_id: software.id,
      software_name: software.name,
      provider: software.provider || '',
      version_id: version.id,
      version_name: version.name,
      release_date: version.release_date || '',
      notes: version.notes || ''
    };

    setSoftwareItems(prev => [...prev, newItem]);
    
    // Reset selections
    setSelectedSoftwareCategory('');
    setSelectedSoftware('');
    setSelectedSoftwareVersion('');
    
    // Trigger autosave
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    const timeout = setTimeout(autoSave, 1000);
    setAutoSaveTimeout(timeout);
  };

  // Project Team Management Functions
  const addTeamMember = (employee) => {
    // Check if already added
    const exists = projectTeamMembers.some(member => member.id === employee.id);
    if (exists) {
      alert('This employee is already in the team');
      return;
    }

    const teamMember = {
      id: employee.id,
      employee_id: employee.employee_id,
      name: `${employee.first_name} ${employee.last_name}`,
      email: employee.email,
      department: employee.department,
      position: employee.position,
      role: 'Team Member' // Default role, can be changed
    };

    setProjectTeamMembers(prev => [...prev, teamMember]);
    
    // Update form data
    setForm(prev => ({
      ...prev,
      project_team: JSON.stringify([...projectTeamMembers, teamMember])
    }));
    
    // Trigger autosave
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    const timeout = setTimeout(autoSave, 1000);
    setAutoSaveTimeout(timeout);
  };

  const removeTeamMember = (memberId) => {
    const updated = projectTeamMembers.filter(member => member.id !== memberId);
    setProjectTeamMembers(updated);
    
    // Update form data
    setForm(prev => ({
      ...prev,
      project_team: JSON.stringify(updated)
    }));
    
    // Trigger autosave
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    const timeout = setTimeout(autoSave, 1000);
    setAutoSaveTimeout(timeout);
  };

  const updateTeamMemberRole = (memberId, newRole) => {
    const updated = projectTeamMembers.map(member => 
      member.id === memberId ? { ...member, role: newRole } : member
    );
    setProjectTeamMembers(updated);
    
    // Update form data
    setForm(prev => ({
      ...prev,
      project_team: JSON.stringify(updated)
    }));
    
    // Trigger autosave
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    const timeout = setTimeout(autoSave, 1000);
    setAutoSaveTimeout(timeout);
  };

  // Get filtered employees for team selection (only show those not already in team)
  const availableEmployees = allEmployees.filter(emp => 
    !projectTeamMembers.some(member => member.id === emp.id) &&
    (teamMemberSearch === '' || 
     `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(teamMemberSearch.toLowerCase()) ||
     emp.employee_id?.toLowerCase().includes(teamMemberSearch.toLowerCase()) ||
     emp.department?.toLowerCase().includes(teamMemberSearch.toLowerCase()))
  );

  // Get project team members for use in other tabs (replaces full employee list)
  // This ensures only assigned team members appear in dropdowns throughout the project
  const getProjectTeamForDropdown = () => {
    return projectTeamMembers.map(member => ({
      id: member.id,
      employee_id: member.employee_id,
      name: member.name,
      first_name: member.name.split(' ')[0],
      last_name: member.name.split(' ').slice(1).join(' '),
      email: member.email,
      department: member.department,
      position: member.position,
      project_role: member.role
    }));
  };

  const removeSoftwareItem = (id) => {
    const updated = softwareItems.filter(item => item.id !== id);
    setSoftwareItems(updated);
    setForm(prev => ({ ...prev, software_items: JSON.stringify(updated) }));
  };

  // Get available software for selected category
  const availableSoftware = selectedSoftwareCategory
    ? softwareCategories.find(c => c.id === selectedSoftwareCategory)?.softwares || []
    : [];

  // Get available versions for selected software
  const availableVersions = selectedSoftware
    ? availableSoftware.find(s => s.id === selectedSoftware)?.versions || []
    : [];

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

  // Documents Received helpers
  const addReceivedDocument = () => {
    // Basic validation: require description
    if (!newReceivedDoc.description || !newReceivedDoc.description.trim()) return;

    // Default date to today if not provided
    const today = new Date().toISOString().slice(0,10);
    const doc = { 
      ...newReceivedDoc, 
      id: Date.now(),
      date_received: newReceivedDoc.date_received || today
    };
    setDocumentsReceived(prev => [...prev, doc]);
    setNewReceivedDoc({ date_received: '', description: '', drawing_number: '', revision_number: '', unit_qty: '', document_sent_by: '', remarks: '' });

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
    const issueDate = newIssuedDoc.issue_date || new Date().toISOString().slice(0,10);
    const doc = { ...newIssuedDoc, id: Date.now(), issue_date: issueDate };
    setDocumentsIssued(prev => [...prev, doc]);
    setNewIssuedDoc({ document_name: '', document_number: '', revision_number: '', issue_date: '', remarks: '' });
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
    const row = { ...newHandoverRow, id: Date.now() };
    setProjectHandover(prev => [...prev, row]);
    setNewHandoverRow({ output_by_accent: '', requirement_accomplished: '', remark: '', hand_over: '' });
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
    const row = { ...newManhourRow, id: Date.now() };
    setProjectManhours(prev => [...prev, row]);
    setNewManhourRow({ month: '', name_of_engineer_designer: '', engineering: '', designer: '', drafting: '', checking: '', coordination: '', site_visit: '', others: '', remarks: '' });
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
    const issuedDate = newQuery.query_issued_date || new Date().toISOString().slice(0,10);
    const row = { ...newQuery, id: Date.now(), query_issued_date: issuedDate };
    setQueryLog(prev => [...prev, row]);
    setNewQuery({ query_description: '', query_issued_date: '', reply_from_client: '', reply_received_date: '', query_updated_by: '', query_resolved: '', remark: '' });
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
    const row = { ...newAssumption, id: Date.now() };
    setAssumptions(prev => [...prev, row]);
    setNewAssumption({ assumption_description: '', reason: '', assumption_taken_by: '', remark: '' });
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
    const row = { ...newLesson, id: Date.now() };
    setLessonsLearnt(prev => [...prev, row]);
    setNewLesson({ what_was_new: '', difficulty_faced: '', what_you_learn: '', areas_of_improvement: '', remark: '' });
    setTimeout(() => newLessonDescRef.current?.focus(), 10);
  };

  const updateLessonRow = (id, field, value) => {
    setLessonsLearnt(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeLessonRow = (id) => {
    setLessonsLearnt(prev => prev.filter(r => r.id !== id));
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
      id: `manual-${Date.now()}`, // Use string ID for manual activities to avoid conflicts
      type: 'manual',
      source: 'manual',
      name,
      status: 'NEW',
      deliverables: '',
      manhours: 0,
      unit_qty: '',
      planned_hours: 0,
      start_time: '',
      end_time: '',
      actual_hours: 0,
      activity_done_by: '',
      status_completed: '',
      remark: '',
      assigned_user: '',
      due_date: '',
      priority: 'MEDIUM',
      assigned_users: [],
      function_name: 'Manual / Other'
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

  // Team Member Management (for activities/manhours tracking)
  const addActivityTeamMember = () => {
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

  const removeActivityTeamMember = (id) => {
    setTeamMembers(teamMembers.filter(member => member.id !== id));
  };

  const updateActivityTeamMember = (id, field, value) => {
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

  // Calculate totals
  const totalManhours = useMemo(() => {
    return teamMembers.reduce((sum, member) => sum + (parseFloat(member.manhours) || 0), 0);
  }, [teamMembers]);

  const totalCost = useMemo(() => {
    return teamMembers.reduce((sum, member) => sum + (parseFloat(member.cost) || 0), 0);
  }, [teamMembers]);

  const handleCancel = () => {
    router.push('/projects');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      alert('Project name is required');
      return;
    }

    setSubmitting(true);
    try {
      // Exclude project_id from payload as it's the primary key
      const { project_id, ...formWithoutPk } = form;
      const payload = {
        ...formWithoutPk,
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
        project_activity_list: JSON.stringify(projectActivities)
      };

      const result = await fetchJSON(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (result.success) {
        console.log('Project updated successfully');
        alert('Project updated successfully!');
        // Stay on edit page instead of redirecting to view page
        // router.push(`/projects/${id}`);
      } else {
        console.error('Update failed:', result.error || result.message);
        alert(result.error || result.message || 'Failed to update project');
      }
    } catch (error) {
      console.error('Project update error:', error);
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
    <div className="min-h-screen flex flex-col overflow-hidden" style={{ background: '#ffffff' }}>
      <Navbar />
      
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute -top-[10%] -right-[5%] w-96 h-96 rounded-full opacity-[0.04]" style={{
          background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
          filter: 'blur(60px)',
          animation: 'orbit-smooth 20s ease-in-out infinite'
        }} />
        <div className="absolute -bottom-[10%] -left-[5%] w-96 h-96 rounded-full opacity-[0.04]" style={{
          background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          filter: 'blur(60px)',
          animation: 'orbit-smooth 25s ease-in-out infinite reverse'
        }} />
      </div>
      
      <div className="flex-1 overflow-hidden relative" style={{ zIndex: 1 }}>
        <div className="h-full overflow-y-auto">
          <form onSubmit={handleSubmit}>
          {/* Premium Header - Full Width Sticky */}
          <header className="px-8 py-5 sticky top-16 z-30" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1.5px solid rgba(139, 92, 246, 0.1)',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
          }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="p-2.5 rounded-xl transition-all duration-300 group"
                    style={{
                      background: 'linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%)',
                      border: '1.5px solid rgba(139, 92, 246, 0.1)',
                      boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.15)';
                      e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateX(0)';
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.04)';
                      e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.1)';
                    }}
                    title="Back to Projects"
                  >
                    <ArrowLeftIcon className="h-5 w-5 transition-transform duration-300 group-hover:-translate-x-0.5" style={{ color: '#8b5cf6' }} />
                  </button>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h1 className="text-2xl font-bold" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
                        Edit Project
                      </h1>
                      {form.name && (
                        <span className="px-3 py-1 text-xs font-bold rounded-lg" style={{
                          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
                          color: '#8b5cf6',
                          border: '1px solid rgba(139, 92, 246, 0.2)'
                        }}>{form.name}</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  {saving && (
                    <span className="text-xs font-semibold flex items-center gap-2 px-3 py-2 rounded-lg" style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.08) 100%)',
                      color: '#3b82f6',
                      border: '1px solid rgba(59, 130, 246, 0.2)'
                    }}>
                      <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </span>
                  )}
                  
                  {lastSaved && !saving && (
                    <span className="text-xs font-semibold flex items-center gap-2 px-3 py-2 rounded-lg" style={{
                      background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(22, 163, 74, 0.08) 100%)',
                      color: '#22c55e',
                      border: '1px solid rgba(34, 197, 94, 0.2)'
                    }}>
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      {new Date(lastSaved).toLocaleTimeString()}
                    </span>
                  )}
                  
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300"
                    style={{
                      background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
                      border: '1.5px solid rgba(100, 116, 139, 0.15)',
                      color: '#475569',
                      boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.04)';
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || saving}
                    className="px-6 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                      letterSpacing: '0.01em'
                    }}
                    onMouseEnter={(e) => !submitting && !saving && (() => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 20px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
                    })()}
                    onMouseLeave={(e) => !submitting && !saving && (() => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                    })()}
                  >
                    {submitting ? 'Saving...' : 'Update Project'}
                  </button>
                </div>
              </div>
            </header>

            {/* Enhanced Tab Navigation - Full Width Sticky */}
            <div className="px-8 sticky z-20" style={{ top: 'calc(4rem + 5.5rem)', paddingTop: '1rem', paddingBottom: '1rem', background: '#ffffff' }}>
              <div className="rounded-2xl overflow-hidden" style={{
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
                backdropFilter: 'blur(20px)',
                border: '1.5px solid rgba(139, 92, 246, 0.1)',
                boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
              }}>
                <div className="flex items-center gap-2 overflow-x-auto p-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className="px-4 py-2.5 text-xs font-semibold rounded-xl transition-all duration-300 whitespace-nowrap relative overflow-hidden group"
                        style={isActive ? {
                          background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                          color: '#ffffff',
                          boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                          letterSpacing: '0.01em'
                        } : {
                          background: 'transparent',
                          color: '#64748b',
                          border: 'none'
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = 'rgba(139, 92, 246, 0.06)';
                            e.currentTarget.style.color = '#8b5cf6';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = '#64748b';
                          }
                        }}
                      >
                        {isActive && (
                          <div className="absolute inset-0" style={{
                            background: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.1), transparent 70%)',
                            animation: 'pulse 2s ease-in-out infinite'
                          }} />
                        )}
                        <span className="relative z-10">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="px-8 pb-8 space-y-6">
            {/* Enhanced Project Details Tab */}
            {(activeTab === 'general' || activeTab === 'project_details') && (
              <div className="space-y-5">
                <section className="rounded-2xl overflow-hidden" style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
                  border: '1.5px solid rgba(139, 92, 246, 0.1)',
                  boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
                }}>
                  <div className="px-6 py-4" style={{
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.03) 0%, rgba(124, 58, 237, 0.02) 100%)',
                    borderBottom: '1.5px solid rgba(139, 92, 246, 0.08)'
                  }}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl" style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
                        border: '1px solid rgba(139, 92, 246, 0.2)'
                      }}>
                        <DocumentIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />
                      </div>
                      <div>
                        <h2 className="text-base font-bold" style={{ color: '#0f172a', letterSpacing: '-0.01em' }}>General Project Information</h2>
                        <p className="text-xs font-medium" style={{ color: '#64748b' }}>Core project details and metadata</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-6 space-y-5">
                    {/* Enhanced Basic Details Section */}
                    <div className="rounded-xl overflow-hidden" style={{
                      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.02) 0%, rgba(255, 255, 255, 0.5) 100%)',
                      border: '1.5px solid rgba(139, 92, 246, 0.1)',
                      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.02)'
                    }}>
                      <button 
                        type="button" 
                        onClick={() => toggleSection('basic')} 
                        className="w-full flex items-center justify-between px-4 py-3 transition-all duration-300 group"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(139, 92, 246, 0.04)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-1.5 rounded-lg transition-all duration-300" style={{
                            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
                            border: '1px solid rgba(139, 92, 246, 0.15)',
                            transform: openSections.basic ? 'rotate(180deg)' : 'rotate(0deg)'
                          }}>
                            <ChevronDownIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />
                          </div>
                          <h3 className="text-sm font-bold" style={{ color: '#0f172a' }}>Basic Details</h3>
                        </div>
                        <span className="text-xs font-bold px-2 py-1 rounded-md" style={{
                          background: openSections.basic ? 'rgba(139, 92, 246, 0.1)' : 'rgba(100, 116, 139, 0.06)',
                          color: openSections.basic ? '#8b5cf6' : '#64748b'
                        }}>
                          {openSections.basic ? 'Collapse' : 'Expand'}
                        </span>
                      </button>
                      
                      {openSections.basic && (
                        <div className="px-4 pb-4 pt-3 space-y-6" style={{
                          borderTop: '1.5px solid rgba(139, 92, 246, 0.08)'
                        }}>
                          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
                            <div className="space-y-2">
                              <label className="block text-xs font-bold" style={{ color: '#475569', letterSpacing: '0.01em' }}>
                                Project Number <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input 
                                type="text" 
                                name="project_id" 
                                value={form.project_id} 
                                onChange={handleChange} 
                                placeholder="Enter project number"
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300" 
                                style={{
                                  background: 'rgba(255, 255, 255, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#0f172a',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = '#8b5cf6';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1), 0 4px 8px rgba(15, 23, 42, 0.04)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.02)';
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-xs font-bold" style={{ color: '#475569', letterSpacing: '0.01em' }}>
                                Project Name <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input 
                                type="text" 
                                name="name" 
                                value={form.name} 
                                onChange={handleChange} 
                                placeholder="Enter project name"
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300" 
                                style={{
                                  background: 'rgba(255, 255, 255, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#0f172a',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = '#8b5cf6';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1), 0 4px 8px rgba(15, 23, 42, 0.04)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.02)';
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-xs font-bold" style={{ color: '#475569', letterSpacing: '0.01em' }}>
                                Company <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input 
                                type="text" 
                                name="client_name" 
                                value={form.client_name} 
                                onChange={handleChange} 
                                placeholder="Company name"
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300" 
                                style={{
                                  background: 'rgba(255, 255, 255, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#0f172a',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = '#8b5cf6';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1), 0 4px 8px rgba(15, 23, 42, 0.04)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.02)';
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-xs font-bold" style={{ color: '#475569', letterSpacing: '0.01em' }}>
                                Project Start Date
                              </label>
                              <input 
                                type="date" 
                                name="start_date" 
                                value={form.start_date} 
                                onChange={handleChange} 
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300" 
                                style={{
                                  background: 'rgba(255, 255, 255, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#0f172a',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = '#8b5cf6';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1), 0 4px 8px rgba(15, 23, 42, 0.04)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.02)';
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-xs font-bold" style={{ color: '#475569', letterSpacing: '0.01em' }}>
                                Project End Date
                              </label>
                              <input 
                                type="date" 
                                name="end_date" 
                                value={form.end_date} 
                                onChange={handleChange} 
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300" 
                                style={{
                                  background: 'rgba(255, 255, 255, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#0f172a',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
                                }}
                                onFocus={(e) => {
                                  e.target.style.borderColor = '#8b5cf6';
                                  e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1), 0 4px 8px rgba(15, 23, 42, 0.04)';
                                }}
                                onBlur={(e) => {
                                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.02)';
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-xs font-bold" style={{ color: '#475569', letterSpacing: '0.01em' }}>
                                Project Type
                              </label>
                              <select 
                                name="contract_type" 
                                value={form.contract_type} 
                                onChange={handleChange} 
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent transition-all bg-white hover:border-gray-400"
                              >
                                <option value="">Select Type</option>
                                {TYPE_OPTIONS.map((type) => (
                                  <option key={type} value={type}>{type}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="block text-sm font-semibold text-gray-700">Estimated Manhours</label>
                              <input 
                                type="number" 
                                name="estimated_manhours" 
                                value={form.estimated_manhours} 
                                onChange={handleChange} 
                                step="0.1" 
                                placeholder="0.0"
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent transition-all bg-white hover:border-gray-400" 
                              />
                            </div>
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

                    {/* Enhanced Scope Section */}
                    <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                      <button type="button" onClick={() => toggleSection('scope')} className="w-full flex items-center justify-between group hover:bg-white/50 rounded-md px-2 py-1.5 transition-colors">
                        <div className="flex items-center gap-2">
                          <ChevronDownIcon className={`h-3.5 w-3.5 text-purple-600 transition-transform ${openSections.scope ? 'rotate-180' : ''}`} />
                          <h3 className="text-sm font-semibold text-gray-700">Project Scope</h3>
                        </div>
                        <span className="text-xs text-purple-600">{openSections.scope ? '−' : '+'}</span>
                      </button>
                      
                      {openSections.scope && (
                        <div className="mt-4 space-y-4 pt-3 border-t border-purple-100">
                          <div className="space-y-3">
                            <label className="block text-sm font-semibold text-gray-700">Project Description & Scope</label>
                            <textarea 
                              name="description" 
                              value={form.description} 
                              onChange={handleChange} 
                              rows={6} 
                              placeholder="Describe the project scope, objectives, and key deliverables..."
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent transition-all bg-white hover:border-gray-400 resize-y min-h-[120px]" 
                            />
                          </div>
                          
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="block text-sm font-semibold text-gray-700">Input Documents</label>
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{inputDocumentsList.length} documents</span>
                            </div>
                            
                            <div className="flex gap-3 p-4 bg-white rounded-lg border border-gray-200">
                              <input 
                                type="text" 
                                value={newInputDocument} 
                                onChange={(e) => setNewInputDocument(e.target.value)} 
                                onKeyPress={handleInputDocumentKeyPress} 
                                placeholder="Enter document name or description" 
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent transition-all hover:border-gray-400" 
                              />
                              <button 
                                type="button" 
                                onClick={addInputDocument} 
                                className="px-6 py-3 bg-[#7F2487] text-white font-semibold rounded-lg hover:bg-[#6a1e73] transition-all focus:ring-2 focus:ring-[#7F2487] focus:ring-offset-2"
                              >
                                <PlusIcon className="h-4 w-4 mr-1 inline" />
                                Add
                              </button>
                            </div>
                            
                            {/* Suggestions from Document Master */}
                            {docMaster && docMaster.length > 0 && newInputDocument && (
                              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <p className="text-xs font-medium text-gray-600 mb-2">Suggested Documents:</p>
                                <div className="flex flex-wrap gap-2">
                                  {docMaster
                                    .filter(d => !newInputDocument || (d.name?.toLowerCase().includes(newInputDocument.toLowerCase()) || d.doc_key?.toLowerCase().includes(newInputDocument.toLowerCase())))
                                    .slice(0, 6)
                                    .map((d) => (
                                      <button
                                        key={d.id}
                                        type="button"
                                        onClick={() => {
                                          setNewInputDocument(d.name);
                                          addInputDocument();
                                        }}
                                        className="px-3 py-1 text-xs rounded-full bg-purple-50 hover:bg-purple-100 text-[#7F2487] border border-purple-200 transition-colors"
                                        title={d.description || ''}
                                      >
                                        {d.name}
                                      </button>
                                    ))}
                                </div>
                              </div>
                            )}
                            
                            {inputDocumentsList.length > 0 && (
                              <div className="space-y-3">
                                <h4 className="text-sm font-semibold text-gray-700">Added Documents</h4>
                                <div className="grid gap-3">
                                  {inputDocumentsList.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:border-purple-300 transition-colors group">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                                          <DocumentIcon className="h-4 w-4 text-purple-600" />
                                        </div>
                                        <div>
                                          <p className="font-medium text-gray-900">{doc.text}</p>
                                          {doc.addedAt && (
                                            <p className="text-xs text-gray-500 mt-1">
                                              Added {new Date(doc.addedAt).toLocaleString()}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <button 
                                        type="button" 
                                        onClick={() => removeInputDocument(doc.id)} 
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Remove document"
                                      >
                                        <XMarkIcon className="h-4 w-4" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Unit / Qty (collapsible) */}
                    <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                      <button type="button" onClick={() => toggleSection('unitQty')} className="w-full flex items-center justify-between group hover:bg-white/50 rounded-md px-2 py-1.5 transition-colors">
                        <div className="flex items-center gap-2">
                          <ChevronDownIcon className={`h-3.5 w-3.5 text-purple-600 transition-transform ${openSections.unitQty ? 'rotate-180' : ''}`} />
                          <h3 className="text-sm font-semibold text-gray-700">Unit / Qty</h3>
                        </div>
                        <span className="text-xs text-purple-600">{openSections.unitQty ? '−' : '+'}</span>
                      </button>
                      {openSections.unitQty && (
                        <div className="mt-4 space-y-4 pt-3 border-t border-purple-100">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1">Unit / Qty</label>
                              <input type="text" name="unit_qty" value={form.unit_qty} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1">Duration Planned (days)</label>
                              <input type="number" name="project_duration_planned" value={form.project_duration_planned} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1">Duration Actual (days)</label>
                              <input type="number" name="project_duration_actual" value={form.project_duration_actual} onChange={handleChange} step="0.01" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Enhanced Deliverables Section */}
                    <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                      <button type="button" onClick={() => toggleSection('deliverables')} className="w-full flex items-center justify-between group hover:bg-white/50 rounded-md px-2 py-1.5 transition-colors">
                        <div className="flex items-center gap-2">
                          <ChevronDownIcon className={`h-3.5 w-3.5 text-purple-600 transition-transform ${openSections.deliverables ? 'rotate-180' : ''}`} />
                          <h3 className="text-sm font-semibold text-gray-700">Project Deliverables</h3>
                        </div>
                        <span className="text-xs text-purple-600">{openSections.deliverables ? '−' : '+'}</span>
                      </button>
                      
                      {openSections.deliverables && (
                        <div className="mt-4 space-y-4 pt-3 border-t border-purple-100">
                          <div className="space-y-3">
                            <label className="block text-sm font-semibold text-gray-700">List of Deliverables</label>
                            <textarea 
              name="list_of_deliverables" 
                              value={form.list_of_deliverables} 
                              onChange={handleChange} 
                              rows={4} 
                              placeholder="List the key deliverables for this project..."
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent transition-all bg-white hover:border-gray-400 resize-y" 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Enhanced Input Documents Tab */}
            {activeTab === 'input_documents' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
                    <h2 className="text-sm font-bold text-gray-900">Input Documents</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Manage project input documents and references</p>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {/* Compact Add Document Form */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                      Add New Document
                    </h4>
                    <div className="space-y-2">
                      {/* Row 1: Category, Lot/Sublot, Date, Description, Drawing No., Revision */}
                      <div className="grid grid-cols-8 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                          <select
                            value={newInputDocument.category}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, category: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                          >
                            <option value="lot">Lot</option>
                            <option value="sublot">Sub-lot</option>
                            <option value="date">Date</option>
                            <option value="others">Others</option>
                          </select>
                        </div>
                        {newInputDocument.category === 'lot' && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Lot Number</label>
                            <input
                              type="text"
                              value={newInputDocument.lotNumber}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, lotNumber: e.target.value }))}
                              placeholder="LOT-001"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </div>
                        )}
                        {newInputDocument.category === 'sublot' && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Sub-lot</label>
                            <input
                              type="text"
                              value={newInputDocument.subLot}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, subLot: e.target.value }))}
                              placeholder="SL-001"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                          <input
                            type="date"
                            value={newInputDocument.date_received}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, date_received: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
                          <input
                            type="text"
                            value={newInputDocument.description}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, description: e.target.value }))}
                            onKeyPress={handleInputDocumentKeyPress}
                            placeholder="Document description"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Drawing No.</label>
                          <input
                            type="text"
                            value={newInputDocument.drawing_number}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, drawing_number: e.target.value }))}
                            placeholder="DWG-XXX"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Revision</label>
                          <input
                            type="text"
                            value={newInputDocument.revision_number}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, revision_number: e.target.value }))}
                            placeholder="Rev-A"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                      </div>
                      
                      {/* Row 2: Unit/Qty, Sent by, Remarks, Add Button */}
                      <div className="grid grid-cols-8 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Unit/Qty</label>
                          <input
                            type="text"
                            value={newInputDocument.unit_qty}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, unit_qty: e.target.value }))}
                            placeholder="10 pcs"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Document Sent by</label>
                          <input
                            type="text"
                            value={newInputDocument.document_sent_by}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, document_sent_by: e.target.value }))}
                            placeholder="Sender name"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                          <input
                            type="text"
                            value={newInputDocument.remarks}
                            onChange={(e) => setNewInputDocument(prev => ({ ...prev, remarks: e.target.value }))}
                            placeholder="Additional notes"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={addInputDocument}
                            disabled={!newInputDocument.description.trim()}
                            className="w-full px-3 py-1.5 bg-[#7F2487] text-white text-sm font-semibold rounded hover:bg-[#6a1e73] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                          >
                            <PlusIcon className="h-3.5 w-3.5" />
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Documents Table */}
                  {inputDocumentsList.length > 0 ? (
                    <div className="space-y-6">
                      {/* Lot Documents */}
                      {(() => {
                        const lotDocs = inputDocumentsList.filter(doc => doc.category === 'lot');
                        if (lotDocs.length === 0) return null;
                        
                        // Group by lot number
                        const groupedByLot = lotDocs.reduce((acc, doc) => {
                          const key = doc.lotNumber || 'Unspecified';
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(doc);
                          return acc;
                        }, {});
                        
                        return (
                          <div className="border border-blue-200 rounded-lg overflow-hidden">
                            <div className="bg-blue-50 px-4 py-2 border-b border-blue-200">
                              <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2">
                                <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded">LOT</span>
                                Lot Documents ({lotDocs.length})
                              </h3>
                            </div>
                            <div className="divide-y divide-blue-100">
                              {Object.entries(groupedByLot).map(([lotNum, docs]) => (
                                <div key={lotNum} className="bg-white">
                                  <div className="px-4 py-2 bg-blue-25">
                                    <p className="text-xs font-semibold text-blue-800">Lot Number: {lotNum}</p>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Sr. No</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Date Received</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Description</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Drawing No.</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Revision</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Unit/Qty</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Sent By</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Remarks</th>
                                          <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {docs.map((doc) => (
                                          <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-3 py-2 text-gray-900">{doc.sr_no || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.date_received || '-'}</td>
                                            <td className="px-3 py-2 text-gray-900 font-medium">{doc.description}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.drawing_number || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.revision_number || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.unit_qty || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.document_sent_by || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.remarks || '-'}</td>
                                            <td className="px-3 py-2 text-center">
                                              <button
                                                type="button"
                                                onClick={() => removeInputDocument(doc.id)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                                title="Remove document"
                                              >
                                                <XMarkIcon className="h-4 w-4" />
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Sub-lot Documents */}
                      {(() => {
                        const sublotDocs = inputDocumentsList.filter(doc => doc.category === 'sublot');
                        if (sublotDocs.length === 0) return null;
                        
                        // Group by sub-lot
                        const groupedBySubLot = sublotDocs.reduce((acc, doc) => {
                          const key = doc.subLot || 'Unspecified';
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(doc);
                          return acc;
                        }, {});
                        
                        return (
                          <div className="border border-purple-200 rounded-lg overflow-hidden">
                            <div className="bg-purple-50 px-4 py-2 border-b border-purple-200">
                              <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                                <span className="bg-[#7F2487] text-white text-xs px-2 py-0.5 rounded">SUB-LOT</span>
                                Sub-lot Documents ({sublotDocs.length})
                              </h3>
                            </div>
                            <div className="divide-y divide-purple-100">
                              {Object.entries(groupedBySubLot).map(([subLotId, docs]) => (
                                <div key={subLotId} className="bg-white">
                                  <div className="px-4 py-2 bg-purple-25">
                                    <p className="text-xs font-semibold text-purple-800">Sub-lot: {subLotId}</p>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Sr. No</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Date Received</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Description</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Drawing No.</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Revision</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Unit/Qty</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Sent By</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Remarks</th>
                                          <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {docs.map((doc) => (
                                          <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-3 py-2 text-gray-900">{doc.sr_no || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.date_received || '-'}</td>
                                            <td className="px-3 py-2 text-gray-900 font-medium">{doc.description}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.drawing_number || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.revision_number || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.unit_qty || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.document_sent_by || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.remarks || '-'}</td>
                                            <td className="px-3 py-2 text-center">
                                              <button
                                                type="button"
                                                onClick={() => removeInputDocument(doc.id)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                                title="Remove document"
                                              >
                                                <XMarkIcon className="h-4 w-4" />
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Date Documents */}
                      {(() => {
                        const dateDocs = inputDocumentsList.filter(doc => doc.category === 'date');
                        if (dateDocs.length === 0) return null;
                        
                        // Group by date_received
                        const groupedByDate = dateDocs.reduce((acc, doc) => {
                          const key = doc.date_received || 'No Date';
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(doc);
                          return acc;
                        }, {});
                        
                        return (
                          <div className="border border-green-200 rounded-lg overflow-hidden">
                            <div className="bg-green-50 px-4 py-2 border-b border-green-200">
                              <h3 className="text-sm font-bold text-green-900 flex items-center gap-2">
                                <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded">DATE</span>
                                Date-Grouped Documents ({dateDocs.length})
                              </h3>
                            </div>
                            <div className="divide-y divide-green-100">
                              {Object.entries(groupedByDate).sort(([a], [b]) => b.localeCompare(a)).map(([date, docs]) => (
                                <div key={date} className="bg-white">
                                  <div className="px-4 py-2 bg-green-25">
                                    <p className="text-xs font-semibold text-green-800">Date: {date}</p>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Sr. No</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Description</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Drawing No.</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Revision</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Unit/Qty</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Sent By</th>
                                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Remarks</th>
                                          <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {docs.map((doc, index) => (
                                          <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-3 py-2 text-gray-900">{index + 1}</td>
                                            <td className="px-3 py-2 text-gray-900 font-medium">{doc.description}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.drawing_number || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.revision_number || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.unit_qty || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.document_sent_by || '-'}</td>
                                            <td className="px-3 py-2 text-gray-600">{doc.remarks || '-'}</td>
                                            <td className="px-3 py-2 text-center">
                                              <button
                                                type="button"
                                                onClick={() => removeInputDocument(doc.id)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                                title="Remove document"
                                              >
                                                <XMarkIcon className="h-4 w-4" />
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Others Documents */}
                      {(() => {
                        const otherDocs = inputDocumentsList.filter(doc => doc.category === 'others');
                        if (otherDocs.length === 0) return null;
                        
                        return (
                          <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                <span className="bg-gray-500 text-white text-xs px-2 py-0.5 rounded">OTHERS</span>
                                Other Documents ({otherDocs.length})
                              </h3>
                            </div>
                            <div className="bg-white overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Sr. No</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Date Received</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Description</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Drawing No.</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Revision</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Unit/Qty</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Sent By</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Remarks</th>
                                    <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {otherDocs.map((doc, index) => (
                                    <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                                      <td className="px-3 py-2 text-gray-900">{index + 1}</td>
                                      <td className="px-3 py-2 text-gray-600">{doc.date_received || '-'}</td>
                                      <td className="px-3 py-2 text-gray-900 font-medium">{doc.description}</td>
                                      <td className="px-3 py-2 text-gray-600">{doc.drawing_number || '-'}</td>
                                      <td className="px-3 py-2 text-gray-600">{doc.revision_number || '-'}</td>
                                      <td className="px-3 py-2 text-gray-600">{doc.unit_qty || '-'}</td>
                                      <td className="px-3 py-2 text-gray-600">{doc.document_sent_by || '-'}</td>
                                      <td className="px-3 py-2 text-gray-600">{doc.remarks || '-'}</td>
                                      <td className="px-3 py-2 text-center">
                                        <button
                                          type="button"
                                          onClick={() => removeInputDocument(doc.id)}
                                          className="text-red-500 hover:text-red-700 p-1"
                                          title="Remove document"
                                        >
                                          <XMarkIcon className="h-4 w-4" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <DocumentIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                      <p className="text-sm font-medium">No documents added yet</p>
                      <p className="text-xs mt-1">Add documents using the form above</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Software Tab */}
            {activeTab === 'software' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Project Software</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Manage software and tools used in this project</p>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {/* Add Software Form */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                      Add Software
                    </h4>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
                          <select
                            value={selectedSoftwareCategory}
                            onChange={(e) => {
                              setSelectedSoftwareCategory(e.target.value);
                              setSelectedSoftware('');
                              setSelectedSoftwareVersion('');
                            }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                          >
                            <option value="">Select Category</option>
                            {softwareCategories.map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Software *</label>
                          <select
                            value={selectedSoftware}
                            onChange={(e) => {
                              setSelectedSoftware(e.target.value);
                              setSelectedSoftwareVersion('');
                            }}
                            disabled={!selectedSoftwareCategory}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                          >
                            <option value="">Select Software</option>
                            {availableSoftware.map((sw) => (
                              <option key={sw.id} value={sw.id}>{sw.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Version *</label>
                          <select
                            value={selectedSoftwareVersion}
                            onChange={(e) => setSelectedSoftwareVersion(e.target.value)}
                            disabled={!selectedSoftware}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                          >
                            <option value="">Select Version</option>
                            {availableVersions.map((ver) => (
                              <option key={ver.id} value={ver.id}>{ver.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={addSoftwareItem}
                          disabled={!selectedSoftwareCategory || !selectedSoftware || !selectedSoftwareVersion}
                          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                            selectedSoftwareCategory && selectedSoftware && selectedSoftwareVersion
                              ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                          Add Software
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Software List */}
                  {softwareItems.length > 0 ? (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Category</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Software</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Provider</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Version</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Release Date</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Notes</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {softwareItems.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2 text-gray-900 font-medium">{item.category_name}</td>
                              <td className="px-3 py-2 text-gray-900 font-medium">{item.software_name}</td>
                              <td className="px-3 py-2 text-gray-600">{item.provider || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{item.version_name}</td>
                              <td className="px-3 py-2 text-gray-600">{item.release_date || '-'}</td>
                              <td className="px-3 py-2 text-gray-600">{item.notes || '-'}</td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeSoftwareItem(item.id)}
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove software"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <svg className="h-12 w-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                      <p className="text-sm font-medium">No software added yet</p>
                      <p className="text-xs mt-1">Select category, software, and version to add to the project</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Project Team Tab */}
            {activeTab === 'project_team_tab' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4 text-[#7F2487]" />
                    <h2 className="text-sm font-bold text-gray-900">Project Team</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Select team members from employee master for this project</p>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {/* Add Team Member Section - Collapsible */}
                  <div className="border border-purple-100 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSection('teamMemberAdd')}
                      className="w-full bg-gradient-to-br from-purple-25 via-white to-purple-25 px-4 py-3 flex items-center justify-between hover:bg-purple-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                        <h4 className="text-sm font-semibold text-gray-700">Add Team Member</h4>
                      </div>
                      <ChevronDownIcon 
                        className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${openSections.teamMemberAdd ? 'transform rotate-180' : ''}`} 
                      />
                    </button>
                    
                    {openSections.teamMemberAdd && (
                      <div className="p-4 border-t border-purple-100">
                        {/* Search Box */}
                        <div className="mb-3">
                          <input
                            type="text"
                            value={teamMemberSearch}
                            onChange={(e) => setTeamMemberSearch(e.target.value)}
                            placeholder="Search employees by name, employee ID, or department..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent text-sm"
                          />
                        </div>

                        {/* Available Employees List */}
                        {employeesLoading ? (
                          <div className="text-center py-8 text-gray-500">
                            <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                            <p className="text-sm">Loading employees...</p>
                          </div>
                        ) : availableEmployees.length > 0 ? (
                          <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Employee ID</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Department</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Position</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {availableEmployees.map((emp) => (
                                  <tr key={emp.id} className="hover:bg-purple-50 transition-colors">
                                    <td className="px-3 py-2 text-gray-900 font-mono text-xs">{emp.employee_id || '-'}</td>
                                    <td className="px-3 py-2 text-gray-900 font-medium">{emp.first_name} {emp.last_name}</td>
                                    <td className="px-3 py-2 text-gray-600">{emp.department || '-'}</td>
                                    <td className="px-3 py-2 text-gray-600">{emp.position || '-'}</td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => addTeamMember(emp)}
                                        className="px-3 py-1 bg-[#7F2487] text-white rounded-md text-xs font-medium hover:bg-[#6a1e73] transition-colors"
                                      >
                                        Add
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-gray-500">
                            <UserIcon className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                            <p className="text-sm">
                              {teamMemberSearch ? 'No employees found matching your search' : 'All employees have been added to the team'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Current Team Members - Collapsible */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSection('currentTeam')}
                      className="w-full bg-gray-50 px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4 text-[#7F2487]" />
                        <h4 className="text-sm font-semibold text-gray-700">
                          Current Team Members ({projectTeamMembers.length})
                        </h4>
                      </div>
                      <ChevronDownIcon 
                        className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${openSections.currentTeam ? 'transform rotate-180' : ''}`} 
                      />
                    </button>
                    
                    {openSections.currentTeam && (
                      <div>
                        {projectTeamMembers.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">#</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Employee ID</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Email</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Department</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Position</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Project Role</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {projectTeamMembers.map((member, index) => (
                                  <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-2 text-gray-600">{index + 1}</td>
                                    <td className="px-3 py-2 text-gray-900 font-mono text-xs">{member.employee_id}</td>
                                    <td className="px-3 py-2 text-gray-900 font-medium">{member.name}</td>
                                    <td className="px-3 py-2 text-gray-600 text-xs">{member.email}</td>
                                    <td className="px-3 py-2 text-gray-600">{member.department || '-'}</td>
                                    <td className="px-3 py-2 text-gray-600">{member.position || '-'}</td>
                                    <td className="px-3 py-2">
                                      <select
                                        value={member.role}
                                        onChange={(e) => updateTeamMemberRole(member.id, e.target.value)}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                                      >
                                        <option value="Team Member">Team Member</option>
                                        <option value="Project Lead">Project Lead</option>
                                        <option value="Designer">Designer</option>
                                        <option value="Engineer">Engineer</option>
                                        <option value="Drafter">Drafter</option>
                                        <option value="Coordinator">Coordinator</option>
                                        <option value="QA/QC">QA/QC</option>
                                        <option value="Site Supervisor">Site Supervisor</option>
                                      </select>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => removeTeamMember(member.id)}
                                        className="text-red-500 hover:text-red-700 p-1"
                                        title="Remove from team"
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
                          <div className="text-center py-12 text-gray-500">
                            <UserIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                            <p className="text-sm font-medium">No team members added yet</p>
                            <p className="text-xs mt-1">Add team members from the employee list above</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Team Summary */}
                  {projectTeamMembers.length > 0 && (
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-100">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700">Team Summary</h4>
                          <p className="text-xs text-gray-600 mt-0.5">Total members assigned to this project</p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-[#7F2487]">{projectTeamMembers.length}</div>
                          <div className="text-xs text-gray-600">Team Members</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Enhanced Meetings Tab: Kickoff + Internal Meetings */}
            {activeTab === 'minutes_internal_meet' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Project Meetings</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Kickoff meeting and Internal project meetings</p>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {/* Kickoff Meeting Form */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                      Project Kickoff Meeting
                    </h4>
                    <div className="space-y-2">
                      {/* Row 1: Meeting Number, Client Name, Date, Organizer, Minutes Drafted, Location, Client Rep, Title */}
                      <div className="grid grid-cols-8 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Meeting No</label>
                          <input 
                            type="text" 
                            name="kickoff_meeting_no" 
                            value={form.kickoff_meeting_no} 
                            onChange={handleChange} 
                            placeholder="KOM-001"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Client Name</label>
                          <input 
                            type="text" 
                            name="kickoff_client_name" 
                            value={form.kickoff_client_name} 
                            onChange={handleChange} 
                            placeholder="Client"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                          <input 
                            type="date" 
                            name="kickoff_meeting_date" 
                            value={form.kickoff_meeting_date} 
                            onChange={handleChange} 
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Organizer</label>
                          <input 
                            type="text" 
                            name="kickoff_meeting_organizer" 
                            value={form.kickoff_meeting_organizer} 
                            onChange={handleChange} 
                            placeholder="Organizer"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Minutes By</label>
                          <input 
                            type="text" 
                            name="kickoff_minutes_drafted" 
                            value={form.kickoff_minutes_drafted} 
                            onChange={handleChange} 
                            placeholder="Drafter"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                          <input 
                            type="text" 
                            name="kickoff_meeting_location" 
                            value={form.kickoff_meeting_location} 
                            onChange={handleChange} 
                            placeholder="Venue"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Client Rep</label>
                          <input 
                            type="text" 
                            name="kickoff_client_representative" 
                            value={form.kickoff_client_representative} 
                            onChange={handleChange} 
                            placeholder="Rep"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                          <input 
                            type="text" 
                            name="kickoff_meeting_title" 
                            value={form.kickoff_meeting_title} 
                            onChange={handleChange} 
                            placeholder="Meeting title"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                          />
                        </div>
                      </div>
                      
                      {/* Row 2: Points Discussed, Participants */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Points Discussed</label>
                          <textarea 
                            name="kickoff_points_discussed" 
                            value={form.kickoff_points_discussed} 
                            onChange={handleChange} 
                            rows={2} 
                            placeholder="Agenda and points discussed..."
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] resize-y" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Participants</label>
                          <textarea 
                            name="kickoff_persons_involved" 
                            value={form.kickoff_persons_involved} 
                            onChange={handleChange} 
                            rows={2} 
                            placeholder="Comma-separated list"
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] resize-y" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Internal Meetings Section */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                        Internal Project Meetings
                      </h4>
                      <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          placeholder="Meeting title" 
                          value={newInternalMeetingTitle} 
                          onChange={(e) => setNewInternalMeetingTitle(e.target.value)} 
                          className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                        />
                        <button 
                          type="button" 
                          onClick={addInternalMeeting} 
                          className="px-3 py-1.5 bg-[#7F2487] text-white text-sm font-semibold rounded hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">No</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Date</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Title</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Organizer</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Client Rep</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Location</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Points</th>
                            <th className="text-left py-2 px-2 font-semibold text-gray-700">Participants</th>
                            <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {internalMeetings.length === 0 ? (
                            <tr><td colSpan={9} className="text-center py-4 text-gray-500 text-sm">No internal meetings added</td></tr>
                          ) : (
                            internalMeetings.map((m) => (
                              <tr key={m.id} className="hover:bg-gray-50 transition-colors align-top">
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_no || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'meeting_no', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="date" 
                                    value={m.meeting_date || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'meeting_date', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_title || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'meeting_title', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.organizer || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'organizer', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.client_representative || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'client_representative', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_location || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'meeting_location', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.points_discussed || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'points_discussed', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.persons_involved || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'persons_involved', e.target.value)} 
                                    placeholder="Comma-separated" 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <button 
                                    type="button" 
                                    onClick={() => removeInternalMeeting(m.id)} 
                                    className="text-red-500 hover:text-red-700 p-1"
                                    title="Remove meeting"
                                  >
                                    <XMarkIcon className="h-4 w-4" />
                                  </button>
                                </td>
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Output by Accent *</label>
                        <input 
                          ref={newHandoverDescRef}
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addHandoverRow(); } }}
                          type="text" 
                          value={newHandoverRow.output_by_accent} 
                          onChange={(e)=>setNewHandoverRow(prev=>({...prev,output_by_accent:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Requirement Accomplished</label>
                        <select 
                          value={newHandoverRow.requirement_accomplished} 
                          onChange={(e)=>setNewHandoverRow(prev=>({...prev,requirement_accomplished:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                        >
                          <option value="">Select</option>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Hand Over</label>
                        <select 
                          value={newHandoverRow.hand_over} 
                          onChange={(e)=>setNewHandoverRow(prev=>({...prev,hand_over:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                        >
                          <option value="">Select</option>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Remark</label>
                      <input 
                        type="text" 
                        value={newHandoverRow.remark} 
                        onChange={(e)=>setNewHandoverRow(prev=>({...prev,remark:e.target.value}))} 
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={addHandoverRow} 
                      disabled={!(newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim() ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add Handover Item
                    </button>
                  </div>

                  {projectHandover.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Output by Accent</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Requirement Accomplished</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remark</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Hand Over</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {projectHandover.map(r => (
                            <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3"><input type="text" value={r.output_by_accent || ''} onChange={(e)=>updateHandoverRow(r.id,'output_by_accent', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><select value={r.requirement_accomplished || ''} onChange={(e)=>updateHandoverRow(r.id,'requirement_accomplished', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                              <td className="py-2 px-3"><input type="text" value={r.remark || ''} onChange={(e)=>updateHandoverRow(r.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><select value={r.hand_over || ''} onChange={(e)=>updateHandoverRow(r.id,'hand_over', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={()=>removeHandoverRow(r.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove item"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-11 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
                        <input 
                          type="month" 
                          value={newManhourRow.month} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,month:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Name of Engineer/Designer</label>
                        <input 
                          ref={newManhourNameRef} 
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addManhourRow(); } }} 
                          type="text" 
                          placeholder="Enter name..." 
                          value={newManhourRow.name_of_engineer_designer} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,name_of_engineer_designer:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                        <p className="text-xs text-gray-400 mt-1">Press Enter to add quickly</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Engineering</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.engineering} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,engineering:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Designer</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.designer} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,designer:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Drafting</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.drafting} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,drafting:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Checking</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.checking} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,checking:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Co-ordation</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.coordination} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,coordination:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Site Visit</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.site_visit} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,site_visit:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Others</label>
                        <input 
                          type="number" 
                          placeholder="Hours" 
                          value={newManhourRow.others} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,others:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div className="md:col-span-11">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                        <input 
                          type="text" 
                          placeholder="Additional remarks..." 
                          value={newManhourRow.remarks} 
                          onChange={(e)=>setNewManhourRow(prev=>({...prev,remarks:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <button 
                      type="button" 
                      onClick={addManhourRow} 
                      disabled={!(newManhourRow.name_of_engineer_designer && newManhourRow.name_of_engineer_designer.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                        newManhourRow.name_of_engineer_designer && newManhourRow.name_of_engineer_designer.trim() 
                          ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' 
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add Row
                    </button>
                  </div>

                  {projectManhours.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Month</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Name of Engineer/Designer</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Engineering</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Designer</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Drafting</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Checking</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Co-ordation</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Site Visit</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Others</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remarks</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Remove</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {projectManhours.map(r => (
                            <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3"><input type="month" value={r.month || ''} onChange={(e)=>updateManhourRow(r.id,'month', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="text" value={r.name_of_engineer_designer || ''} onChange={(e)=>updateManhourRow(r.id,'name_of_engineer_designer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.engineering || ''} onChange={(e)=>updateManhourRow(r.id,'engineering', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.designer || ''} onChange={(e)=>updateManhourRow(r.id,'designer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.drafting || ''} onChange={(e)=>updateManhourRow(r.id,'drafting', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.checking || ''} onChange={(e)=>updateManhourRow(r.id,'checking', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.coordination || ''} onChange={(e)=>updateManhourRow(r.id,'coordination', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.site_visit || ''} onChange={(e)=>updateManhourRow(r.id,'site_visit', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="number" value={r.others || ''} onChange={(e)=>updateManhourRow(r.id,'others', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="text" value={r.remarks || ''} onChange={(e)=>updateManhourRow(r.id,'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={()=>removeManhourRow(r.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove row"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {projectManhours.length === 0 && (
                    <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
                      No manhours recorded yet. Use the form above to add manhour entries.
                    </div>
                  )}
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                      <div className="md:col-span-2 lg:col-span-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Query Description *</label>
                        <input 
                          ref={newQueryDescRef}
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addQueryRow(); } }}
                          type="text" 
                          value={newQuery.query_description} 
                          onChange={(e)=>setNewQuery(prev=>({...prev,query_description:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Query Issued Date</label>
                        <input 
                          type="date" 
                          value={newQuery.query_issued_date} 
                          onChange={(e)=>setNewQuery(prev=>({...prev,query_issued_date:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Reply Received Date</label>
                        <input 
                          type="date" 
                          value={newQuery.reply_received_date} 
                          onChange={(e)=>setNewQuery(prev=>({...prev,reply_received_date:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Reply from Client</label>
                        <input 
                          type="text" 
                          value={newQuery.reply_from_client} 
                          onChange={(e)=>setNewQuery(prev=>({...prev,reply_from_client:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Query Updated By</label>
                        <input 
                          type="text" 
                          value={newQuery.query_updated_by} 
                          onChange={(e)=>setNewQuery(prev=>({...prev,query_updated_by:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Query Resolved</label>
                        <select 
                          value={newQuery.query_resolved} 
                          onChange={(e)=>setNewQuery(prev=>({...prev,query_resolved:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                        >
                          <option value="">Select</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Remark</label>
                      <input 
                        type="text" 
                        value={newQuery.remark} 
                        onChange={(e)=>setNewQuery(prev=>({...prev,remark:e.target.value}))} 
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={addQueryRow} 
                      disabled={!(newQuery.query_description && newQuery.query_description.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${newQuery.query_description && newQuery.query_description.trim() ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add Query
                    </button>
                  </div>

                  {queryLog.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Query Description</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Issued Date</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Reply from Client</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Reply Received</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Updated By</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Resolved</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remark</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {queryLog.map(q => (
                            <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3"><input type="text" value={q.query_description || ''} onChange={(e)=>updateQueryRow(q.id,'query_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="date" value={q.query_issued_date || ''} onChange={(e)=>updateQueryRow(q.id,'query_issued_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={q.reply_from_client || ''} onChange={(e)=>updateQueryRow(q.id,'reply_from_client', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="date" value={q.reply_received_date || ''} onChange={(e)=>updateQueryRow(q.id,'reply_received_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={q.query_updated_by || ''} onChange={(e)=>updateQueryRow(q.id,'query_updated_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><select value={q.query_resolved || ''} onChange={(e)=>updateQueryRow(q.id,'query_resolved', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option><option value="Pending">Pending</option></select></td>
                              <td className="py-2 px-3"><input type="text" value={q.remark || ''} onChange={(e)=>updateQueryRow(q.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={()=>removeQueryRow(q.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove query"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Assumption Description *</label>
                        <input 
                          ref={newAssumptionDescRef}
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addAssumptionRow(); } }}
                          type="text" 
                          value={newAssumption.assumption_description} 
                          onChange={(e)=>setNewAssumption(prev=>({...prev,assumption_description:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Assumption Taken By</label>
                        <input 
                          type="text" 
                          value={newAssumption.assumption_taken_by} 
                          onChange={(e)=>setNewAssumption(prev=>({...prev,assumption_taken_by:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Remark</label>
                        <input 
                          type="text" 
                          value={newAssumption.remark} 
                          onChange={(e)=>setNewAssumption(prev=>({...prev,remark:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
                      <input 
                        type="text" 
                        value={newAssumption.reason} 
                        onChange={(e)=>setNewAssumption(prev=>({...prev,reason:e.target.value}))} 
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={addAssumptionRow} 
                      disabled={!(newAssumption.assumption_description && newAssumption.assumption_description.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${newAssumption.assumption_description && newAssumption.assumption_description.trim() ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add Assumption
                    </button>
                  </div>

                  {assumptions.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Assumption Description</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Reason</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Assumption Taken By</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remark</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {assumptions.map(a => (
                            <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3"><input type="text" value={a.assumption_description || ''} onChange={(e)=>updateAssumptionRow(a.id,'assumption_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={a.reason || ''} onChange={(e)=>updateAssumptionRow(a.id,'reason', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={a.assumption_taken_by || ''} onChange={(e)=>updateAssumptionRow(a.id,'assumption_taken_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={a.remark || ''} onChange={(e)=>updateAssumptionRow(a.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={()=>removeAssumptionRow(a.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove assumption"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">What was new *</label>
                        <input 
                          ref={newLessonDescRef}
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addLessonRow(); } }}
                          type="text" 
                          value={newLesson.what_was_new} 
                          onChange={(e)=>setNewLesson(prev=>({...prev,what_was_new:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Difficulty Faced</label>
                        <input 
                          type="text" 
                          value={newLesson.difficulty_faced} 
                          onChange={(e)=>setNewLesson(prev=>({...prev,difficulty_faced:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">What You Learned</label>
                        <input 
                          type="text" 
                          value={newLesson.what_you_learn} 
                          onChange={(e)=>setNewLesson(prev=>({...prev,what_you_learn:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Areas of Improvement</label>
                        <input 
                          type="text" 
                          value={newLesson.areas_of_improvement} 
                          onChange={(e)=>setNewLesson(prev=>({...prev,areas_of_improvement:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Remark</label>
                      <input 
                        type="text" 
                        value={newLesson.remark} 
                        onChange={(e)=>setNewLesson(prev=>({...prev,remark:e.target.value}))} 
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={addLessonRow} 
                      disabled={!(newLesson.what_was_new && newLesson.what_was_new.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${newLesson.what_was_new && newLesson.what_was_new.trim() ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add Lesson
                    </button>
                  </div>

                  {lessonsLearnt.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">What was new</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Difficulty Faced</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">What You Learned</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Areas of Improvement</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remark</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {lessonsLearnt.map(l => (
                            <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3"><input type="text" value={l.what_was_new || ''} onChange={(e)=>updateLessonRow(l.id,'what_was_new', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={l.difficulty_faced || ''} onChange={(e)=>updateLessonRow(l.id,'difficulty_faced', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={l.what_you_learn || ''} onChange={(e)=>updateLessonRow(l.id,'what_you_learn', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={l.areas_of_improvement || ''} onChange={(e)=>updateLessonRow(l.id,'areas_of_improvement', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={l.remark || ''} onChange={(e)=>updateLessonRow(l.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={()=>removeLessonRow(l.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove lesson"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Document Name *</label>
                        <input 
                          ref={newIssuedDescRef}
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addIssuedDocument(); } }}
                          type="text" 
                          value={newIssuedDoc.document_name} 
                          onChange={(e)=>setNewIssuedDoc(prev=>({...prev,document_name:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Document No.</label>
                        <input 
                          type="text" 
                          value={newIssuedDoc.document_number} 
                          onChange={(e)=>setNewIssuedDoc(prev=>({...prev,document_number:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Revision No.</label>
                        <input 
                          type="text" 
                          value={newIssuedDoc.revision_number} 
                          onChange={(e)=>setNewIssuedDoc(prev=>({...prev,revision_number:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Issue Date</label>
                        <input 
                          type="date" 
                          value={newIssuedDoc.issue_date} 
                          onChange={(e)=>setNewIssuedDoc(prev=>({...prev,issue_date:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                      <input 
                        type="text" 
                        value={newIssuedDoc.remarks} 
                        onChange={(e)=>setNewIssuedDoc(prev=>({...prev,remarks:e.target.value}))} 
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={addIssuedDocument} 
                      disabled={!(newIssuedDoc.document_name && newIssuedDoc.document_name.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${newIssuedDoc.document_name && newIssuedDoc.document_name.trim() ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add Document
                    </button>
                  </div>

                  {documentsIssued.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Document Name</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Document Number</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Revision No.</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Issue Date</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remarks</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {documentsIssued.map(d => (
                            <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3"><input type="text" value={d.document_name || ''} onChange={(e) => updateIssuedDocument(d.id, 'document_name', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={d.document_number || ''} onChange={(e) => updateIssuedDocument(d.id, 'document_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={d.revision_number || ''} onChange={(e) => updateIssuedDocument(d.id, 'revision_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="date" value={d.issue_date || ''} onChange={(e) => updateIssuedDocument(d.id, 'issue_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3"><input type="text" value={d.remarks || ''} onChange={(e) => updateIssuedDocument(d.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={() => removeIssuedDocument(d.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove document"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Documents Received Tab */}
            {activeTab === 'documents_received' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
                    <h2 className="text-sm font-bold text-gray-900">List of Documents Received</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Record documents received with details</p>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {/* Add Document Form */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <h3 className="text-xs font-semibold text-gray-700 mb-3">Add New Document</h3>
                    
                    <div className="grid grid-cols-7 gap-2 mb-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                        <input 
                          type="date" 
                          value={newReceivedDoc.date_received} 
                          onChange={(e)=>setNewReceivedDoc(prev=>({...prev,date_received:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description / Document Name *</label>
                        <input 
                          ref={newReceivedDescRef} 
                          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addReceivedDocument(); } }} 
                          type="text" 
                          value={newReceivedDoc.description} 
                          onChange={(e)=>setNewReceivedDoc(prev=>({...prev,description:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Drawing No.</label>
                        <input 
                          type="text" 
                          value={newReceivedDoc.drawing_number} 
                          onChange={(e)=>setNewReceivedDoc(prev=>({...prev,drawing_number:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Revision No.</label>
                        <input 
                          type="text" 
                          value={newReceivedDoc.revision_number} 
                          onChange={(e)=>setNewReceivedDoc(prev=>({...prev,revision_number:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Unit / Qty</label>
                        <input 
                          type="text" 
                          value={newReceivedDoc.unit_qty} 
                          onChange={(e)=>setNewReceivedDoc(prev=>({...prev,unit_qty:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Sent By</label>
                        <input 
                          type="text" 
                          value={newReceivedDoc.document_sent_by} 
                          onChange={(e)=>setNewReceivedDoc(prev=>({...prev,document_sent_by:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                      <input 
                        type="text" 
                        value={newReceivedDoc.remarks} 
                        onChange={(e)=>setNewReceivedDoc(prev=>({...prev,remarks:e.target.value}))} 
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={addReceivedDocument} 
                      disabled={!(newReceivedDoc.description && newReceivedDoc.description.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${newReceivedDoc.description && newReceivedDoc.description.trim() ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add Document
                    </button>
                  </div>

                  {/* Documents Table */}
                  {documentsReceived.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Date</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Description / Document Name</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Drawing Number</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Revision Number</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Unit / Qty</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Sent By</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remarks</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {documentsReceived.map(d => (
                            <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3">
                                <input 
                                  type="date" 
                                  value={d.date_received || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'date_received', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input 
                                  type="text" 
                                  value={d.description || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'description', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input 
                                  type="text" 
                                  value={d.drawing_number || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'drawing_number', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input 
                                  type="text" 
                                  value={d.revision_number || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'revision_number', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input 
                                  type="text" 
                                  value={d.unit_qty || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'unit_qty', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input 
                                  type="text" 
                                  value={d.document_sent_by || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'document_sent_by', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input 
                                  type="text" 
                                  value={d.remarks || ''} 
                                  onChange={(e) => updateReceivedDocument(d.id, 'remarks', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                />
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={() => removeReceivedDocument(d.id)} 
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors"
                                  title="Remove document"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {documentsReceived.length === 0 && (
                    <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
                      No documents recorded yet. Use the form above to add documents received.
                    </div>
                  )}
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
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Activity / Task Description</label>
                        <select
                          ref={newScheduleDescRef} 
                          value={newSchedule.activity_description} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,activity_description:e.target.value}))}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                        >
                          <option value="">Select activity from Activity Master...</option>
                          {functions.map(func => (
                            <optgroup key={func.id} label={`📁 ${func.function_name}`}>
                              {func.activities && func.activities.map(act => (
                                <Fragment key={act.id}>
                                  <option value={act.activity_name}>
                                    📄 {act.activity_name}
                                  </option>
                                  {act.subActivities && act.subActivities.map(sub => (
                                    <option key={sub.id} value={sub.name}>
                                      ↳ {sub.name}
                                    </option>
                                  ))}
                                </Fragment>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">Select from Activity Master hierarchy</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Unit/Qty</label>
                        <input 
                          type="text" 
                          placeholder="Unit/Qty" 
                          value={newSchedule.unit_qty} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,unit_qty:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                        <input 
                          type="date" 
                          value={newSchedule.start_date} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,start_date:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Completion Date</label>
                        <input 
                          type="date" 
                          value={newSchedule.end_date} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,end_date:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Time/Hours Required</label>
                        <input 
                          type="text" 
                          placeholder="Hours" 
                          value={newSchedule.time_required} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,time_required:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                        <select 
                          value={newSchedule.status_completed} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,status_completed:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                        >
                          <option value="">Select status</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                          <option value="Ongoing">Ongoing</option>
                        </select>
                      </div>
                      <div className="md:col-span-7">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
                        <input 
                          type="text" 
                          placeholder="Additional remarks..." 
                          value={newSchedule.remarks} 
                          onChange={(e)=>setNewSchedule(prev=>({...prev,remarks:e.target.value}))} 
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <button 
                      type="button" 
                      onClick={addSchedule} 
                      disabled={!(newSchedule.activity_description && newSchedule.activity_description.trim())} 
                      className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                        newSchedule.activity_description && newSchedule.activity_description.trim() 
                          ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]' 
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add Activity
                    </button>
                  </div>

                  {projectSchedule.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Activity / Task Description</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Unit/Qty</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Start Date</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Completion Date</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Time/Hours</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Status</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Remarks</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700">Remove</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {projectSchedule.map(s => (
                            <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2 px-3">
                                <select 
                                  value={s.activity_description || ''} 
                                  onChange={(e) => updateSchedule(s.id, 'activity_description', e.target.value)} 
                                  className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                                >
                                  <option value="">Select activity...</option>
                                  {functions.map(func => (
                                    <optgroup key={func.id} label={`📁 ${func.function_name}`}>
                                      {func.activities && func.activities.map(act => (
                                        <Fragment key={act.id}>
                                          <option value={act.activity_name}>
                                            📄 {act.activity_name}
                                          </option>
                                          {act.subActivities && act.subActivities.map(sub => (
                                            <option key={sub.id} value={sub.name}>
                                              ↳ {sub.name}
                                            </option>
                                          ))}
                                        </Fragment>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 px-3"><input type="text" value={s.unit_qty || ''} onChange={(e) => updateSchedule(s.id, 'unit_qty', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="date" value={s.start_date || ''} onChange={(e) => updateSchedule(s.id, 'start_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="date" value={s.end_date || ''} onChange={(e) => updateSchedule(s.id, 'end_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><input type="text" value={s.time_required || ''} onChange={(e) => updateSchedule(s.id, 'time_required', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3"><select value={s.status_completed || ''} onChange={(e) => updateSchedule(s.id, 'status_completed', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option><option value="Ongoing">Ongoing</option></select></td>
                              <td className="py-2 px-3"><input type="text" value={s.remarks || ''} onChange={(e) => updateSchedule(s.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                              <td className="py-2 px-3 text-center">
                                <button 
                                  type="button" 
                                  onClick={() => removeSchedule(s.id)} 
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Remove item"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {projectSchedule.length === 0 && (
                    <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
                      No schedule items added yet. Use the form above to add activities.
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Project Activity / Daily Activity Tab */}
            {activeTab === 'project_activity' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
                    <h2 className="text-sm font-bold text-gray-900">Project Activities</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Manage disciplines, activities, sub-activities with planning and tracking</p>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {/* Add Activity Section */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                      Add New Activity
                    </h4>
                    
                    <div className="space-y-2">
                      {/* Manual Activity Input */}
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={newScopeActivityName} 
                          onChange={(e) => setNewScopeActivityName(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && addScopeActivity()}
                          placeholder="Type activity name manually..." 
                          className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] bg-white" 
                        />
                        <button 
                          type="button" 
                          onClick={addScopeActivity}
                          disabled={!newScopeActivityName.trim()}
                          className="px-3 py-1.5 bg-[#7F2487] text-white rounded text-sm font-semibold hover:bg-[#6a1e73] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                          Add Manual
                        </button>
                      </div>
                      
                      {/* Activity Master Dropdown */}
                      {functions.length > 0 && (
                        <div className="flex gap-2">
                          <select
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value) {
                                const [funcId, actId, type] = value.split('|');
                                const func = functions.find(f => String(f.id) === funcId);
                                
                                if (type === 'activity') {
                                  const activity = func?.activities?.find(a => String(a.id) === actId);
                                  if (activity) {
                                    const exists = projectActivities.find(pa => pa.id === activity.id && pa.type === 'activity');
                                    if (!exists) {
                                      setProjectActivities(prev => [...prev, {
                                        id: activity.id,
                                        type: 'activity',
                                        source: 'master',
                                        name: activity.activity_name,
                                        status: 'NEW',
                                        deliverables: '',
                                        manhours: 0,
                                        unit_qty: '',
                                        planned_hours: 0,
                                        start_time: '',
                                        end_time: '',
                                        actual_hours: 0,
                                        activity_done_by: '',
                                        status_completed: '',
                                        remark: '',
                                        assigned_users: [],
                                        assigned_user: '',
                                        due_date: '',
                                        priority: 'MEDIUM',
                                        function_id: funcId,
                                        function_name: func.function_name
                                      }]);
                                    }
                                  }
                                } else if (type === 'subactivity') {
                                  const activity = func?.activities?.find(a => a.subActivities?.some(sa => String(sa.id) === actId));
                                  const subActivity = activity?.subActivities?.find(sa => String(sa.id) === actId);
                                  if (subActivity) {
                                    const exists = projectActivities.find(pa => pa.id === subActivity.id && pa.type === 'subactivity');
                                    if (!exists) {
                                      setProjectActivities(prev => [...prev, {
                                        id: subActivity.id,
                                        type: 'subactivity',
                                        source: 'master',
                                        name: subActivity.name,
                                        status: 'NEW',
                                        deliverables: '',
                                        manhours: 0,
                                        unit_qty: '',
                                        planned_hours: 0,
                                        start_time: '',
                                        end_time: '',
                                        actual_hours: 0,
                                        activity_done_by: '',
                                        status_completed: '',
                                        remark: '',
                                        assigned_users: [],
                                        assigned_user: '',
                                        due_date: '',
                                        priority: 'MEDIUM',
                                        function_id: funcId,
                                        function_name: func.function_name,
                                        activity_id: activity.id,
                                        activity_name: activity.activity_name
                                      }]);
                                    }
                                  }
                                }
                                e.target.value = '';
                              }
                            }}
                            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] bg-white"
                          >
                            <option value="">Or select from Activity Master...</option>
                            {functions.map(func => (
                              <optgroup key={func.id} label={`📁 ${func.function_name}`}>
                                {(func.activities || []).map(activity => (
                                  <Fragment key={activity.id}>
                                    <option 
                                      value={`${func.id}|${activity.id}|activity`}
                                      disabled={projectActivities.some(pa => pa.id === activity.id && pa.type === 'activity')}
                                    >
                                      📄 {activity.activity_name}
                                    </option>
                                    {(activity.subActivities || []).map(subActivity => (
                                      <option 
                                        key={subActivity.id}
                                        value={`${func.id}|${subActivity.id}|subactivity`}
                                        disabled={projectActivities.some(pa => pa.id === subActivity.id && pa.type === 'subactivity')}
                                      >
                                        &nbsp;&nbsp;&nbsp;↳ {subActivity.name}
                                      </option>
                                    ))}
                                  </Fragment>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hierarchical Activity Table */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Activities Hierarchy & Tracking</h4>
                    
                    <div className="overflow-x-auto bg-white rounded border border-gray-200">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-100 border-b">
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-48">Activity Name</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-24">Source</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-40">Assigned To</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-32">Due Date</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-28">Priority</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-28">Planned Hrs</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-28">Start Time</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-28">End Time</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-28">Actual Hrs</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-32">Status</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700 w-40">Remark</th>
                            <th className="text-center py-2 px-3 font-semibold text-gray-700 w-24">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectActivities.length === 0 ? (
                            <tr><td colSpan={12} className="text-center py-6 text-gray-500 text-sm">No activities added. Add manually or select from Activity Master.</td></tr>
                          ) : (
                            // Group by discipline
                            (() => {
                              const grouped = {};
                              projectActivities.forEach(act => {
                                const discipline = act.function_name || 'Manual / Other';
                                if (!grouped[discipline]) grouped[discipline] = [];
                                grouped[discipline].push(act);
                              });

                              return Object.entries(grouped).map(([discipline, acts]) => (
                                <Fragment key={discipline}>
                                  {/* Discipline Header Row */}
                                  <tr className="bg-gradient-to-r from-purple-100 to-purple-50 border-b-2 border-purple-300">
                                    <td colSpan={12} className="py-2 px-3">
                                      <span className="font-bold text-purple-900 text-sm flex items-center gap-2">
                                        📁 {discipline}
                                        <span className="text-xs font-normal text-purple-700">({acts.length} {acts.length === 1 ? 'activity' : 'activities'})</span>
                                      </span>
                                    </td>
                                  </tr>
                                  
                                  {/* Activities and Sub-activities */}
                                  {acts.map((act) => (
                                    <tr key={`${act.id}-${act.type}`} className="border-b hover:bg-purple-50 transition-colors">
                                      <td className="py-2 px-3">
                                        <div className="flex items-center gap-1">
                                          {act.type === 'subactivity' && <span className="text-purple-400">↳</span>}
                                          <input 
                                            type="text" 
                                            value={act.name} 
                                            onChange={(e) => updateScopeActivity(act.id, 'name', e.target.value)} 
                                            className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                          />
                                        </div>
                                        {act.type === 'subactivity' && act.activity_name && (
                                          <div className="text-xs text-gray-500 mt-0.5 ml-4">Parent: {act.activity_name}</div>
                                        )}
                                      </td>
                                      <td className="py-2 px-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                                          act.source === 'master' ? 'bg-blue-100 text-blue-700' : 
                                          act.source === 'manual' ? 'bg-green-100 text-green-700' : 
                                          'bg-purple-100 text-purple-700'
                                        }`}>
                                          {act.source === 'master' ? 'Master' : act.source === 'manual' ? 'Manual' : 'Proposal'}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3">
                                        <select
                                          value={act.assigned_user || ''}
                                          onChange={(e) => updateScopeActivity(act.id, 'assigned_user', e.target.value)}
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                                        >
                                          <option value="">Unassigned</option>
                                          {employees.map(emp => (
                                            <option key={emp.id} value={emp.id}>
                                              {emp.first_name} {emp.last_name}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td className="py-2 px-3">
                                        <input 
                                          type="date" 
                                          value={act.due_date || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'due_date', e.target.value)} 
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                        />
                                      </td>
                                      <td className="py-2 px-3">
                                        <select 
                                          value={act.priority || 'MEDIUM'} 
                                          onChange={(e) => updateScopeActivity(act.id, 'priority', e.target.value)} 
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                                        >
                                          <option value="LOW">Low</option>
                                          <option value="MEDIUM">Medium</option>
                                          <option value="HIGH">High</option>
                                          <option value="URGENT">Urgent</option>
                                        </select>
                                      </td>
                                      <td className="py-2 px-3">
                                        <input 
                                          type="number" 
                                          value={act.planned_hours || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'planned_hours', e.target.value)} 
                                          placeholder="0"
                                          min="0"
                                          step="0.5"
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                        />
                                      </td>
                                      <td className="py-2 px-3">
                                        <input 
                                          type="time" 
                                          value={act.start_time || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'start_time', e.target.value)} 
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                        />
                                      </td>
                                      <td className="py-2 px-3">
                                        <input 
                                          type="time" 
                                          value={act.end_time || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'end_time', e.target.value)} 
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                        />
                                      </td>
                                      <td className="py-2 px-3">
                                        <input 
                                          type="number" 
                                          value={act.actual_hours || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'actual_hours', e.target.value)} 
                                          placeholder="0"
                                          min="0"
                                          step="0.5"
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                        />
                                      </td>
                                      <td className="py-2 px-3">
                                        <select 
                                          value={act.status_completed || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'status_completed', e.target.value)} 
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                                        >
                                          <option value="">Select</option>
                                          <option value="NOT_STARTED">Not Started</option>
                                          <option value="IN_PROGRESS">In Progress</option>
                                          <option value="COMPLETED">Completed</option>
                                          <option value="OVERDUE">Overdue</option>
                                        </select>
                                      </td>
                                      <td className="py-2 px-3">
                                        <input 
                                          type="text" 
                                          value={act.remark || ''} 
                                          onChange={(e) => updateScopeActivity(act.id, 'remark', e.target.value)} 
                                          placeholder="Notes"
                                          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                        />
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        <button 
                                          type="button" 
                                          onClick={() => removeScopeActivity(act.id)} 
                                          className="text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors font-medium"
                                        >
                                          Remove
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </Fragment>
                              ));
                            })()
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Scope of Work Tab */}
            {activeTab === 'scope' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
                    <h2 className="text-sm font-bold text-gray-900">Scope of Work</h2>
                  </div>
                </div>
                <div className="px-6 py-5">
                  {/* Scope Description - Fetched from Proposal */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Project Scope</label>
                    <div className="bg-white rounded p-3 border border-gray-200 min-h-[100px]">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.scope_of_work || form.description || 'No scope defined yet.'}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Scope is fetched from the proposal and can be edited in Project Details.</p>
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
              <section className="rounded-2xl overflow-hidden" style={{
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
                border: '1.5px solid rgba(139, 92, 246, 0.1)',
                boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
              }}>
                <div className="px-6 py-4 flex items-center justify-between" style={{
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.03) 0%, rgba(124, 58, 237, 0.02) 100%)',
                  borderBottom: '1.5px solid rgba(139, 92, 246, 0.08)'
                }}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl" style={{
                      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
                      border: '1px solid rgba(139, 92, 246, 0.2)'
                    }}>
                      <DocumentIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />
                    </div>
                    <div>
                      <h2 className="text-base font-bold" style={{ color: '#0f172a', letterSpacing: '-0.01em' }}>Project Team</h2>
                      <p className="text-xs font-medium" style={{ color: '#64748b' }}>Assign employees to activities with hours and costs</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={addActivityTeamMember}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-300"
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                      letterSpacing: '0.01em'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 20px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                    }}
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Team Member
                  </button>
                </div>
                <div className="px-6 py-6">
                  {/* Enhanced Summary Cards */}
                  <div className="mb-6 grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl" style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(37, 99, 235, 0.05) 100%)',
                      border: '1.5px solid rgba(59, 130, 246, 0.2)',
                      boxShadow: '0 2px 8px rgba(59, 130, 246, 0.08)'
                    }}>
                      <p className="text-xs font-bold mb-1" style={{ color: '#64748b' }}>Total Manhours</p>
                      <p className="text-xl font-bold" style={{ color: '#3b82f6' }}>{totalManhours.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-xl" style={{
                      background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(22, 163, 74, 0.05) 100%)',
                      border: '1.5px solid rgba(34, 197, 94, 0.2)',
                      boxShadow: '0 2px 8px rgba(34, 197, 94, 0.08)'
                    }}>
                      <p className="text-xs font-bold mb-1" style={{ color: '#64748b' }}>Total Cost</p>
                      <p className="text-xl font-bold" style={{ color: '#22c55e' }}>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(totalCost)}</p>
                    </div>
                  </div>

                  {teamMembers.length === 0 ? (
                    <div className="text-center py-16 px-4">
                      <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
                        border: '2px solid rgba(139, 92, 246, 0.2)'
                      }}>
                        <DocumentIcon className="w-8 h-8" style={{ color: '#8b5cf6' }} />
                      </div>
                      <p className="text-sm font-semibold mb-2" style={{ color: '#0f172a' }}>No Team Members Yet</p>
                      <p className="text-xs" style={{ color: '#64748b' }}>Click &quot;Add Team Member&quot; to start building your project team</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl" style={{
                      border: '1.5px solid rgba(139, 92, 246, 0.1)',
                      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.02)'
                    }}>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr style={{
                            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(124, 58, 237, 0.03) 100%)',
                            borderBottom: '2px solid rgba(139, 92, 246, 0.15)'
                          }}>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Name</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Discipline</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Activity</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Sub-Activity</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Required Hours</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Actual Hours</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Start Date</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>End Date</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Actual Date</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Manhours</th>
                            <th className="text-left py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Cost</th>
                            <th className="text-center py-3 px-4 font-bold" style={{ color: '#0f172a', letterSpacing: '0.01em' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamMembers.map((member) => {
                            return (
                              <tr 
                                key={member.id} 
                                className="transition-all duration-200" 
                                style={{ borderBottom: '1px solid rgba(139, 92, 246, 0.06)' }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.03) 0%, rgba(124, 58, 237, 0.02) 100%)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <td className="py-3 px-4">
                                  <select
                                    value={member.employee_id}
                                    onChange={(e) => updateActivityTeamMember(member.id, 'employee_id', e.target.value)}
                                    className="w-full px-3 py-2 text-xs font-medium rounded-lg transition-all duration-300"
                                    style={{
                                      background: 'rgba(255, 255, 255, 0.95)',
                                      border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                      color: '#0f172a',
                                      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)'
                                    }}
                                    onFocus={(e) => {
                                      e.target.style.borderColor = '#8b5cf6';
                                      e.target.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1)';
                                    }}
                                    onBlur={(e) => {
                                      e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                                      e.target.style.boxShadow = '0 1px 2px rgba(15, 23, 42, 0.02)';
                                    }}
                                  >
                                    <option value="">Select Team Member</option>
                                    {getProjectTeamForDropdown().map((emp) => (
                                      <option key={emp.id} value={emp.id}>
                                        {emp.name} {emp.project_role && `(${emp.project_role})`}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                    <td className="py-2 px-3">
                                      <select
                                        value={member.discipline || ''}
                                        onChange={(e) => updateActivityTeamMember(member.id, 'discipline', e.target.value)}
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
                                        onChange={(e) => updateActivityTeamMember(member.id, 'activity_id', e.target.value)}
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
                                    onChange={(e) => updateActivityTeamMember(member.id, 'sub_activity', e.target.value)}
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
                                    onChange={(e) => updateActivityTeamMember(member.id, 'required_hours', e.target.value)}
                                    min="0"
                                    step="0.1"
                                    className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="number"
                                    value={member.actual_hours}
                                    onChange={(e) => updateActivityTeamMember(member.id, 'actual_hours', e.target.value)}
                                    min="0"
                                    step="0.1"
                                    className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="date"
                                    value={member.planned_start_date || ''}
                                    onChange={(e) => updateActivityTeamMember(member.id, 'planned_start_date', e.target.value)}
                                    className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="date"
                                    value={member.planned_end_date}
                                    onChange={(e) => updateActivityTeamMember(member.id, 'planned_end_date', e.target.value)}
                                    className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input
                                    type="date"
                                    value={member.actual_completion_date}
                                    onChange={(e) => updateActivityTeamMember(member.id, 'actual_completion_date', e.target.value)}
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
                                    onChange={(e) => updateActivityTeamMember(member.id, 'cost', e.target.value)}
                                    min="0"
                                    step="0.01"
                                    className="w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                                  />
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeActivityTeamMember(member.id)}
                                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-300"
                                    style={{
                                      background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.08) 100%)',
                                      color: '#ef4444',
                                      border: '1.5px solid rgba(239, 68, 68, 0.2)',
                                      boxShadow: '0 2px 4px rgba(239, 68, 68, 0.08)'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.transform = 'scale(1.05)';
                                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.12) 100%)';
                                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(239, 68, 68, 0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.transform = 'scale(1)';
                                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.08) 100%)';
                                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(239, 68, 68, 0.08)';
                                    }}
                                  >
                                    <TrashIcon className="h-3.5 w-3.5" />
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
                            {planningActivities.map((activity) => (
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
                                <div 
                                  className="h-8 w-8 rounded border border-blue-200 bg-blue-50 flex items-center justify-center"
                                  style={{ backgroundImage: `url(${doc.thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                                  title={doc.name || 'Document thumbnail'}
                                >
                                  {!doc.thumbUrl && <DocumentIcon className="h-4 w-4 text-blue-600" />}
                                </div>
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
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
