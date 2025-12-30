 'use client';

// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Suspense, useEffect, useMemo, useState, Fragment, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon, PlusIcon, TrashIcon, CheckCircleIcon, ChevronDownIcon, DocumentIcon, XMarkIcon, UserIcon, ClockIcon, ChatBubbleLeftRightIcon, CheckIcon, PhoneIcon, EnvelopeIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { fetchJSON } from '@/utils/http';
import { useSession } from '@/context/SessionContext';
import Image from 'next/image';

const INITIAL_FORM = {
  // Scope & Annexure fields
  scope_of_work: '',
  additional_scope: '',
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
  { id: 'project_schedule', label: 'Project Schedule' },
  { id: 'project_activity', label: 'Project Activity' },
  { id: 'documents_issued', label: 'Documents Issued' },
  { id: 'project_handover', label: 'Project Handover' },
  { id: 'project_manhours', label: 'Project Manhours' },
  { id: 'query_log', label: 'Query Log' },
  { id: 'assumption', label: 'Assumption' },
  { id: 'lessons_learnt', label: 'Lessons Learnt' },
  { id: 'discussion', label: 'Discussion' }
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
  const { user: sessionUser } = useSession();

  const [activeTab, setActiveTab] = useState('general');
  const [companies, setCompanies] = useState([]);
  const [functions, setFunctions] = useState([]); // Top-level disciplines/functions
  const [activities, setActivities] = useState([]); // Standalone activities list
  const [subActivities, setSubActivities] = useState([]); // Standalone subactivities list
  const [form, setForm] = useState(INITIAL_FORM);
  const [projectActivities, setProjectActivities] = useState([]);
  const [newScopeActivityName, setNewScopeActivityName] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  // Kickoff meetings stored as an array
  const [kickoffMeetings, setKickoffMeetings] = useState([]);
  const [newKickoffMeetingTitle, setNewKickoffMeetingTitle] = useState('');
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
    sheet_number: '',
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
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [teamMemberSearch, setTeamMemberSearch] = useState('');
  
  // Software Management
  const [softwareItems, setSoftwareItems] = useState([]);
  const [softwareCategories, setSoftwareCategories] = useState([]);
  const [selectedSoftwareCategory, setSelectedSoftwareCategory] = useState('');
  const [selectedSoftware, setSelectedSoftware] = useState('');
  const [selectedSoftwareVersion, setSelectedSoftwareVersion] = useState('');
  
  // User Master (for Assigned To dropdowns)
  const [userMaster, setUserMaster] = useState([]);
  
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
        
        // Fetch users from User Master (for Assigned To dropdowns and team selection)
        try {
          const usersData = await fetchJSON('/api/users?limit=10000');
          if (usersData && usersData.success && Array.isArray(usersData.data)) {
            console.log('Users loaded from User Master:', usersData.data);
            setUserMaster(usersData.data || []);
          }
        } catch (err) {
          console.warn('Failed to fetch users from User Master', err);
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

    // Helper to format date for input[type="date"] (YYYY-MM-DD)
    const formatDateForInput = (dateValue) => {
      if (!dateValue) return '';
      try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0];
      } catch {
        return '';
      }
    };

    const fetchProject = async () => {
      try {
        console.log('[fetchProject] Fetching project data for ID:', id);
        const result = await fetchJSON(`/api/projects/${id}`);
        console.log('[fetchProject] API response success:', result.success);
        
        if (result.success && result.data) {
          const project = result.data;
          console.log('[fetchProject] Project data keys:', Object.keys(project));
          console.log('[fetchProject] Project name:', project.name);
          console.log('[fetchProject] Project client:', project.client_name);
          setForm({
            project_id: project.project_code || project.project_id || '',
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
            start_date: formatDateForInput(project.start_date),
            end_date: formatDateForInput(project.end_date),
            target_date: formatDateForInput(project.target_date),
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
            mobilization_date: formatDateForInput(project.mobilization_date),
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
            input_document: typeof project.input_document === 'object' && project.input_document !== null ? JSON.stringify(project.input_document) : (project.input_document || ''),
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
                  input_document: typeof proposal.input_document === 'object' && proposal.input_document !== null ? JSON.stringify(proposal.input_document) : (proposal.input_document || prev.input_document),
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

          // Load input documents list - prioritize new structured field over legacy
          if (project.input_documents_list) {
            try {
              const parsed = typeof project.input_documents_list === 'string'
                ? JSON.parse(project.input_documents_list)
                : project.input_documents_list;
              console.log('[fetchProject] input_documents_list loaded:', parsed?.length, 'items');
              setInputDocumentsList(Array.isArray(parsed) ? parsed : []);
            } catch (err) {
              console.error('[fetchProject] Error parsing input_documents_list:', err);
              setInputDocumentsList([]);
            }
          } else if (project.input_document) {
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
                console.log('[fetchProject] documents_received_list loaded:', parsed?.length, 'items');
                setDocumentsReceived(Array.isArray(parsed) ? parsed : []);
              } catch (err) {
                console.error('[fetchProject] Error parsing documents_received_list:', err);
                setDocumentsReceived([]);
              }
            } else {
              console.log('[fetchProject] No documents_received_list found');
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

            // Load documents issued list
            if (project.documents_issued_list) {
              try {
                const parsed = typeof project.documents_issued_list === 'string'
                  ? JSON.parse(project.documents_issued_list)
                  : project.documents_issued_list;
                setDocumentsIssued(Array.isArray(parsed) ? parsed : []);
              } catch {
                setDocumentsIssued([]);
              }
            } else {
              setDocumentsIssued([]);
            }

            // Load project handover list
            if (project.project_handover_list) {
              try {
                const parsed = typeof project.project_handover_list === 'string'
                  ? JSON.parse(project.project_handover_list)
                  : project.project_handover_list;
                setProjectHandover(Array.isArray(parsed) ? parsed : []);
              } catch {
                setProjectHandover([]);
              }
            } else {
              setProjectHandover([]);
            }

            // Load project manhours list
            if (project.project_manhours_list) {
              try {
                const parsed = typeof project.project_manhours_list === 'string'
                  ? JSON.parse(project.project_manhours_list)
                  : project.project_manhours_list;
                setProjectManhours(Array.isArray(parsed) ? parsed : []);
              } catch {
                setProjectManhours([]);
              }
            } else {
              setProjectManhours([]);
            }

            // Load project schedule list
            if (project.project_schedule_list) {
              try {
                const parsed = typeof project.project_schedule_list === 'string'
                  ? JSON.parse(project.project_schedule_list)
                  : project.project_schedule_list;
                setProjectSchedule(Array.isArray(parsed) ? parsed : []);
              } catch {
                setProjectSchedule([]);
              }
            } else {
              setProjectSchedule([]);
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

                  // Load kickoff meetings list (new structured array) or fall back to legacy singular kickoff fields
                  if (project.kickoff_meetings_list) {
                    try {
                      const parsed = typeof project.kickoff_meetings_list === 'string'
                        ? JSON.parse(project.kickoff_meetings_list)
                        : project.kickoff_meetings_list;
                      setKickoffMeetings(Array.isArray(parsed) ? parsed : []);
                    } catch {
                      setKickoffMeetings([]);
                    }
                  } else if (project.kickoff_meeting_no || project.kickoff_meeting_title || project.kickoff_persons_involved) {
                    // backfill a single meeting record from legacy fields
                    setKickoffMeetings([{
                      id: Date.now(),
                      meeting_no: project.kickoff_meeting_no || '',
                      client_name: project.kickoff_client_name || '',
                      meeting_date: project.kickoff_meeting_date || '',
                      organizer: project.kickoff_meeting_organizer || '',
                      minutes_drafted: project.kickoff_minutes_drafted || '',
                      meeting_location: project.kickoff_meeting_location || '',
                      client_representative: project.kickoff_client_representative || '',
                      meeting_title: project.kickoff_meeting_title || '',
                      points_discussed: project.kickoff_points_discussed || '',
                      persons_involved: project.kickoff_persons_involved || ''
                    }]);
                  } else {
                    setKickoffMeetings([]);
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

  // Fetch all users for team selection
  useEffect(() => {
    const fetchUsers = async () => {
      setUsersLoading(true);
      try {
        const res = await fetch('/api/users?limit=10000');
        const json = await res.json();
        if (json?.success && Array.isArray(json.data)) {
          setAllUsers(json.data);
        }
      } catch (error) {
        console.error('Failed to fetch users:', error);
      } finally {
        setUsersLoading(false);
      }
    };
    fetchUsers();
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

  const handleChange = (event) => {
    const { name, value } = event.target;
    console.log('[handleChange]', name, '=', value);
    setForm({ ...form, [name]: value });
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
        sheet_number: newInputDocument.sheet_number || '',
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
        sheet_number: '',
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
  };

  // Project Team Management Functions
  const addTeamMember = (user) => {
    // Check if already added
    const exists = projectTeamMembers.some(member => member.id === user.id);
    if (exists) {
      alert('This user is already in the team');
      return;
    }

    const teamMember = {
      id: user.id,
      employee_id: user.employee_id || user.id,
      name: user.full_name || user.username,
      email: user.email,
      department: user.department || '',
      position: user.role_name || '',
      role: 'Team Member' // Default role, can be changed
    };

    setProjectTeamMembers(prev => [...prev, teamMember]);
    
    // Update form data
    setForm(prev => ({
      ...prev,
      project_team: JSON.stringify([...projectTeamMembers, teamMember])
    }));
  };

  const removeTeamMember = (memberId) => {
    const updated = projectTeamMembers.filter(member => member.id !== memberId);
    setProjectTeamMembers(updated);
    
    // Update form data
    setForm(prev => ({
      ...prev,
      project_team: JSON.stringify(updated)
    }));
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
  };

  // Get filtered users for team selection (only show those not already in team)
  const availableUsers = allUsers.filter(user => 
    !projectTeamMembers.some(member => member.id === user.id) &&
    (teamMemberSearch === '' || 
     (user.full_name || user.username || '').toLowerCase().includes(teamMemberSearch.toLowerCase()) ||
     user.email?.toLowerCase().includes(teamMemberSearch.toLowerCase()) ||
     user.department?.toLowerCase().includes(teamMemberSearch.toLowerCase()))
  );

  // Get project team members for use in other tabs (replaces full user list)
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
    console.log('[addReceivedDocument] Called with:', newReceivedDoc);
    // Basic validation: require description
    if (!newReceivedDoc.description || !newReceivedDoc.description.trim()) return;

    // Default date to today if not provided
    const today = new Date().toISOString().slice(0,10);
    const doc = { 
      ...newReceivedDoc, 
      id: Date.now(),
      date_received: newReceivedDoc.date_received || today
    };
    console.log('[addReceivedDocument] Adding document:', doc);
    setDocumentsReceived(prev => {
      const updated = [...prev, doc];
      console.log('[addReceivedDocument] New documentsReceived array:', updated);
      return updated;
    });
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
    console.log('[addHandoverRow] Called with:', newHandoverRow);
    if (!newHandoverRow.output_by_accent || !newHandoverRow.output_by_accent.trim()) {
      console.log('[addHandoverRow] Validation failed - output_by_accent is required');
      return;
    }
    const row = { ...newHandoverRow, id: Date.now() };
    console.log('[addHandoverRow] Adding row:', row);
    setProjectHandover(prev => {
      const updated = [...prev, row];
      console.log('[addHandoverRow] New projectHandover array length:', updated.length);
      console.log('[addHandoverRow] New projectHandover array:', updated);
      return updated;
    });
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
  const addKickoffMeeting = () => {
    const meetingNo = `KOM-${String(kickoffMeetings.length + 1).padStart(3, '0')}`;
    const meeting = {
      id: Date.now(),
      meeting_no: meetingNo,
      client_name: '',
      meeting_date: '',
      organizer: '',
      minutes_drafted: '',
      meeting_location: '',
      client_representative: '',
      meeting_title: newKickoffMeetingTitle || '',
      points_discussed: '',
      persons_involved: ''
    };
    setKickoffMeetings(prev => [...prev, meeting]);
    setNewKickoffMeetingTitle('');
  };

  const updateKickoffMeeting = (id, field, value) => {
    setKickoffMeetings(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const formatAsBulletPoints = (text) => {
    if (!text) return '';
    const lines = text.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const trimmed = line.trim();
      // If line doesn't start with bullet, add one
      if (!trimmed.startsWith('•') && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
        return '• ' + trimmed;
      }
      return trimmed;
    }).join('\n');
  };

  const handlePointsBlur = (id, value, updateFunction, fieldName = 'points_discussed') => {
    const formatted = formatAsBulletPoints(value);
    updateFunction(id, fieldName, formatted);
  };

  const removeKickoffMeeting = (id) => {
    setKickoffMeetings(prev => prev.filter(m => m.id !== id));
  };

  const addInternalMeeting = () => {
    const meetingNo = `IOM-${String(internalMeetings.length + 1).padStart(3, '0')}`;
    const meeting = {
      id: Date.now(),
      meeting_no: meetingNo,
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
    console.log('[SUBMIT] Form submit triggered');
    
    if (!form.name.trim()) {
      alert('Project name is required');
      return;
    }

    setSubmitting(true);
    console.log('[SUBMIT] Starting submission...');
    
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
        software_items: JSON.stringify(softwareItems),
        project_activities_list: JSON.stringify(projectActivities),
        planning_activities_list: JSON.stringify(planningActivities),
        documents_list: JSON.stringify(documentsList),
        input_documents_list: JSON.stringify(inputDocumentsList),
        kickoff_meetings_list: JSON.stringify(kickoffMeetings),
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

      console.log('[SUBMIT] Sending update for project:', id);
      console.log('[SUBMIT] Payload size:', JSON.stringify(payload).length, 'bytes');
      console.log('[SUBMIT] List field counts:', {
        inputDocumentsList: inputDocumentsList.length,
        documentsReceived: documentsReceived.length,
        documentsIssued: documentsIssued.length,
        projectHandover: projectHandover.length,
        projectManhours: projectManhours.length,
        queryLog: queryLog.length,
        assumptions: assumptions.length,
        lessonsLearnt: lessonsLearnt.length,
        projectSchedule: projectSchedule.length
      });
      console.log('[SUBMIT] Sample data - documentsIssued:', JSON.stringify(documentsIssued).substring(0, 200));

      console.log('[SUBMIT] Making API call to /api/projects/' + id);
      const result = await fetchJSON(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('[SUBMIT] API Response:', result);

      if (result.success) {
        console.log('[SUBMIT] Project updated successfully');
        alert('Project updated successfully!');
      } else {
        console.error('[SUBMIT] Update failed:', result);
        alert(`Failed to update project: ${result.error || result.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[SUBMIT] Project update error:', error);
      alert(`Failed to update project: ${error?.message || 'Unknown error'}`);
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
                    disabled={submitting}
                    onClick={(e) => {
                      console.log('[BUTTON] Update Project button clicked');
                      console.log('[BUTTON] Submitting state:', submitting);
                    }}
                    className="px-6 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                      letterSpacing: '0.01em'
                    }}
                    onMouseEnter={(e) => !submitting && (() => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 20px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
                    })()}
                    onMouseLeave={(e) => !submitting && (() => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                    })()}
                  >
                    {submitting ? 'Saving...' : 'Update Project'}
                  </button>
                </div>
              </div>
            </header>

            {/* Minimalistic Tab Navigation */}
            <div className="px-8 sticky z-20" style={{ top: 'calc(4rem + 5.5rem)', paddingTop: '1rem', paddingBottom: '1rem', background: '#ffffff' }}>
              <div className="rounded-lg overflow-hidden border border-gray-200" style={{
                background: '#ffffff',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
              }}>
                <div className="flex items-center gap-0 flex-wrap">
                  {TABS.map((tab, index) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className="relative px-6 py-3.5 text-sm font-medium transition-all duration-200 whitespace-nowrap flex-shrink-0"
                        style={{
                          color: isActive ? '#111827' : '#6b7280',
                          borderBottom: isActive ? '2px solid #111827' : '2px solid transparent',
                          background: isActive ? '#f9fafb' : 'transparent',
                          fontWeight: isActive ? '600' : '500'
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.color = '#111827';
                            e.currentTarget.style.background = '#fafafa';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.color = '#6b7280';
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        {tab.label}
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
                              <select
                                name="company_id"
                                value={form.company_id || ''}
                                onChange={(e) => {
                                  const companyId = e.target.value;
                                  const company = companies.find(c => c.id == companyId || c.company_id == companyId);
                                  setForm(prev => ({
                                    ...prev,
                                    company_id: companyId,
                                    client_name: company ? company.company_name : prev.client_name
                                  }));
                                }}
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300"
                                style={{
                                  background: 'rgba(255, 255, 255, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#0f172a',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
                                }}
                              >
                                <option value="">Select Company</option>
                                {companies.map(company => (
                                  <option key={company.id || company.company_id} value={company.id || company.company_id}>
                                    {company.company_name}
                                  </option>
                                ))}
                              </select>
                              <input 
                                type="text" 
                                name="client_name" 
                                value={form.client_name} 
                                onChange={handleChange} 
                                placeholder="Or enter company name manually"
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

            {/* Input Documents Tab - Inline Table Format */}
            {activeTab === 'input_documents' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
                    <h2 className="text-sm font-bold text-gray-900">Input Documents</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Manage project input documents and references</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Category</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Lot/Sub-lot</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Date</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Description</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Drawing No.</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Sheet No.</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Revision</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Unit/Qty</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Sent By</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Inline input row at top with purple background */}
                        <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                          <td className="py-2 px-2 text-center text-gray-400 font-semibold">+</td>
                          <td className="py-2 px-2">
                            <select
                              value={newInputDocument.category}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, category: e.target.value }))}
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            >
                              <option value="lot">Lot</option>
                              <option value="sublot">Sub-lot</option>
                              <option value="date">Date</option>
                              <option value="others">Others</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.category === 'lot' ? (newInputDocument.lotNumber || '') : newInputDocument.category === 'sublot' ? (newInputDocument.subLot || '') : ''}
                              onChange={(e) => {
                                if (newInputDocument.category === 'lot') {
                                  setNewInputDocument(prev => ({ ...prev, lotNumber: e.target.value }));
                                } else if (newInputDocument.category === 'sublot') {
                                  setNewInputDocument(prev => ({ ...prev, subLot: e.target.value }));
                                }
                              }}
                              disabled={newInputDocument.category !== 'lot' && newInputDocument.category !== 'sublot'}
                              placeholder={newInputDocument.category === 'lot' ? 'LOT-001' : newInputDocument.category === 'sublot' ? 'SL-001' : 'N/A'}
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] disabled:bg-gray-50 disabled:text-gray-400"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="date"
                              value={newInputDocument.date_received}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, date_received: e.target.value }))}
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.description}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, description: e.target.value }))}
                              onKeyPress={handleInputDocumentKeyPress}
                              placeholder="Description*"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.drawing_number}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, drawing_number: e.target.value }))}
                              placeholder="DWG-XXX"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.sheet_number}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, sheet_number: e.target.value }))}
                              placeholder="SH-001"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.revision_number}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, revision_number: e.target.value }))}
                              placeholder="Rev-A"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.unit_qty}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, unit_qty: e.target.value }))}
                              placeholder="10 pcs"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.document_sent_by}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, document_sent_by: e.target.value }))}
                              placeholder="Sender"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.remarks}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, remarks: e.target.value }))}
                              placeholder="Notes"
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                            />
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={addInputDocument}
                              disabled={!(newInputDocument.description && newInputDocument.description.trim())}
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newInputDocument.description && newInputDocument.description.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add document"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {inputDocumentsList.map((doc, index) => (
                          <tr key={doc.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-2 px-2 text-center text-gray-600 font-semibold">{index + 1}</td>
                            <td className="py-2 px-2">
                              <select
                                value={doc.category || 'others'}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d => 
                                    d.id === doc.id ? { ...d, category: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              >
                                <option value="lot">Lot</option>
                                <option value="sublot">Sub-lot</option>
                                <option value="date">Date</option>
                                <option value="others">Others</option>
                              </select>
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.category === 'lot' ? (doc.lotNumber || '') : doc.category === 'sublot' ? (doc.subLot || '') : ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d => {
                                    if (d.id === doc.id) {
                                      if (doc.category === 'lot') return { ...d, lotNumber: e.target.value };
                                      if (doc.category === 'sublot') return { ...d, subLot: e.target.value };
                                    }
                                    return d;
                                  });
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                disabled={doc.category !== 'lot' && doc.category !== 'sublot'}
                                placeholder={doc.category === 'lot' ? 'LOT-001' : doc.category === 'sublot' ? 'SL-001' : 'N/A'}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] disabled:bg-gray-50 disabled:text-gray-400"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="date"
                                value={doc.date_received || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, date_received: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.description || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, description: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.drawing_number || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, drawing_number: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.sheet_number || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, sheet_number: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.revision_number || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, revision_number: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.unit_qty || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, unit_qty: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.document_sent_by || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, document_sent_by: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={doc.remarks || ''}
                                onChange={(e) => {
                                  const updated = inputDocumentsList.map(d =>
                                    d.id === doc.id ? { ...d, remarks: e.target.value } : d
                                  );
                                  setInputDocumentsList(updated);
                                  setForm(prev => ({ ...prev, input_document: JSON.stringify(updated) }));
                                }}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
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
                            <th className="px-3 py-2 text-left font-semibold text-gray-700 w-12">Sr. No.</th>
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
                          {softwareItems.map((item, index) => (
                            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2 text-gray-500 font-medium">{index + 1}</td>
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
                  <p className="text-xs text-gray-500 mt-0.5">Select team members from user master for this project</p>
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
                            placeholder="Search users by name, email, or department..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent text-sm"
                          />
                        </div>

                        {/* Available Users List */}
                        {usersLoading ? (
                          <div className="text-center py-8 text-gray-500">
                            <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                            <p className="text-sm">Loading users...</p>
                          </div>
                        ) : availableUsers.length > 0 ? (
                          <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">User ID</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Email</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Role</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {availableUsers.map((user) => (
                                  <tr key={user.id} className="hover:bg-purple-50 transition-colors">
                                    <td className="px-3 py-2 text-gray-900 font-mono text-xs">{user.id}</td>
                                    <td className="px-3 py-2 text-gray-900 font-medium">{user.full_name || user.username}</td>
                                    <td className="px-3 py-2 text-gray-600">{user.email || '-'}</td>
                                    <td className="px-3 py-2 text-gray-600">{user.role_name || '-'}</td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => addTeamMember(user)}
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
                              {teamMemberSearch ? 'No users found matching your search' : 'All users have been added to the team'}
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
                            <p className="text-xs mt-1">Add team members from the user list above</p>
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
                  {/* Kickoff Meetings Table */}
                  <div className="bg-gradient-to-br from-purple-25 via-white to-purple-25 rounded-lg p-4 border border-purple-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                        Project Kickoff Meetings
                      </h4>
                      <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          placeholder="Meeting title" 
                          value={newKickoffMeetingTitle} 
                          onChange={(e) => setNewKickoffMeetingTitle(e.target.value)} 
                          className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" 
                        />
                        <button 
                          type="button" 
                          onClick={addKickoffMeeting} 
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
                          {kickoffMeetings.length === 0 ? (
                            <tr><td colSpan={9} className="text-center py-4 text-gray-500 text-sm">No kickoff meetings added</td></tr>
                          ) : (
                            kickoffMeetings.map((m, index) => (
                              <tr key={m.id} className="hover:bg-gray-50 transition-colors align-top">
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_no || ''} 
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="date" 
                                    value={m.meeting_date || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'meeting_date', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_title || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'meeting_title', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.organizer || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'organizer', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.client_representative || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'client_representative', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_location || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'meeting_location', e.target.value)} 
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <textarea 
                                    value={m.points_discussed || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'points_discussed', e.target.value)} 
                                    onBlur={(e) => handlePointsBlur(m.id, e.target.value, updateKickoffMeeting)}
                                    rows={3}
                                    placeholder="Enter points (press Enter for new bullet)&#10;Project timeline&#10;Budget discussion&#10;Next steps"
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] resize-y min-h-[60px] font-mono" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <textarea 
                                    value={m.persons_involved || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'persons_involved', e.target.value)} 
                                    onBlur={(e) => handlePointsBlur(m.id, e.target.value, updateKickoffMeeting, 'persons_involved')}
                                    rows={3}
                                    placeholder="Enter participants (press Enter for new bullet)&#10;John Doe&#10;Jane Smith&#10;Bob Johnson"
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] resize-y min-h-[60px] font-mono" 
                                  />
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <button 
                                    type="button" 
                                    onClick={() => removeKickoffMeeting(m.id)} 
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
                                  <textarea 
                                    value={m.points_discussed || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'points_discussed', e.target.value)} 
                                    onBlur={(e) => handlePointsBlur(m.id, e.target.value, updateInternalMeeting)}
                                    rows={3}
                                    placeholder="Enter points (press Enter for new bullet)&#10;Project timeline&#10;Budget discussion&#10;Next steps"
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] resize-y min-h-[60px] font-mono" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <textarea 
                                    value={m.persons_involved || ''} 
                                    onChange={(e) => updateInternalMeeting(m.id, 'persons_involved', e.target.value)} 
                                    onBlur={(e) => handlePointsBlur(m.id, e.target.value, updateInternalMeeting, 'persons_involved')}
                                    rows={3}
                                    placeholder="Enter participants (press Enter for new bullet)&#10;John Doe&#10;Jane Smith&#10;Bob Johnson"
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] resize-y min-h-[60px] font-mono" 
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
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Project Handover</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Handover checklist / outputs delivered by Accent</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Output by Accent</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Requirement Accomplished</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remark</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Hand Over</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                          <td className="py-2 px-2 text-center text-gray-400 font-semibold">+</td>
                          <td className="py-2 px-2"><input ref={newHandoverDescRef} type="text" value={newHandoverRow.output_by_accent} onChange={(e)=>setNewHandoverRow(prev=>({...prev,output_by_accent:e.target.value}))} placeholder="Output by Accent" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><select value={newHandoverRow.requirement_accomplished} onChange={(e)=>setNewHandoverRow(prev=>({...prev,requirement_accomplished:e.target.value}))} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                          <td className="py-2 px-2"><input type="text" value={newHandoverRow.remark} onChange={(e)=>setNewHandoverRow(prev=>({...prev,remark:e.target.value}))} placeholder="Remark" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><select value={newHandoverRow.hand_over} onChange={(e)=>setNewHandoverRow(prev=>({...prev,hand_over:e.target.value}))} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addHandoverRow} 
                              disabled={!(newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newHandoverRow.output_by_accent && newHandoverRow.output_by_accent.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add handover item"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {projectHandover.map((r, index) => (
                          <tr key={r.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="text" value={r.output_by_accent || ''} onChange={(e)=>updateHandoverRow(r.id,'output_by_accent', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><select value={r.requirement_accomplished || ''} onChange={(e)=>updateHandoverRow(r.id,'requirement_accomplished', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                            <td className="py-2 px-2"><input type="text" value={r.remark || ''} onChange={(e)=>updateHandoverRow(r.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><select value={r.hand_over || ''} onChange={(e)=>updateHandoverRow(r.id,'hand_over', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Y">Y</option><option value="N">N</option></select></td>
                            <td className="py-2 px-2 text-center">
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
                </div>
              </section>
            )}

            {/* Project Manhours Tab */}
            {activeTab === 'project_manhours' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Project Manhours</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Track monthly manhours per engineer/designer across activities</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Month</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Name of Engineer/Designer</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Engineering</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Designer</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Drafting</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Checking</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Co-ordation</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Site Visit</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Others</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                          <td className="py-2 px-2 text-center text-gray-400 font-semibold">+</td>
                          <td className="py-2 px-2"><input type="month" value={newManhourRow.month} onChange={(e)=>setNewManhourRow(prev=>({...prev,month:e.target.value}))} placeholder="Month" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input ref={newManhourNameRef} type="text" value={newManhourRow.name_of_engineer_designer} onChange={(e)=>setNewManhourRow(prev=>({...prev,name_of_engineer_designer:e.target.value}))} placeholder="Engineer/Designer Name" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.engineering} onChange={(e)=>setNewManhourRow(prev=>({...prev,engineering:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.designer} onChange={(e)=>setNewManhourRow(prev=>({...prev,designer:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.drafting} onChange={(e)=>setNewManhourRow(prev=>({...prev,drafting:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.checking} onChange={(e)=>setNewManhourRow(prev=>({...prev,checking:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.coordination} onChange={(e)=>setNewManhourRow(prev=>({...prev,coordination:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.site_visit} onChange={(e)=>setNewManhourRow(prev=>({...prev,site_visit:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="number" value={newManhourRow.others} onChange={(e)=>setNewManhourRow(prev=>({...prev,others:e.target.value}))} placeholder="Hrs" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newManhourRow.remarks} onChange={(e)=>setNewManhourRow(prev=>({...prev,remarks:e.target.value}))} placeholder="Remarks" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addManhourRow} 
                              disabled={!(newManhourRow.name_of_engineer_designer && newManhourRow.name_of_engineer_designer.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newManhourRow.name_of_engineer_designer && newManhourRow.name_of_engineer_designer.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add manhour row"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {projectManhours.map((r, index) => (
                          <tr key={r.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="month" value={r.month || ''} onChange={(e)=>updateManhourRow(r.id,'month', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2">
                              <select value={r.name_of_engineer_designer || ''} onChange={(e)=>updateManhourRow(r.id,'name_of_engineer_designer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent">
                                <option value="">Select Team Member</option>
                                {projectTeamMembers.map(member => (
                                  <option key={member.id} value={member.name}>{member.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 px-2"><input type="number" value={r.engineering || ''} onChange={(e)=>updateManhourRow(r.id,'engineering', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="number" value={r.designer || ''} onChange={(e)=>updateManhourRow(r.id,'designer', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="number" value={r.drafting || ''} onChange={(e)=>updateManhourRow(r.id,'drafting', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="number" value={r.checking || ''} onChange={(e)=>updateManhourRow(r.id,'checking', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="number" value={r.coordination || ''} onChange={(e)=>updateManhourRow(r.id,'coordination', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="number" value={r.site_visit || ''} onChange={(e)=>updateManhourRow(r.id,'site_visit', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="number" value={r.others || ''} onChange={(e)=>updateManhourRow(r.id,'others', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={r.remarks || ''} onChange={(e)=>updateManhourRow(r.id,'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2 text-center">
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
                </div>
              </section>
            )}

            {/* Query Log Tab */}
            {activeTab === 'query_log' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Query Log</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Log project queries and responses</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Query Description</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Issued Date</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Reply from Client</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Reply Received</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Updated By</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Resolved</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                          <td className="py-2 px-2 text-center text-gray-400 font-semibold">+</td>
                          <td className="py-2 px-2"><input ref={newQueryDescRef} type="text" value={newQuery.query_description} onChange={(e)=>setNewQuery(prev=>({...prev,query_description:e.target.value}))} placeholder="Query Description" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="date" value={newQuery.query_issued_date} onChange={(e)=>setNewQuery(prev=>({...prev,query_issued_date:e.target.value}))} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newQuery.reply_from_client} onChange={(e)=>setNewQuery(prev=>({...prev,reply_from_client:e.target.value}))} placeholder="Reply from Client" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="date" value={newQuery.reply_received_date} onChange={(e)=>setNewQuery(prev=>({...prev,reply_received_date:e.target.value}))} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newQuery.query_updated_by} onChange={(e)=>setNewQuery(prev=>({...prev,query_updated_by:e.target.value}))} placeholder="Updated By" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><select value={newQuery.query_resolved} onChange={(e)=>setNewQuery(prev=>({...prev,query_resolved:e.target.value}))} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option><option value="Pending">Pending</option></select></td>
                          <td className="py-2 px-2"><input type="text" value={newQuery.remark} onChange={(e)=>setNewQuery(prev=>({...prev,remark:e.target.value}))} placeholder="Remark" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addQueryRow} 
                              disabled={!(newQuery.query_description && newQuery.query_description.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newQuery.query_description && newQuery.query_description.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add query"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {queryLog.map((q, index) => (
                          <tr key={q.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="text" value={q.query_description || ''} onChange={(e)=>updateQueryRow(q.id,'query_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="date" value={q.query_issued_date || ''} onChange={(e)=>updateQueryRow(q.id,'query_issued_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={q.reply_from_client || ''} onChange={(e)=>updateQueryRow(q.id,'reply_from_client', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="date" value={q.reply_received_date || ''} onChange={(e)=>updateQueryRow(q.id,'reply_received_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={q.query_updated_by || ''} onChange={(e)=>updateQueryRow(q.id,'query_updated_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><select value={q.query_resolved || ''} onChange={(e)=>updateQueryRow(q.id,'query_resolved', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option><option value="Pending">Pending</option></select></td>
                            <td className="py-2 px-2"><input type="text" value={q.remark || ''} onChange={(e)=>updateQueryRow(q.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2 text-center">
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
                </div>
              </section>
            )}

            {/* Assumption Tab */}
            {activeTab === 'assumption' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Assumptions</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Record project assumptions and rationale</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Assumption Description</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Reason</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Assumption Taken By</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr className="bg-purple-25/30">
                          <td className="py-2 px-2 text-center text-gray-400">+</td>
                          <td className="py-2 px-2"><input ref={newAssumptionDescRef} type="text" value={newAssumption.assumption_description} onChange={(e)=>setNewAssumption(prev=>({...prev,assumption_description:e.target.value}))} placeholder="Assumption Description" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newAssumption.reason} onChange={(e)=>setNewAssumption(prev=>({...prev,reason:e.target.value}))} placeholder="Reason" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newAssumption.assumption_taken_by} onChange={(e)=>setNewAssumption(prev=>({...prev,assumption_taken_by:e.target.value}))} placeholder="Taken By" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newAssumption.remark} onChange={(e)=>setNewAssumption(prev=>({...prev,remark:e.target.value}))} placeholder="Remark" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addAssumptionRow} 
                              disabled={!(newAssumption.assumption_description && newAssumption.assumption_description.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newAssumption.assumption_description && newAssumption.assumption_description.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add assumption"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {assumptions.map((a, index) => (
                          <tr key={a.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="text" value={a.assumption_description || ''} onChange={(e)=>updateAssumptionRow(a.id,'assumption_description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={a.reason || ''} onChange={(e)=>updateAssumptionRow(a.id,'reason', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={a.assumption_taken_by || ''} onChange={(e)=>updateAssumptionRow(a.id,'assumption_taken_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={a.remark || ''} onChange={(e)=>updateAssumptionRow(a.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2 text-center">
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
                </div>
              </section>
            )}

            {/* Lessons Learnt Tab */}
            {activeTab === 'lessons_learnt' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Lessons Learnt</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Capture learning from the project</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">What was new</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Difficulty Faced</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">What You Learned</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Areas of Improvement</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remark</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr className="bg-purple-25/30">
                          <td className="py-2 px-2 text-center text-gray-400">+</td>
                          <td className="py-2 px-2"><input ref={newLessonDescRef} type="text" value={newLesson.what_was_new} onChange={(e)=>setNewLesson(prev=>({...prev,what_was_new:e.target.value}))} placeholder="What was new" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newLesson.difficulty_faced} onChange={(e)=>setNewLesson(prev=>({...prev,difficulty_faced:e.target.value}))} placeholder="Difficulty Faced" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newLesson.what_you_learn} onChange={(e)=>setNewLesson(prev=>({...prev,what_you_learn:e.target.value}))} placeholder="What You Learned" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newLesson.areas_of_improvement} onChange={(e)=>setNewLesson(prev=>({...prev,areas_of_improvement:e.target.value}))} placeholder="Areas of Improvement" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newLesson.remark} onChange={(e)=>setNewLesson(prev=>({...prev,remark:e.target.value}))} placeholder="Remark" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addLessonRow} 
                              disabled={!(newLesson.what_was_new && newLesson.what_was_new.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newLesson.what_was_new && newLesson.what_was_new.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add lesson"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {lessonsLearnt.map((l, index) => (
                          <tr key={l.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="text" value={l.what_was_new || ''} onChange={(e)=>updateLessonRow(l.id,'what_was_new', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={l.difficulty_faced || ''} onChange={(e)=>updateLessonRow(l.id,'difficulty_faced', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={l.what_you_learn || ''} onChange={(e)=>updateLessonRow(l.id,'what_you_learn', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={l.areas_of_improvement || ''} onChange={(e)=>updateLessonRow(l.id,'areas_of_improvement', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={l.remark || ''} onChange={(e)=>updateLessonRow(l.id,'remark', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2 text-center">
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
                </div>
              </section>
            )}

            {/* Documents Issued Tab */}
            {activeTab === 'documents_issued' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h2 className="text-sm font-bold text-gray-900">Documents Issued</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Track documents issued to client</p>
                </div>

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Document Name</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Document Number</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Revision No.</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Issue Date</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                          <td className="py-2 px-2 text-center text-gray-400 font-semibold">+</td>
                          <td className="py-2 px-2"><input ref={newIssuedDescRef} type="text" value={newIssuedDoc.document_name} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,document_name:e.target.value}))} placeholder="Document Name" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newIssuedDoc.document_number} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,document_number:e.target.value}))} placeholder="Document No." className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newIssuedDoc.revision_number} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,revision_number:e.target.value}))} placeholder="Revision" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="date" value={newIssuedDoc.issue_date} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,issue_date:e.target.value}))} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newIssuedDoc.remarks} onChange={(e)=>setNewIssuedDoc(prev=>({...prev,remarks:e.target.value}))} placeholder="Remarks" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addIssuedDocument} 
                              disabled={!(newIssuedDoc.document_name && newIssuedDoc.document_name.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newIssuedDoc.document_name && newIssuedDoc.document_name.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add document"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {documentsIssued.map((d, index) => (
                          <tr key={d.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="text" value={d.document_name || ''} onChange={(e) => updateIssuedDocument(d.id, 'document_name', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.document_number || ''} onChange={(e) => updateIssuedDocument(d.id, 'document_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.revision_number || ''} onChange={(e) => updateIssuedDocument(d.id, 'revision_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="date" value={d.issue_date || ''} onChange={(e) => updateIssuedDocument(d.id, 'issue_date', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.remarks || ''} onChange={(e) => updateIssuedDocument(d.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                            <td className="py-2 px-2 text-center">
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

                <div className="px-6 py-5">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                        <tr>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Sr No</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Date</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Description / Document Name</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Drawing Number</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Revision Number</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Unit / Qty</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Sent By</th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">Remarks</th>
                          <th className="text-center py-2 px-2 font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                          <td className="py-2 px-2 text-center text-gray-400 font-semibold">+</td>
                          <td className="py-2 px-2"><input type="date" value={newReceivedDoc.date_received} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,date_received:e.target.value}))} placeholder="Date" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input ref={newReceivedDescRef} type="text" value={newReceivedDoc.description} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,description:e.target.value}))} placeholder="Document Name" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newReceivedDoc.drawing_number} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,drawing_number:e.target.value}))} placeholder="Drawing No." className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newReceivedDoc.revision_number} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,revision_number:e.target.value}))} placeholder="Rev. No." className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newReceivedDoc.unit_qty} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,unit_qty:e.target.value}))} placeholder="Unit/Qty" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newReceivedDoc.document_sent_by} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,document_sent_by:e.target.value}))} placeholder="Sent By" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2"><input type="text" value={newReceivedDoc.remarks} onChange={(e)=>setNewReceivedDoc(prev=>({...prev,remarks:e.target.value}))} placeholder="Remarks" className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]" /></td>
                          <td className="py-2 px-2 text-center">
                            <button 
                              type="button" 
                              onClick={addReceivedDocument} 
                              disabled={!(newReceivedDoc.description && newReceivedDoc.description.trim())} 
                              className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newReceivedDoc.description && newReceivedDoc.description.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                              title="Add document"
                            >
                              Add
                            </button>
                          </td>
                        </tr>
                        {documentsReceived.map((d, index) => (
                          <tr key={d.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="py-2 px-2 text-center">{index + 1}</td>
                            <td className="py-2 px-2"><input type="date" value={d.date_received || ''} onChange={(e) => updateReceivedDocument(d.id, 'date_received', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.description || ''} onChange={(e) => updateReceivedDocument(d.id, 'description', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.drawing_number || ''} onChange={(e) => updateReceivedDocument(d.id, 'drawing_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.revision_number || ''} onChange={(e) => updateReceivedDocument(d.id, 'revision_number', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.unit_qty || ''} onChange={(e) => updateReceivedDocument(d.id, 'unit_qty', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.document_sent_by || ''} onChange={(e) => updateReceivedDocument(d.id, 'document_sent_by', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2"><input type="text" value={d.remarks || ''} onChange={(e) => updateReceivedDocument(d.id, 'remarks', e.target.value)} className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent" /></td>
                            <td className="py-2 px-2 text-center">
                              <button 
                                type="button" 
                                onClick={() => removeReceivedDocument(d.id)} 
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
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                {/* Header */}
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Project Activities</h2>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">{projectActivities.length} items</span>
                    <span className="text-blue-600 font-medium">{projectActivities.reduce((sum, a) => sum + (parseFloat(a.planned_hours) || 0), 0).toFixed(1)}h planned</span>
                    <span className="text-amber-600 font-medium">{projectActivities.reduce((sum, a) => sum + (parseFloat(a.actual_hours) || 0), 0).toFixed(1)}h actual</span>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* Quick Add - From Master Dropdown */}
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={newScopeActivityName} 
                      onChange={(e) => setNewScopeActivityName(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addScopeActivity()}
                      placeholder="Add manual activity..." 
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500" 
                    />
                    <button 
                      type="button" 
                      onClick={addScopeActivity}
                      disabled={!newScopeActivityName.trim()}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                    {functions.length > 0 && (
                      <select
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!value) return;
                          
                          // Format: act|functionId|activityId
                          const [, funcId, actId] = value.split('|');
                          const func = functions.find(f => String(f.id) === funcId);
                          const activity = func?.activities?.find(a => String(a.id) === actId);
                          
                          if (activity && func) {
                            const exists = projectActivities.some(pa => String(pa.id) === actId && pa.type === 'activity');
                            if (!exists) {
                              setProjectActivities(prev => [...prev, {
                                id: activity.id,
                                type: 'activity',
                                source: 'master',
                                name: activity.activity_name,
                                discipline: func.function_name,
                                discipline_id: func.id,
                                activity_name: activity.activity_name,
                                planned_hours: activity.default_manhours || 0,
                                actual_hours: 0,
                                assigned_user: '',
                                due_date: '',
                                priority: 'MEDIUM',
                                status: 'Not Started',
                                function_name: func.function_name
                              }]);
                            }
                          }
                          e.target.value = '';
                        }}
                        className="w-64 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="">Select from Master...</option>
                        {functions.map(func => (
                          <optgroup key={func.id} label={`📁 ${func.function_name}`}>
                            {(func.activities || []).map(activity => (
                              <option 
                                key={activity.id}
                                value={`act|${func.id}|${activity.id}`}
                                disabled={projectActivities.some(pa => String(pa.id) === String(activity.id) && pa.type === 'activity')}
                              >
                                {activity.activity_name} {activity.default_manhours ? `(${activity.default_manhours}h)` : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Activities Grouped by Discipline */}
                  {projectActivities.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <DocumentIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No activities yet</p>
                      <p className="text-sm mt-1">Select from master or add manually</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Group activities by discipline */}
                      {(() => {
                        const grouped = projectActivities.reduce((acc, act) => {
                          const discipline = act.discipline || act.function_name || 'Manual Entry';
                          if (!acc[discipline]) acc[discipline] = [];
                          acc[discipline].push(act);
                          return acc;
                        }, {});

                        return Object.entries(grouped).map(([discipline, acts]) => (
                          <div key={discipline} className="border border-gray-200 rounded-lg overflow-hidden">
                            {/* Discipline Header */}
                            <div className="bg-purple-50 px-4 py-2 border-b border-purple-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <DocumentIcon className="h-4 w-4 text-purple-600" />
                                <span className="font-semibold text-purple-800">{discipline}</span>
                                <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                                  {acts.length} {acts.length === 1 ? 'activity' : 'activities'}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-blue-600 font-medium">
                                  {acts.reduce((sum, a) => sum + (parseFloat(a.planned_hours) || 0), 0).toFixed(1)}h plan
                                </span>
                                <span className="text-amber-600 font-medium">
                                  {acts.reduce((sum, a) => sum + (parseFloat(a.actual_hours) || 0), 0).toFixed(1)}h actual
                                </span>
                              </div>
                            </div>

                            {/* Activities Table */}
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 text-gray-600">
                                <tr>
                                  <th className="text-left py-2 px-3 font-medium w-8">#</th>
                                  <th className="text-left py-2 px-3 font-medium">Activity Name</th>
                                  <th className="text-left py-2 px-3 font-medium w-32">Assigned To</th>
                                  <th className="text-left py-2 px-3 font-medium w-28">Due Date</th>
                                  <th className="text-left py-2 px-3 font-medium w-28">Status</th>
                                  <th className="text-center py-2 px-3 font-medium w-20">Plan (h)</th>
                                  <th className="text-center py-2 px-3 font-medium w-20">Actual (h)</th>
                                  <th className="w-10"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {acts.map((act, idx) => (
                                  <tr key={`${act.id}-${act.type}-${idx}`} className="hover:bg-gray-50">
                                    <td className="py-2 px-3 text-gray-400">{idx + 1}</td>
                                    <td className="py-2 px-3">
                                      <input 
                                        type="text" 
                                        value={act.activity_name || act.name || ''} 
                                        onChange={(e) => updateScopeActivity(act.id, 'activity_name', e.target.value)} 
                                        className="w-full px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-gray-800" 
                                        placeholder="Activity name"
                                      />
                                    </td>
                                    <td className="py-2 px-3">
                                      <select
                                        value={act.assigned_user || ''}
                                        onChange={(e) => updateScopeActivity(act.id, 'assigned_user', e.target.value)}
                                        className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:border-purple-500"
                                      >
                                        <option value="">Select...</option>
                                        {userMaster.map(user => (
                                          <option key={user.id} value={user.id}>
                                            {user.full_name || user.employee_name || user.username}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="py-2 px-3">
                                      <input 
                                        type="date" 
                                        value={act.due_date || ''} 
                                        onChange={(e) => updateScopeActivity(act.id, 'due_date', e.target.value)} 
                                        className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:border-purple-500" 
                                      />
                                    </td>
                                    <td className="py-2 px-3">
                                      <select
                                        value={act.status || 'Not Started'}
                                        onChange={(e) => updateScopeActivity(act.id, 'status', e.target.value)}
                                        className={`w-full px-2 py-1 text-xs border rounded font-medium ${
                                          act.status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                          act.status === 'In Progress' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                          act.status === 'On Hold' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                          'bg-gray-50 text-gray-600 border-gray-200'
                                        }`}
                                      >
                                        <option value="Not Started">Not Started</option>
                                        <option value="In Progress">In Progress</option>
                                        <option value="Completed">Completed</option>
                                        <option value="On Hold">On Hold</option>
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
                                        className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:border-purple-500 bg-blue-50 text-blue-700 font-medium" 
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
                                        className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:border-purple-500 bg-amber-50 text-amber-700 font-medium" 
                                      />
                                    </td>
                                    <td className="py-2 px-3">
                                      <button 
                                        type="button" 
                                        onClick={() => removeScopeActivity(act.id)} 
                                        className="p-1 text-gray-400 hover:text-red-500"
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ));
                      })()}

                      {/* Summary Footer */}
                      <div className="bg-gray-100 rounded-lg p-3 flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-700">
                          Total: {projectActivities.length} activities across {Object.keys(projectActivities.reduce((acc, a) => { acc[a.discipline || a.function_name || 'Manual'] = true; return acc; }, {})).length} disciplines
                        </span>
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <span className="text-gray-500">Planned:</span>
                            <span className="font-bold text-blue-600">{projectActivities.reduce((sum, a) => sum + (parseFloat(a.planned_hours) || 0), 0).toFixed(1)}h</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="text-gray-500">Actual:</span>
                            <span className="font-bold text-amber-600">{projectActivities.reduce((sum, a) => sum + (parseFloat(a.actual_hours) || 0), 0).toFixed(1)}h</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Discussion Tab */}
            {activeTab === 'discussion' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <ProjectFollowupsForm projectId={id} projectTeamMembers={projectTeamMembers} currentUser={sessionUser} />
              </section>
            )}

            {/* Scope of Work Tab */}
            {activeTab === 'scope' && (
              <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <DocumentIcon className="h-5 w-5 text-[#7F2487]" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">Scope of Work</h2>
                        <p className="text-xs text-gray-500">Define and manage project scope details</p>
                      </div>
                    </div>
                    {/* Scope Summary Badge */}
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                        {form.scope_of_work ? 'Original Scope Defined' : 'No Original Scope'}
                      </span>
                      {form.additional_scope && (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
                          Additional Scope Added
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="px-6 py-6 space-y-6">
                  {/* Original Scope Section */}
                  <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-5 border border-gray-200">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">1</span>
                      <label className="text-sm font-bold text-gray-800">Original Project Scope</label>
                      <span className="text-xs text-gray-400 ml-2">(from Proposal)</span>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm min-h-[120px]">
                      {form.scope_of_work || form.description ? (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{form.scope_of_work || form.description}</p>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-gray-400">
                          <DocumentIcon className="h-8 w-8 mb-2" />
                          <p className="text-sm">No original scope defined yet</p>
                          <p className="text-xs">Scope will be fetched from linked proposal</p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"></path></svg>
                      Original scope is linked to the proposal and can be edited in Project Details tab.
                    </p>
                  </div>

                  {/* Additional Scope Section - Bullet Points */}
                  <div className="bg-gradient-to-br from-amber-50/50 to-orange-50/30 rounded-xl p-5 border border-amber-200">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">2</span>
                        <label className="text-sm font-bold text-gray-800">Additional Scope Items</label>
                        <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Change Orders / Variations</span>
                      </div>
                      {(() => {
                        const items = (form.additional_scope || '').split('\n').filter(item => item.trim());
                        return items.length > 0 && (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircleIcon className="w-4 h-4" />
                            {items.length} item{items.length > 1 ? 's' : ''}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Add New Item - Right below heading */}
                    <div className="flex gap-2 mb-4">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500">•</span>
                        <input
                          type="text"
                          id="additional-scope-input"
                          placeholder="Type new scope item and press Enter or click Add..."
                          className="w-full pl-7 pr-4 py-2.5 text-sm border border-amber-200 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487] bg-white placeholder:text-gray-400"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              e.preventDefault();
                              const newItem = e.target.value.trim();
                              const currentItems = (form.additional_scope || '').split('\n').filter(item => item.trim());
                              const updatedScope = [...currentItems, newItem].join('\n');
                              setForm(prev => ({ ...prev, additional_scope: updatedScope }));
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const input = document.getElementById('additional-scope-input');
                          if (input && input.value.trim()) {
                            const newItem = input.value.trim();
                            const currentItems = (form.additional_scope || '').split('\n').filter(item => item.trim());
                            const updatedScope = [...currentItems, newItem].join('\n');
                            setForm(prev => ({ ...prev, additional_scope: updatedScope }));
                            input.value = '';
                            input.focus();
                          }
                        }}
                        className="px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium flex items-center gap-1"
                      >
                        <PlusIcon className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                    
                    {/* Existing Items List */}
                    <div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
                      {(() => {
                        const items = (form.additional_scope || '').split('\n').filter(item => item.trim());
                        if (items.length === 0) {
                          return (
                            <div className="p-6 text-center text-gray-400">
                              <DocumentIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No additional scope items added yet</p>
                              <p className="text-xs mt-1">Use the field above to add items</p>
                            </div>
                          );
                        }
                        return (
                          <ul className="divide-y divide-amber-100">
                            {items.map((item, idx) => (
                              <li key={idx} className="flex items-start gap-3 px-4 py-3 hover:bg-amber-50/50 group">
                                <span className="flex-shrink-0 w-5 h-5 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
                                  {idx + 1}
                                </span>
                                <span className="flex-1 text-sm text-gray-700">{item.replace(/^[•\-\*]\s*/, '')}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newItems = items.filter((_, i) => i !== idx);
                                    setForm(prev => ({ ...prev, additional_scope: newItems.join('\n') }));
                                  }}
                                  className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Remove item"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>

                    <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"></path></svg>
                      Press Enter or click Add to add scope items. Document changes, amendments, or additional work.
                    </p>
                  </div>

                  {/* Combined Scope Preview */}
                  {(form.scope_of_work || form.description || form.additional_scope) && (
                    <div className="bg-gradient-to-br from-purple-50/50 to-blue-50/30 rounded-xl p-5 border border-purple-200">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">📋</span>
                        <label className="text-sm font-bold text-gray-800">Complete Scope Overview</label>
                      </div>
                      <div className="bg-white rounded-lg p-4 border border-purple-100 shadow-sm space-y-4">
                        {(form.scope_of_work || form.description) && (
                          <div>
                            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Original Scope</p>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{form.scope_of_work || form.description}</p>
                          </div>
                        )}
                        {form.additional_scope && (
                          <div className={form.scope_of_work || form.description ? 'pt-3 border-t border-gray-200' : ''}>
                            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">Additional Scope Items</p>
                            <ul className="space-y-1.5">
                              {form.additional_scope.split('\n').filter(item => item.trim()).map((item, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                                  <span className="text-amber-500 mt-0.5">•</span>
                                  <span>{item.replace(/^[•\-\*]\s*/, '')}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Quick Tips */}
                  <div className="bg-blue-50/50 rounded-lg p-4 border border-blue-100">
                    <p className="text-xs font-semibold text-blue-800 mb-2">💡 Scope Management Tips</p>
                    <ul className="text-xs text-blue-700 space-y-1">
                      <li>• Document all scope changes with dates and approval references</li>
                      <li>• Link additional scope items to change orders or client emails</li>
                      <li>• Track impact on timeline and budget in Commercial tab</li>
                      <li>• Update Project Activities tab when scope changes</li>
                    </ul>
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

// Project Discussion Form Component - Compact Table-only Design
function ProjectFollowupsForm({ projectId, projectTeamMembers = [], currentUser }) {
  const [discussions, setDiscussions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    follow_up_date: new Date().toISOString().split('T')[0],
    description: '',
    responsible_person: '',
    logged_by: currentUser?.full_name || currentUser?.username || ''
  });

  const fetchDiscussions = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/followups`);
      const data = await res.json();
      if (data?.success) setDiscussions(data.data || []);
    } catch (e) {
      console.error('Error fetching discussions:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDiscussions();
  }, [fetchDiscussions]);

  useEffect(() => {
    if (currentUser) {
      setFormData(prev => {
        if (!prev.logged_by) {
          return { ...prev, logged_by: currentUser.full_name || currentUser.username || '' };
        }
        return prev;
      });
    }
  }, [currentUser]);

  const resetForm = () => {
    setFormData({
      follow_up_date: new Date().toISOString().split('T')[0],
      description: '',
      responsible_person: '',
      logged_by: currentUser?.full_name || currentUser?.username || ''
    });
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!formData.follow_up_date || !formData.description.trim()) {
      alert('Please fill in date and topic');
      return;
    }

    try {
      const url = `/api/projects/${projectId}/followups`;
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId 
        ? { id: editingId, ...formData }
        : formData;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      
      if (data?.success) {
        resetForm();
        fetchDiscussions();
      } else {
        alert(data?.error || 'Failed to save discussion');
      }
    } catch (e) {
      console.error('Error saving discussion:', e);
      alert('Failed to save discussion');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this discussion?')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/followups?followup_id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data?.success) {
        fetchDiscussions();
      } else {
        alert(data?.error || 'Failed to delete');
      }
    } catch (e) {
      console.error('Error deleting discussion:', e);
      alert('Failed to delete discussion');
    }
  };

  const handleEdit = (item) => {
    setFormData({
      follow_up_date: item.follow_up_date?.split('T')[0] || '',
      description: item.description || '',
      responsible_person: item.responsible_person || '',
      logged_by: item.logged_by || item.created_by || ''
    });
    setEditingId(item.id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="h-5 w-5 text-purple-600" />
          Discussion
        </h3>
        <span className="text-sm text-gray-500">{discussions.length} entries</span>
      </div>

      {/* Table with Add Row */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-12">S.No</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-28">Date</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Topic</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-40">Participants</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-32">Logged By</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {/* Add/Edit Input Row */}
            <tr className="bg-purple-50 border-b-2 border-purple-200">
              <td className="px-3 py-2 text-gray-400 text-xs">{editingId ? '#' : 'New'}</td>
              <td className="px-3 py-2">
                <input
                  type="date"
                  value={formData.follow_up_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, follow_up_date: e.target.value }))}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Discussion topic..."
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  value={formData.responsible_person}
                  onChange={(e) => setFormData(prev => ({ ...prev, responsible_person: e.target.value }))}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">Select...</option>
                  {projectTeamMembers.map(member => (
                    <option key={member.id} value={member.name}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={formData.logged_by}
                  onChange={(e) => setFormData(prev => ({ ...prev, logged_by: e.target.value }))}
                  placeholder="Your name"
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500 bg-gray-50"
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-center gap-1">
                  {editingId && (
                    <button
                      onClick={resetForm}
                      className="px-2 py-1 text-gray-600 hover:bg-gray-200 rounded text-xs"
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleSubmit}
                    className="px-3 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700"
                  >
                    {editingId ? 'Update' : 'Add'}
                  </button>
                </div>
              </td>
            </tr>

            {/* Data Rows */}
            {discussions.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-3 py-8 text-center text-gray-400">
                  No discussions yet. Add one above.
                </td>
              </tr>
            ) : (
              discussions.map((item, index) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-gray-500 font-medium">{index + 1}</td>
                  <td className="px-3 py-2.5 text-gray-900">
                    {item.follow_up_date ? new Date(item.follow_up_date).toLocaleDateString('en-IN', { 
                      day: '2-digit', month: 'short', year: 'numeric'
                    }) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{item.description || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-700 text-sm">{item.responsible_person || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600 text-sm">{item.logged_by || item.created_by || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleEdit(item)}
                        className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                        title="Edit"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1 text-red-500 hover:bg-red-100 rounded transition-colors"
                        title="Delete"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
