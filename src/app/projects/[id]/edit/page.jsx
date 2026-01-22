 'use client';

// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Suspense, useEffect, useMemo, useState, Fragment, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon, PlusIcon, TrashIcon, CheckCircleIcon, ChevronDownIcon, DocumentIcon, XMarkIcon, UserIcon, ClockIcon, ChatBubbleLeftRightIcon, CheckIcon, PhoneIcon, EnvelopeIcon, CalendarIcon, ClipboardDocumentListIcon, MagnifyingGlassIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
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
  { id: 'project_activity', label: 'Project Activity', adminOnly: true },
  { id: 'my_activities', label: 'My Activities', userOnly: true },
  { id: 'documents_issued', label: 'Documents Issued' },
  { id: 'project_handover', label: 'Project Handover' },
  { id: 'project_manhours', label: 'Project Manhours' },
  { id: 'query_log', label: 'Query Log' },
  { id: 'assumption', label: 'Assumption' },
  { id: 'lessons_learnt', label: 'Lessons Learnt' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'quotation', label: 'Quotation', requiresPermission: 'quotations' },
  { id: 'purchase_order', label: 'Purchase Order', requiresPermission: 'purchase_orders' },
  { id: 'invoice', label: 'Invoice', requiresPermission: 'invoices' }
];

const TYPE_OPTIONS = ['ONGOING', 'CONSULTANCY', 'EPC', 'PMC'];
const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_TERMS_OPTIONS = ['Net 30', 'Net 45', 'Net 60', 'Advance'];
const INVOICING_STATUS_OPTIONS = ['Uninvoiced', 'Partially Invoiced', 'Invoiced', 'Paid'];
const PROCUREMENT_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed', 'On Hold'];
const DOCUMENTATION_STATUS_OPTIONS = ['Not Started', 'Drafted', 'Reviewed', 'Finalized'];

function LoadingFallback() {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-white flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          {/* Animated spinner */}
          <div className="relative inline-flex mb-6">
            <div className="w-16 h-16 rounded-full border-4 border-gray-200"></div>
            <div className="absolute top-0 left-0 w-16 h-16 rounded-full border-4 border-transparent border-t-violet-500 border-r-violet-500 animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-6 h-6 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          
          {/* Loading text */}
          <div className="space-y-2">
            <p className="text-base font-medium text-gray-700">Loading Project</p>
            <p className="text-sm text-gray-400">
              Fetching project data<span className="loading-dots">...</span>
            </p>
            <p className="text-xs text-gray-400 mt-3 font-mono bg-gray-100 px-3 py-1 rounded-full inline-block">
              ⏱️ {formatTime(elapsed)}
            </p>
          </div>
        </div>
      </div>
      
      {/* Loading animation styles */}
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        .loading-dots::after {
          content: '';
          animation: dots 1.5s steps(4, end) infinite;
        }
        @keyframes dots {
          0%, 20% { content: ''; }
          40% { content: '.'; }
          60% { content: '..'; }
          80%, 100% { content: '...'; }
        }
      `}</style>
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
  const { user: sessionUser, can, RESOURCES, PERMISSIONS } = useSession();
  
  // Check if super admin (override all permissions)
  const isSuperAdmin = sessionUser?.is_super_admin === true || sessionUser?.is_super_admin === 1;
  
  // Permission checks for financial documents (super admin has all permissions)
  const canViewQuotations = isSuperAdmin || can(RESOURCES.QUOTATIONS, PERMISSIONS.READ) || can(RESOURCES.QUOTATIONS, PERMISSIONS.UPDATE);
  const canEditQuotations = isSuperAdmin || can(RESOURCES.QUOTATIONS, PERMISSIONS.UPDATE);
  const canViewPurchaseOrders = isSuperAdmin || can(RESOURCES.PURCHASE_ORDERS, PERMISSIONS.READ) || can(RESOURCES.PURCHASE_ORDERS, PERMISSIONS.UPDATE);
  const canEditPurchaseOrders = isSuperAdmin || can(RESOURCES.PURCHASE_ORDERS, PERMISSIONS.UPDATE);
  const canViewInvoices = isSuperAdmin || can(RESOURCES.INVOICES, PERMISSIONS.READ) || can(RESOURCES.INVOICES, PERMISSIONS.UPDATE);
  const canEditInvoices = isSuperAdmin || can(RESOURCES.INVOICES, PERMISSIONS.UPDATE);

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
  
  // Multi-select activity checkbox state
  const [showActivitySelector, setShowActivitySelector] = useState(false);
  const [selectedActivitiesForAdd, setSelectedActivitiesForAdd] = useState({});
  const [activitySelectorSearch, setActivitySelectorSearch] = useState('');
  
  // Multi-select user assignment state (for assigning multiple users to one activity)
  const [openUserSelectorForActivity, setOpenUserSelectorForActivity] = useState(null);
  const userSelectorRef = useRef(null);
  
  // Close user selector dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openUserSelectorForActivity !== null) {
        // Check if click is outside the dropdown
        const dropdowns = document.querySelectorAll('[data-user-selector-dropdown]');
        let clickedInside = false;
        dropdowns.forEach(dropdown => {
          if (dropdown.contains(event.target)) {
            clickedInside = true;
          }
        });
        if (!clickedInside) {
          setOpenUserSelectorForActivity(null);
        }
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openUserSelectorForActivity]);

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

  // Project Manhours - structured by month with employee entries
  const [projectManhours, setProjectManhours] = useState([{
    id: Date.now(),
    employee_id: '',
    employee_name: '',
    salary_type: '',
    rate_company: '',
    rate_accent: '',
    monthly_hours: {}
  }]);
  // State for adding new months - multiple selection
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [monthRangeStart, setMonthRangeStart] = useState('');
  const [monthRangeEnd, setMonthRangeEnd] = useState('');
  // State for employees with salary profiles (for rate lookup)
  const [employeesWithRates, setEmployeesWithRates] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  // Cache for attendance hours to avoid re-fetching
  const [attendanceHoursCache, setAttendanceHoursCache] = useState({});
  // New entry form for adding employee hours within a month
  const [newManhourEntry, setNewManhourEntry] = useState({
    employee_id: '',
    employee_name: '',
    rate: '',
    salary_type: '',
    hours: ''
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

  // Quotation tab state
  const [quotationData, setQuotationData] = useState({
    quotation_number: '',
    quotation_date: '',
    client_name: '',
    enquiry_number: '',
    enquiry_quantity: '',
    scope_of_work: '',
    gross_amount: '',
    gst_percentage: 18,
    gst_amount: '',
    net_amount: ''
  });
  const [quotationSaving, setQuotationSaving] = useState(false);

  // Purchase Order tab state
  const [purchaseOrderData, setPurchaseOrderData] = useState({
    po_number: '',
    po_date: '',
    client_name: '',
    vendor_name: '',
    vendor_id: '',
    delivery_date: '',
    scope_of_work: '',
    gross_amount: '',
    gst_percentage: 18,
    gst_amount: '',
    net_amount: '',
    payment_terms: '',
    remarks: ''
  });
  const [purchaseOrderSaving, setPurchaseOrderSaving] = useState(false);
  
  // Vendors state for PO dropdown
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [loadingVendors, setLoadingVendors] = useState(false);

  // Invoice tab state
  const [invoiceData, setInvoiceData] = useState({
    invoice_number: '',
    invoice_date: '',
    client_name: '',
    po_number: '',
    po_date: '',
    po_amount: '',
    total_invoiced: 0,
    balance_amount: '',
    scope_of_work: '',
    payment_due_date: ''
  });
  const [invoices, setInvoices] = useState([]);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('');

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

        // Fetch vendors for Purchase Order dropdown
        try {
          setLoadingVendors(true);
          const vendorsData = await fetchJSON('/api/vendors');
          if (vendorsData.success) {
            setVendors(vendorsData.data || []);
          }
        } catch (err) {
          console.warn('Failed to fetch vendors', err);
        } finally {
          setLoadingVendors(false);
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
        // Use optimized /api/projects/{id}/detail endpoint for better TTFB
        const result = await fetchJSON(`/api/projects/${id}/detail`);
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
              // Ensure assigned_users is always an array for each activity
              const activitiesWithUsers = (Array.isArray(parsed) ? parsed : []).map(act => ({
                ...act,
                assigned_users: Array.isArray(act.assigned_users) ? act.assigned_users : []
              }));
              setProjectActivities(activitiesWithUsers);
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

            // Load project manhours list - supports both old flat format and new month-grouped format
            if (project.project_manhours_list) {
              try {
                const parsed = typeof project.project_manhours_list === 'string'
                  ? JSON.parse(project.project_manhours_list)
                  : project.project_manhours_list;
                
                if (Array.isArray(parsed) && parsed.length > 0) {
                  // Check if it's the new format (has 'month' and 'entries' keys)
                  const isNewFormat = parsed[0] && 'entries' in parsed[0];
                  
                  if (isNewFormat) {
                    // Already in new format
                    setProjectManhours(parsed);
                  } else {
                    // Old format - migrate to new format by grouping by month
                    const groupedByMonth = {};
                    parsed.forEach(row => {
                      const month = row.month || 'unknown';
                      if (!groupedByMonth[month]) {
                        groupedByMonth[month] = {
                          id: Date.now() + Math.random(),
                          month: month,
                          entries: []
                        };
                      }
                      // Convert old row to new entry format
                      groupedByMonth[month].entries.push({
                        id: row.id || Date.now() + Math.random(),
                        employee_id: null, // Old format didn't have this
                        employee_name: row.name_of_engineer_designer || '',
                        rate: 0, // Old format didn't track rate
                        salary_type: 'monthly',
                        // Sum all hour categories from old format
                        hours: (parseFloat(row.engineering) || 0) + 
                               (parseFloat(row.designer) || 0) + 
                               (parseFloat(row.drafting) || 0) + 
                               (parseFloat(row.checking) || 0) + 
                               (parseFloat(row.coordination) || 0) + 
                               (parseFloat(row.site_visit) || 0) + 
                               (parseFloat(row.others) || 0),
                        total_cost: 0,
                        // Preserve old data in legacy field
                        legacy_data: {
                          engineering: row.engineering,
                          designer: row.designer,
                          drafting: row.drafting,
                          checking: row.checking,
                          coordination: row.coordination,
                          site_visit: row.site_visit,
                          others: row.others,
                          remarks: row.remarks
                        }
                      });
                    });
                    setProjectManhours(Object.values(groupedByMonth));
                  }
                } else {
                  setProjectManhours([]);
                }
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

  // Fetch employees with their salary profiles for manhours rate lookup
  // Function to fetch attendance hours for an employee for a given year
  const fetchAttendanceHours = async (employeeId, year = new Date().getFullYear()) => {
    // Check cache first
    const cacheKey = `${employeeId}_${year}`;
    if (attendanceHoursCache[cacheKey]) {
      return attendanceHoursCache[cacheKey];
    }
    
    try {
      const res = await fetch(`/api/attendance?employee_id=${employeeId}&year=${year}`);
      const json = await res.json();
      
      if (json?.success && Array.isArray(json.records)) {
        const monthlyHours = { jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0 };
        const monthMap = { '01': 'jan', '02': 'feb', '03': 'mar', '04': 'apr', '05': 'may', '06': 'jun', '07': 'jul', '08': 'aug', '09': 'sep', '10': 'oct', '11': 'nov', '12': 'dec' };
        
        json.records.forEach(record => {
          if (record.status === 'P' || record.status === 'HD' || record.status === 'OT') {
            const date = new Date(record.attendance_date);
            const monthKey = monthMap[String(date.getMonth() + 1).padStart(2, '0')];
            
            // Calculate hours from in_time and out_time
            let hours = 8; // Default 8 hours if no time data
            if (record.in_time && record.out_time) {
              const [inH, inM] = record.in_time.split(':').map(Number);
              const [outH, outM] = record.out_time.split(':').map(Number);
              const inDecimal = inH + (inM / 60);
              const outDecimal = outH + (outM / 60);
              if (outDecimal > inDecimal) {
                hours = outDecimal - inDecimal;
                if (record.status === 'HD') hours = hours / 2; // Half day
              }
            }
            
            monthlyHours[monthKey] += hours;
          }
        });
        
        // Round to 1 decimal place
        Object.keys(monthlyHours).forEach(key => {
          monthlyHours[key] = parseFloat(monthlyHours[key].toFixed(1));
        });
        
        // Cache the result
        setAttendanceHoursCache(prev => ({ ...prev, [cacheKey]: monthlyHours }));
        return monthlyHours;
      }
    } catch (error) {
      console.error('Failed to fetch attendance hours:', error);
    }
    return null;
  };

  useEffect(() => {
    const fetchEmployeesWithRates = async () => {
      setEmployeesLoading(true);
      try {
        // Fetch employees list from employee master
        const empRes = await fetch('/api/employee-master/list?limit=2000');
        const empJson = await empRes.json();
        
        if (empJson?.success && Array.isArray(empJson.data)) {
          // First, set employees immediately without rates so UI is responsive
          const basicEmployeesData = empJson.data.map(emp => ({
            id: emp.id,
            name: emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.email || `Employee ${emp.id}`,
            employee_id: emp.employee_id,
            department: emp.department,
            workplace: emp.workplace,
            rate: 0,
            salary_type: 'monthly'
          }));
          setEmployeesWithRates(basicEmployeesData);
          setEmployeesLoading(false);
          
          // Then fetch salary profiles in batches to get rates
          const batchSize = 10;
          const updatedEmployees = [...basicEmployeesData];
          
          for (let i = 0; i < empJson.data.length; i += batchSize) {
            const batch = empJson.data.slice(i, i + batchSize);
            
            await Promise.all(
              batch.map(async (emp, batchIndex) => {
                try {
                  const salaryRes = await fetch(`/api/payroll/salary-profile?employee_id=${emp.id}`);
                  const salaryJson = await salaryRes.json();
                  
                  const latestProfile = salaryJson?.data?.[0] || null;
                  
                  let rate = 0;
                  let salaryType = 'monthly';
                  
                  if (latestProfile) {
                    salaryType = latestProfile.salary_type || 'monthly';
                    
                    if (salaryType === 'hourly') {
                      rate = parseFloat(latestProfile.hourly_rate) || 0;
                    } else if (salaryType === 'daily') {
                      rate = parseFloat(latestProfile.daily_rate) || 0;
                    } else if (salaryType === 'custom') {
                      try {
                        const customData = latestProfile.lumpsum_description ? JSON.parse(latestProfile.lumpsum_description) : {};
                        rate = parseFloat(customData.hourly_rate) || parseFloat(latestProfile.hourly_rate) || 0;
                      } catch {
                        rate = parseFloat(latestProfile.hourly_rate) || 0;
                      }
                    } else {
                      const grossSalary = parseFloat(latestProfile.gross_salary) || parseFloat(latestProfile.employer_cost) || 0;
                      const stdWorkingDays = parseFloat(latestProfile.std_working_days) || 26;
                      const stdHoursPerDay = parseFloat(latestProfile.std_hours_per_day) || 8;
                      rate = grossSalary > 0 ? parseFloat((grossSalary / (stdWorkingDays * stdHoursPerDay)).toFixed(2)) : 0;
                    }
                  }
                  
                  const globalIndex = i + batchIndex;
                  updatedEmployees[globalIndex] = {
                    ...updatedEmployees[globalIndex],
                    rate: rate,
                    salary_type: salaryType
                  };
                } catch (err) {
                  console.error(`Failed to fetch salary for employee ${emp.id}:`, err);
                }
              })
            );
            
            // Update state after each batch
            setEmployeesWithRates([...updatedEmployees]);
          }
        } else {
          console.error('Failed to fetch employees:', empJson);
          setEmployeesLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch employees with rates:', error);
        setEmployeesLoading(false);
      }
    };
    
    fetchEmployeesWithRates();
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

  // Quotation Form Handlers
  const handleQuotationChange = (e) => {
    if (!canEditQuotations) return; // Prevent changes if no edit permission
    const { name, value } = e.target;
    setQuotationData(prev => {
      const updated = { ...prev, [name]: value };
      
      // Auto-calculate GST and net amount when gross amount changes
      if (name === 'gross_amount') {
        const gross = parseFloat(value) || 0;
        const gstRate = parseFloat(prev.gst_percentage) || 18;
        const gstAmount = (gross * gstRate) / 100;
        updated.gst_amount = gstAmount.toFixed(2);
        updated.net_amount = (gross + gstAmount).toFixed(2);
      }
      
      // Recalculate if GST percentage changes
      if (name === 'gst_percentage') {
        const gross = parseFloat(prev.gross_amount) || 0;
        const gstRate = parseFloat(value) || 18;
        const gstAmount = (gross * gstRate) / 100;
        updated.gst_amount = gstAmount.toFixed(2);
        updated.net_amount = (gross + gstAmount).toFixed(2);
      }
      
      return updated;
    });
  };

  const saveQuotation = async () => {
    setQuotationSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}/quotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotationData)
      });
      const json = await res.json();
      if (json?.success) {
        alert('Quotation saved successfully!');
      } else {
        alert('Failed to save quotation: ' + (json?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving quotation:', error);
      alert('Error saving quotation');
    } finally {
      setQuotationSaving(false);
    }
  };

  // Sync quotation data from project form fields (database values)
  const syncQuotationFromProject = useCallback(async () => {
    const projectValue = parseFloat(form.project_value) || 0;
    const gstRate = quotationData.gst_percentage || 18;
    const gstAmount = (projectValue * gstRate) / 100;
    const netAmount = projectValue + gstAmount;
    
    // Get scope - try scope_of_work first, then fall back to description
    const scopeText = form.scope_of_work || form.description || '';
    
    // Fetch existing quotation data and next quotation number from API
    let existingQuotation = null;
    let nextQuotationNumber = '';
    try {
      const res = await fetch(`/api/projects/${id}/quotation`);
      const json = await res.json();
      if (json?.success) {
        existingQuotation = json.data;
        nextQuotationNumber = json.nextQuotationNumber || '';
      }
    } catch (err) {
      console.warn('Failed to fetch quotation data:', err);
    }
    
    setQuotationData(prev => ({
      ...prev,
      quotation_number: existingQuotation?.quotation_number || prev.quotation_number || nextQuotationNumber,
      quotation_date: existingQuotation?.quotation_date || prev.quotation_date || new Date().toISOString().split('T')[0],
      client_name: existingQuotation?.client_name || form.client_name || '',
      enquiry_number: existingQuotation?.enquiry_number || form.proposal_id || '',
      enquiry_quantity: existingQuotation?.enquiry_quantity || form.unit_qty || '',
      scope_of_work: existingQuotation?.scope_of_work || scopeText,
      gross_amount: existingQuotation?.gross_amount || projectValue || '',
      gst_percentage: existingQuotation?.gst_percentage || prev.gst_percentage || 18,
      gst_amount: existingQuotation?.gst_amount || (projectValue > 0 ? gstAmount.toFixed(2) : ''),
      net_amount: existingQuotation?.net_amount || (projectValue > 0 ? netAmount.toFixed(2) : '')
    }));
  }, [form.project_value, form.proposal_id, form.unit_qty, form.scope_of_work, form.description, form.client_name, quotationData.gst_percentage, id]);

  // Auto-sync when switching to quotation tab (after project data is loaded)
  useEffect(() => {
    if (activeTab === 'quotation' && !loading && id) {
      syncQuotationFromProject();
    }
  }, [activeTab, loading, id, syncQuotationFromProject]);

  // Purchase Order Form Handlers
  const handlePurchaseOrderChange = (e) => {
    if (!canEditPurchaseOrders) return; // Prevent changes if no edit permission
    const { name, value } = e.target;
    setPurchaseOrderData(prev => {
      const updated = { ...prev, [name]: value };
      
      // Auto-calculate GST and net amount when gross amount changes
      if (name === 'gross_amount') {
        const gross = parseFloat(value) || 0;
        const gstRate = parseFloat(prev.gst_percentage) || 18;
        const gstAmount = (gross * gstRate) / 100;
        updated.gst_amount = gstAmount.toFixed(2);
        updated.net_amount = (gross + gstAmount).toFixed(2);
      }
      
      // Recalculate if GST percentage changes
      if (name === 'gst_percentage') {
        const gross = parseFloat(prev.gross_amount) || 0;
        const gstRate = parseFloat(value) || 18;
        const gstAmount = (gross * gstRate) / 100;
        updated.gst_amount = gstAmount.toFixed(2);
        updated.net_amount = (gross + gstAmount).toFixed(2);
      }
      
      return updated;
    });
  };

  // Handle vendor selection from dropdown
  const handleVendorSelect = (e) => {
    if (!canEditPurchaseOrders) return;
    const vendorId = e.target.value;
    if (vendorId === '') {
      setSelectedVendor(null);
      setPurchaseOrderData(prev => ({
        ...prev,
        vendor_name: '',
        vendor_id: ''
      }));
      return;
    }
    const vendor = vendors.find(v => v.id.toString() === vendorId);
    setSelectedVendor(vendor || null);
    if (vendor) {
      setPurchaseOrderData(prev => ({
        ...prev,
        vendor_name: vendor.vendor_name || '',
        vendor_id: vendor.id
      }));
    }
  };

  const savePurchaseOrder = async () => {
    // Validate vendor selection
    if (!selectedVendor && !purchaseOrderData.vendor_name) {
      alert('Please select a vendor from the dropdown');
      return;
    }

    setPurchaseOrderSaving(true);
    try {
      // Save to project-specific purchase order
      const res = await fetch(`/api/projects/${id}/purchase-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseOrderData)
      });
      const json = await res.json();
      
      if (json?.success) {
        // Also save to main purchase orders table for display on Purchase Order page
        const vendorAddress = selectedVendor ? [
          selectedVendor.address_street,
          selectedVendor.address_city,
          selectedVendor.address_state,
          selectedVendor.address_country,
          selectedVendor.address_pin
        ].filter(Boolean).join(', ') : '';

        const mainPORes = await fetch('/api/admin/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            po_number: purchaseOrderData.po_number,
            vendor_name: purchaseOrderData.vendor_name || selectedVendor?.vendor_name,
            vendor_email: selectedVendor?.email || '',
            vendor_phone: selectedVendor?.phone || '',
            vendor_address: vendorAddress,
            description: purchaseOrderData.scope_of_work,
            items: [],
            subtotal: parseFloat(purchaseOrderData.gross_amount) || 0,
            tax_rate: parseFloat(purchaseOrderData.gst_percentage) || 18,
            tax_amount: parseFloat(purchaseOrderData.gst_amount) || 0,
            discount: 0,
            total: parseFloat(purchaseOrderData.net_amount) || 0,
            notes: purchaseOrderData.remarks,
            terms: purchaseOrderData.payment_terms,
            delivery_date: purchaseOrderData.delivery_date || null,
            status: 'pending',
            project_id: id
          })
        });
        
        const mainPOJson = await mainPORes.json();
        
        if (mainPOJson?.success) {
          alert('Purchase Order saved successfully!');
        } else {
          // Project PO saved but main PO failed - still consider partial success
          alert('Purchase Order saved to project. Note: ' + (mainPOJson?.message || 'Could not sync to main PO list'));
        }
      } else {
        alert('Failed to save purchase order: ' + (json?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving purchase order:', error);
      alert('Error saving purchase order');
    } finally {
      setPurchaseOrderSaving(false);
    }
  };

  // Sync purchase order data - only client name from project
  const syncPurchaseOrderFromProject = useCallback(() => {
    setPurchaseOrderData(prev => {
      // If vendor_id exists in previous data, find and set the selected vendor
      if (prev.vendor_id && vendors.length > 0) {
        const vendor = vendors.find(v => v.id === prev.vendor_id || v.id.toString() === prev.vendor_id.toString());
        if (vendor) {
          setSelectedVendor(vendor);
        }
      }
      return {
        ...prev,
        po_number: prev.po_number || `PO-${String(id).padStart(5, '0')}`,
        po_date: prev.po_date || new Date().toISOString().split('T')[0],
        client_name: form.client_name || ''
      };
    });
  }, [form.client_name, id, vendors]);

  // Auto-sync when switching to purchase order tab (after project data is loaded)
  useEffect(() => {
    if (activeTab === 'purchase_order' && !loading && id) {
      syncPurchaseOrderFromProject();
    }
  }, [activeTab, loading, id, syncPurchaseOrderFromProject]);

  // Invoice Handlers
  const handleInvoiceChange = (e) => {
    if (!canEditInvoices) return; // Prevent changes if no edit permission
    const { name, value } = e.target;
    setInvoiceData(prev => {
      const updated = { ...prev, [name]: value };
      return updated;
    });
  };

  const saveInvoice = async () => {
    setInvoiceSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData)
      });
      const json = await res.json();
      if (json?.success) {
        alert('Invoice saved successfully!');
        // Refresh invoices list - this will also update nextInvoiceNumber
        await fetchInvoices();
        // Reset form for new invoice - invoice_number will be set via syncInvoiceFromProject after fetchInvoices
        setInvoiceData(prev => ({
          ...prev,
          invoice_number: '',
          invoice_date: new Date().toISOString().split('T')[0],
          invoice_amount: '',
          scope_of_work: '',
          payment_due_date: '',
          remarks: ''
        }));
      } else {
        alert('Failed to save invoice: ' + (json?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving invoice:', error);
      alert('Error saving invoice');
    } finally {
      setInvoiceSaving(false);
    }
  };

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}/invoice`);
      const json = await res.json();
      if (json?.success) {
        setInvoices(json.invoices || []);
        if (json.nextInvoiceNumber) {
          setNextInvoiceNumber(json.nextInvoiceNumber);
        }
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  }, [id]);

  // Sync invoice data from project and purchase order
  const syncInvoiceFromProject = useCallback(() => {
    const totalInvoiced = invoices.reduce((sum, inv) => sum + (parseFloat(inv.invoice_amount) || 0), 0);
    const poAmount = parseFloat(purchaseOrderData.net_amount) || 0;
    const balanceAmount = poAmount - totalInvoiced;

    setInvoiceData(prev => ({
      ...prev,
      invoice_number: prev.invoice_number || nextInvoiceNumber || `INV-${String(id).padStart(5, '0')}-${(invoices.length + 1).toString().padStart(2, '0')}`,
      invoice_date: prev.invoice_date || new Date().toISOString().split('T')[0],
      client_name: form.client_name || '',
      po_number: purchaseOrderData.po_number || '',
      po_date: purchaseOrderData.po_date || '',
      po_amount: purchaseOrderData.net_amount || '',
      total_invoiced: totalInvoiced,
      balance_amount: balanceAmount > 0 ? balanceAmount.toFixed(2) : '0.00',
      scope_of_work: prev.scope_of_work || form.scope_of_work || form.description || ''
    }));
  }, [form.client_name, form.scope_of_work, form.description, purchaseOrderData, invoices, id, nextInvoiceNumber]);

  // Auto-sync when switching to invoice tab
  useEffect(() => {
    if (activeTab === 'invoice' && !loading && id) {
      // Ensure invoice list and nextInvoiceNumber are loaded before syncing
      fetchInvoices().then(() => {
        syncInvoiceFromProject();
      });
    }
  }, [activeTab, loading, id, fetchInvoices, syncInvoiceFromProject]);

  // Recalculate balance when invoices change
  useEffect(() => {
    if (activeTab === 'invoice') {
      syncInvoiceFromProject();
    }
  }, [invoices, activeTab, syncInvoiceFromProject]);

  // Apply next invoice number as soon as it's available and field is empty
  useEffect(() => {
    if (activeTab === 'invoice' && nextInvoiceNumber && !invoiceData.invoice_number) {
      setInvoiceData(prev => ({
        ...prev,
        invoice_number: nextInvoiceNumber
      }));
    }
  }, [activeTab, nextInvoiceNumber, invoiceData.invoice_number]);

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

  // Project Manhours helpers - new structure grouped by month
  const getNextMonth = (currentMonth) => {
    if (!currentMonth) {
      // Default to current month if no month provided
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [year, month] = currentMonth.split('-').map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  };

  // Generate array of months between start and end (inclusive)
  const generateMonthRange = (start, end) => {
    if (!start || !end) return [];
    const months = [];
    let [startYear, startMonth] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);
    
    while (startYear < endYear || (startYear === endYear && startMonth <= endMonth)) {
      months.push(`${startYear}-${String(startMonth).padStart(2, '0')}`);
      if (startMonth === 12) {
        startMonth = 1;
        startYear++;
      } else {
        startMonth++;
      }
    }
    return months;
  };

  // Add multiple month sections at once
  const addMonthSections = () => {
    // Get months from range
    const monthsToAdd = generateMonthRange(monthRangeStart, monthRangeEnd);
    
    if (monthsToAdd.length === 0) {
      alert('Please select a valid month range (From and To)');
      return;
    }
    
    // Filter out months that already exist
    const existingMonths = projectManhours.map(m => m.month);
    const newMonths = monthsToAdd.filter(m => !existingMonths.includes(m));
    
    if (newMonths.length === 0) {
      alert('All selected months already exist');
      return;
    }
    
    // Create new month entries
    const newMonthEntries = newMonths.map((month, idx) => ({
      id: Date.now() + idx,
      month: month,
      entries: []
    }));
    
    setProjectManhours(prev => [...prev, ...newMonthEntries].sort((a, b) => a.month.localeCompare(b.month)));
    
    // Clear selection
    setMonthRangeStart('');
    setMonthRangeEnd('');
  };

  // Add an employee entry to a specific month
  const addManhourEntry = (monthId) => {
    if (!newManhourEntry.employee_id || !newManhourEntry.hours) return;
    
    const employee = employeesWithRates.find(e => e.id === parseInt(newManhourEntry.employee_id));
    if (!employee) return;
    
    const entry = {
      id: Date.now(),
      employee_id: employee.id,
      employee_name: employee.name,
      rate: employee.rate,
      salary_type: employee.salary_type,
      hours: parseFloat(newManhourEntry.hours) || 0,
      total_cost: (employee.rate * (parseFloat(newManhourEntry.hours) || 0)).toFixed(2)
    };
    
    setProjectManhours(prev => prev.map(m => {
      if (m.id === monthId) {
        return { ...m, entries: [...(m.entries || []), entry] };
      }
      return m;
    }));
    
    // Reset the entry form
    setNewManhourEntry({
      employee_id: '',
      employee_name: '',
      rate: '',
      salary_type: '',
      hours: ''
    });
    setTimeout(() => newManhourNameRef.current?.focus(), 10);
  };

  // Update an entry within a month
  const updateManhourEntry = (monthId, entryId, field, value) => {
    setProjectManhours(prev => prev.map(m => {
      if (m.id === monthId) {
        const updatedEntries = (m.entries || []).map(e => {
          if (e.id === entryId) {
            const updated = { ...e, [field]: value };
            // Recalculate total cost if hours changed
            if (field === 'hours') {
              updated.total_cost = (updated.rate * (parseFloat(value) || 0)).toFixed(2);
            }
            return updated;
          }
          return e;
        });
        return { ...m, entries: updatedEntries };
      }
      return m;
    }));
  };

  // Remove an entry from a month
  const removeManhourEntry = (monthId, entryId) => {
    setProjectManhours(prev => prev.map(m => {
      if (m.id === monthId) {
        return { ...m, entries: (m.entries || []).filter(e => e.id !== entryId) };
      }
      return m;
    }));
  };

  // Remove an entire month section
  const removeMonthSection = (monthId) => {
    setProjectManhours(prev => prev.filter(m => m.id !== monthId));
  };

  // Handle employee selection - auto-fill rate
  const handleEmployeeSelect = (employeeId) => {
    const employee = employeesWithRates.find(e => e.id === parseInt(employeeId));
    if (employee) {
      setNewManhourEntry(prev => ({
        ...prev,
        employee_id: employee.id,
        employee_name: employee.name,
        rate: employee.rate,
        salary_type: employee.salary_type
      }));
    } else {
      setNewManhourEntry(prev => ({
        ...prev,
        employee_id: '',
        employee_name: '',
        rate: '',
        salary_type: ''
      }));
    }
  };

  // Calculate month totals
  const getMonthTotals = (monthData) => {
    const entries = monthData.entries || [];
    const totalHours = entries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
    const totalCost = entries.reduce((sum, e) => sum + (parseFloat(e.total_cost) || 0), 0);
    return { totalHours, totalCost };
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

  // Multi-user assignment helpers
  // assigned_users is an array of objects: [{ user_id: '1', planned_hours: 0, actual_hours: 0 }, ...]
  const toggleUserForActivity = (activityId, userId) => {
    setProjectActivities(prev => prev.map(act => {
      if (act.id === activityId) {
        const currentUsers = act.assigned_users || [];
        const userIdStr = String(userId);
        // Handle both old object format and new string format
        const isAssigned = currentUsers.some(u => {
          const id = typeof u === 'object' ? u.user_id : u;
          return String(id) === userIdStr;
        });
        const newUsers = isAssigned 
          ? currentUsers.filter(u => {
              const id = typeof u === 'object' ? u.user_id : u;
              return String(id) !== userIdStr;
            })
          : [...currentUsers, { user_id: userIdStr, planned_hours: 0, actual_hours: 0 }];
        return { ...act, assigned_users: newUsers };
      }
      return act;
    }));
  };

  // Update individual user manhours
  const updateUserManhours = (activityId, userId, field, value) => {
    setProjectActivities(prev => prev.map(act => {
      if (act.id === activityId) {
        const updatedUsers = (act.assigned_users || []).map(u => {
          const uId = typeof u === 'object' ? u.user_id : u;
          if (String(uId) === String(userId)) {
            // Only parse as float for numeric fields
            const numericFields = ['planned_hours', 'actual_hours', 'qty_assigned', 'qty_completed'];
            const newValue = numericFields.includes(field) ? (parseFloat(value) || 0) : value;
            
            if (typeof u === 'object') {
              return { ...u, [field]: newValue };
            } else {
              return { user_id: u, planned_hours: field === 'planned_hours' ? (parseFloat(value) || 0) : 0, actual_hours: field === 'actual_hours' ? (parseFloat(value) || 0) : 0, [field]: newValue };
            }
          }
          return typeof u === 'object' ? u : { user_id: u, planned_hours: 0, actual_hours: 0 };
        });
        return { ...act, assigned_users: updatedUsers };
      }
      return act;
    }));
  };

  // Add daily entry for user activity - entries are locked after adding
  const addDailyEntry = (activityId, userId) => {
    setProjectActivities(prev => prev.map(act => {
      if (act.id === activityId) {
        const updatedUsers = (act.assigned_users || []).map(u => {
          const uId = typeof u === 'object' ? u.user_id : u;
          if (String(uId) === String(userId)) {
            const currentEntries = (typeof u === 'object' && u.daily_entries) ? u.daily_entries : [];
            // Get the next date based on last entry, or today if no entries
            let nextDate;
            if (currentEntries.length > 0) {
              const lastEntry = currentEntries[currentEntries.length - 1];
              const lastDate = new Date(lastEntry.date);
              lastDate.setDate(lastDate.getDate() + 1);
              nextDate = lastDate.toISOString().split('T')[0];
            } else {
              nextDate = new Date().toISOString().split('T')[0];
            }
            // Lock all previous entries and add new unlocked entry
            const lockedEntries = currentEntries.map(e => ({ ...e, isLocked: true }));
            const newEntry = { date: nextDate, qty_done: '', hours: '', remarks: '', isLocked: false };
            return { ...u, daily_entries: [...lockedEntries, newEntry] };
          }
          return u;
        });
        return { ...act, assigned_users: updatedUsers };
      }
      return act;
    }));
  };

  // Update daily entry for user activity
  const updateDailyEntry = (activityId, userId, entryIndex, field, value) => {
    setProjectActivities(prev => prev.map(act => {
      if (act.id === activityId) {
        const updatedUsers = (act.assigned_users || []).map(u => {
          const uId = typeof u === 'object' ? u.user_id : u;
          if (String(uId) === String(userId) && typeof u === 'object') {
            const entries = [...(u.daily_entries || [])];
            if (entries[entryIndex]) {
              entries[entryIndex] = { ...entries[entryIndex], [field]: value };
            }
            return { ...u, daily_entries: entries };
          }
          return u;
        });
        return { ...act, assigned_users: updatedUsers };
      }
      return act;
    }));
  };

  // Remove daily entry for user activity
  const removeDailyEntry = (activityId, userId, entryIndex) => {
    setProjectActivities(prev => prev.map(act => {
      if (act.id === activityId) {
        const updatedUsers = (act.assigned_users || []).map(u => {
          const uId = typeof u === 'object' ? u.user_id : u;
          if (String(uId) === String(userId) && typeof u === 'object') {
            const entries = [...(u.daily_entries || [])];
            entries.splice(entryIndex, 1);
            return { ...u, daily_entries: entries };
          }
          return u;
        });
        return { ...act, assigned_users: updatedUsers };
      }
      return act;
    }));
  };

  // Calculate total planned hours for an activity (sum of all user planned hours)
  const getActivityTotalPlanned = (act) => {
    if (!act.assigned_users || act.assigned_users.length === 0) return parseFloat(act.planned_hours) || 0;
    return (act.assigned_users || []).reduce((sum, u) => {
      const hours = typeof u === 'object' ? (parseFloat(u.planned_hours) || 0) : 0;
      return sum + hours;
    }, 0);
  };

  // Calculate total actual hours for an activity (sum of all user actual hours)
  const getActivityTotalActual = (act) => {
    if (!act.assigned_users || act.assigned_users.length === 0) return parseFloat(act.actual_hours) || 0;
    return (act.assigned_users || []).reduce((sum, u) => {
      const hours = typeof u === 'object' ? (parseFloat(u.actual_hours) || 0) : 0;
      return sum + hours;
    }, 0);
  };

  const getAssignedUserNames = (assignedUsers) => {
    if (!assignedUsers || assignedUsers.length === 0) return 'Select users...';
    const userList = allUsers.length > 0 ? allUsers : userMaster;
    return assignedUsers.map(assignment => {
      const userId = typeof assignment === 'object' ? assignment.user_id : assignment;
      const user = userList.find(u => String(u.id) === String(userId));
      return user ? (user.full_name || user.employee_name || user.username || user.email) : '';
    }).filter(Boolean).join(', ');
  };

  // Helper to check if a user is assigned (handles both old string format and new object format)
  const isUserAssigned = (assignedUsers, userId) => {
    if (!assignedUsers || assignedUsers.length === 0) return false;
    return assignedUsers.some(u => {
      const id = typeof u === 'object' ? u.user_id : u;
      return String(id) === String(userId);
    });
  };

  // Helper to get user assignment object
  const getUserAssignment = (assignedUsers, userId) => {
    if (!assignedUsers || assignedUsers.length === 0) return null;
    return assignedUsers.find(u => {
      const id = typeof u === 'object' ? u.user_id : u;
      return String(id) === String(userId);
    });
  };

  // Multi-select activity helpers
  const toggleActivitySelector = () => {
    if (!showActivitySelector) {
      // Reset selection state when opening
      setSelectedActivitiesForAdd({});
      setActivitySelectorSearch('');
    }
    setShowActivitySelector(!showActivitySelector);
  };

  const toggleActivitySelection = (funcId, actId) => {
    const key = `${funcId}|${actId}`;
    setSelectedActivitiesForAdd(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const toggleAllActivitiesInDiscipline = (funcId, acts) => {
    const allSelected = acts.every(act => selectedActivitiesForAdd[`${funcId}|${act.id}`]);
    const updates = {};
    acts.forEach(act => {
      updates[`${funcId}|${act.id}`] = !allSelected;
    });
    setSelectedActivitiesForAdd(prev => ({ ...prev, ...updates }));
  };

  const getSelectedCount = () => {
    return Object.values(selectedActivitiesForAdd).filter(Boolean).length;
  };

  const addSelectedActivities = () => {
    const selectedKeys = Object.entries(selectedActivitiesForAdd)
      .filter(([, selected]) => selected)
      .map(([key]) => key);

    const newActivities = [];
    selectedKeys.forEach(key => {
      const [funcId, actId] = key.split('|');
      const func = functions.find(f => String(f.id) === funcId);
      const activity = func?.activities?.find(a => String(a.id) === actId);
      
      if (activity && func) {
        // Check if already exists
        const exists = projectActivities.some(pa => String(pa.id) === String(actId) && pa.type === 'activity');
        if (!exists) {
          newActivities.push({
            id: activity.id,
            type: 'activity',
            source: 'master',
            name: activity.activity_name,
            discipline: func.function_name,
            discipline_id: func.id,
            activity_name: activity.activity_name,
            planned_hours: parseFloat(activity.default_manhours) || 0,
            actual_hours: 0,
            assigned_user: '',
            assigned_users: [],
            due_date: '',
            priority: 'MEDIUM',
            status: 'Not Started',
            function_name: func.function_name,
            remarks: ''
          });
        }
      }
    });

    if (newActivities.length > 0) {
      setProjectActivities(prev => [...prev, ...newActivities]);
    }
    setShowActivitySelector(false);
    setSelectedActivitiesForAdd({});
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

  const updateProjectActivity = (activityId, field, value) => {
    setProjectActivities(prev => prev.map(act => 
      act.id === activityId ? { ...act, [field]: value } : act
    ));
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
    
    if (!form.name.trim()) {
      alert('Project name is required');
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
        project_manhours_list: JSON.stringify(projectManhours || []),
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

      const result = await fetchJSON(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (result.success) {
        alert('Project updated successfully!');
      } else {
        alert(`Failed to update project: ${result.error || result.message || 'Unknown error'}`);
      }
    } catch (error) {
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
                  {TABS.filter(tab => {
                    // Filter tabs based on user role
                    const isAdmin = sessionUser?.is_super_admin || sessionUser?.role_info?.hierarchy <= 2;
                    if (tab.adminOnly && !isAdmin) return false;
                    if (tab.userOnly && isAdmin) return false;
                    
                    // Filter tabs based on permissions
                    if (tab.requiresPermission) {
                      const hasAnyPermission = can(tab.requiresPermission, PERMISSIONS.READ) || can(tab.requiresPermission, PERMISSIONS.UPDATE);
                      if (!hasAnyPermission) return false;
                    }
                    
                    return true;
                  }).map((tab, index) => {
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
                                readOnly
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 bg-gray-50 cursor-not-allowed" 
                                style={{
                                  background: 'rgba(249, 250, 251, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#6b7280',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
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
                                readOnly
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 bg-gray-50 cursor-not-allowed" 
                                style={{
                                  background: 'rgba(249, 250, 251, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#6b7280',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
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
                                disabled
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 bg-gray-50 cursor-not-allowed"
                                style={{
                                  background: 'rgba(249, 250, 251, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#6b7280',
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
                                readOnly
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 bg-gray-50 cursor-not-allowed" 
                                style={{
                                  background: 'rgba(249, 250, 251, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#6b7280',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
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
                                readOnly
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 bg-gray-50 cursor-not-allowed" 
                                style={{
                                  background: 'rgba(249, 250, 251, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#6b7280',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
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
                                readOnly
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 bg-gray-50 cursor-not-allowed" 
                                style={{
                                  background: 'rgba(249, 250, 251, 0.95)',
                                  border: '1.5px solid rgba(139, 92, 246, 0.15)',
                                  color: '#6b7280',
                                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)'
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
                                disabled
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed" 
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
                              readOnly
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-y bg-gray-50 cursor-not-allowed" 
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
                              disabled
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
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
                              readOnly
                              disabled
                              placeholder={newInputDocument.category === 'lot' ? 'LOT-001' : newInputDocument.category === 'sublot' ? 'SL-001' : 'N/A'}
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed text-gray-400"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="date"
                              value={newInputDocument.date_received}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, date_received: e.target.value }))}
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.description}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, description: e.target.value }))}
                              onKeyPress={handleInputDocumentKeyPress}
                              placeholder="Description*"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.drawing_number}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, drawing_number: e.target.value }))}
                              placeholder="DWG-XXX"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.sheet_number}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, sheet_number: e.target.value }))}
                              placeholder="SH-001"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.revision_number}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, revision_number: e.target.value }))}
                              placeholder="Rev-A"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.unit_qty}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, unit_qty: e.target.value }))}
                              placeholder="10 pcs"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.document_sent_by}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, document_sent_by: e.target.value }))}
                              placeholder="Sender"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={newInputDocument.remarks}
                              onChange={(e) => setNewInputDocument(prev => ({ ...prev, remarks: e.target.value }))}
                              placeholder="Notes"
                              readOnly
                              className="w-full text-sm px-2 py-1 border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
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
                                disabled
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                disabled
                                placeholder={doc.category === 'lot' ? 'LOT-001' : doc.category === 'sublot' ? 'SL-001' : 'N/A'}
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed text-gray-400"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                                readOnly
                                className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed"
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
                            disabled
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
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
                            disabled
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
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
                            disabled
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-gray-50 cursor-not-allowed"
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
                            readOnly
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 cursor-not-allowed"
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
                                        disabled
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs bg-gray-50 cursor-not-allowed"
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
                                    disabled
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="date" 
                                    value={m.meeting_date || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'meeting_date', e.target.value)} 
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_title || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'meeting_title', e.target.value)} 
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed" 
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
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input 
                                    type="text" 
                                    value={m.meeting_location || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'meeting_location', e.target.value)} 
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-50 cursor-not-allowed" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <textarea 
                                    value={m.points_discussed || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'points_discussed', e.target.value)} 
                                    onBlur={(e) => handlePointsBlur(m.id, e.target.value, updateKickoffMeeting)}
                                    rows={3}
                                    placeholder="Enter points (press Enter for new bullet)&#10;Project timeline&#10;Budget discussion&#10;Next steps"
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded resize-y min-h-[60px] font-mono bg-gray-50 cursor-not-allowed" 
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <textarea 
                                    value={m.persons_involved || ''} 
                                    onChange={(e) => updateKickoffMeeting(m.id, 'persons_involved', e.target.value)} 
                                    onBlur={(e) => handlePointsBlur(m.id, e.target.value, updateKickoffMeeting, 'persons_involved')}
                                    rows={3}
                                    placeholder="Enter participants (press Enter for new bullet)&#10;John Doe&#10;Jane Smith&#10;Bob Johnson"
                                    readOnly
                                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded resize-y min-h-[60px] font-mono bg-gray-50 cursor-not-allowed" 
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
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-4">
                <div className="px-4 py-7 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
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
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mt-16">
                <div className="px-4 py-4 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-[#7F2487]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <h2 className="text-sm font-bold text-gray-900">Project Manhours</h2>
                      <span className="text-[10px] text-gray-400 ml-2">• Track employee hours by month</span>
                    </div>
                    {/* Add Employee & Month Range */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setProjectManhours(prev => [...prev, {
                            id: Date.now(),
                            employee_id: '',
                            employee_name: '',
                            salary_type: '',
                            rate_company: '',
                            rate_accent: '',
                            monthly_hours: {}
                          }]);
                        }}
                        className="text-xs px-3 py-1.5 bg-[#7F2487] text-white rounded hover:bg-purple-700 font-medium flex items-center gap-1"
                      >
                        <PlusIcon className="h-3 w-3" />
                        Add Row
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-gray-400">
                    {employeesLoading ? 'Loading employees...' : `${employeesWithRates.length} employees available • ${projectManhours.length} added`}
                  </div>
                </div>

                <div className="px-4 py-4">
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gradient-to-r from-purple-50 to-gray-50">
                            <th className="text-left py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 sticky left-0 bg-purple-50 z-10" style={{ minWidth: '140px' }}>Employee</th>
                            <th className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-green-50" style={{ minWidth: '80px' }}>Salary Type</th>
                            <th className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-50" style={{ minWidth: '90px' }}>RT/HR (Company)</th>
                            <th className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-50" style={{ minWidth: '90px' }}>RT/HR (Accent)</th>
                            {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(month => (
                              <th key={month} className="text-center py-2 px-1 font-semibold text-gray-700 border-b border-gray-200 bg-amber-50/50" style={{ minWidth: '50px' }}>{month}</th>
                            ))}
                            <th className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-purple-100" style={{ minWidth: '70px' }}>Total Hrs</th>
                            <th className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-green-100" style={{ minWidth: '100px' }}>Company Cost</th>
                            <th className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-100" style={{ minWidth: '100px' }}>Accent Cost</th>
                            <th className="text-center py-2 px-2 border-b border-gray-200" style={{ width: '40px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectManhours.map((empData, idx) => {
                            const monthlyHours = empData.monthly_hours || {};
                            const totalHrs = Object.values(monthlyHours).reduce((sum, h) => sum + (parseFloat(h) || 0), 0);
                            const companyCost = totalHrs * (parseFloat(empData.rate_company) || 0);
                            const accentCost = totalHrs * (parseFloat(empData.rate_accent) || 0);
                            
                            return (
                              <tr key={empData.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                                <td className="py-2 px-2 font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">
                                  <div className="flex items-center gap-1">
                                    <span className="text-gray-400 text-[10px]">{idx + 1}.</span>
                                    <select
                                      value={empData.employee_id || ''}
                                      onChange={async (e) => {
                                        const selectedEmp = employeesWithRates.find(emp => emp.id === parseInt(e.target.value));
                                        if (selectedEmp) {
                                          const salaryType = selectedEmp.salary_type || 'monthly';
                                          let monthlyHoursData = empData.monthly_hours || {};
                                          
                                          // If monthly salary type, fetch attendance hours
                                          if (salaryType === 'monthly') {
                                            const attendanceHours = await fetchAttendanceHours(selectedEmp.id);
                                            if (attendanceHours) {
                                              monthlyHoursData = attendanceHours;
                                            }
                                          }
                                          
                                          setProjectManhours(prev => prev.map(m => m.id === empData.id ? {
                                            ...m,
                                            employee_id: selectedEmp.id,
                                            employee_name: selectedEmp.name,
                                            salary_type: salaryType,
                                            rate_company: selectedEmp.rate || 0,
                                            rate_accent: m.rate_accent || '',
                                            monthly_hours: monthlyHoursData
                                          } : m));
                                        }
                                      }}
                                      className="text-xs px-1 py-0.5 border border-gray-200 rounded focus:ring-1 focus:ring-purple-400 bg-transparent max-w-[120px] truncate"
                                    >
                                      <option value="">Select Employee</option>
                                      {employeesWithRates.map(emp => (
                                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-center bg-green-50/30">
                                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                                    empData.salary_type === 'hourly' ? 'bg-orange-100 text-orange-700' :
                                    empData.salary_type === 'daily' ? 'bg-green-100 text-green-700' :
                                    empData.salary_type === 'custom' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-blue-100 text-blue-700'
                                  }`}>
                                    {empData.salary_type || 'monthly'}
                                  </span>
                                </td>
                                <td className="py-2 px-1 text-center bg-blue-50/30">
                                  <input
                                    type="number"
                                    value={empData.rate_company || ''}
                                    onChange={(e) => setProjectManhours(prev => prev.map(m => m.id === empData.id ? { ...m, rate_company: e.target.value } : m))}
                                    className="w-full text-[10px] px-1 py-0.5 border border-gray-200 rounded text-center focus:ring-1 focus:ring-blue-400"
                                    placeholder="0"
                                    min="0"
                                    step="0.01"
                                  />
                                </td>
                                <td className="py-2 px-1 text-center bg-blue-50/30">
                                  <input
                                    type="number"
                                    value={empData.rate_accent || ''}
                                    onChange={(e) => setProjectManhours(prev => prev.map(m => m.id === empData.id ? { ...m, rate_accent: e.target.value } : m))}
                                    className="w-full text-[10px] px-1 py-0.5 border border-gray-200 rounded text-center focus:ring-1 focus:ring-blue-400"
                                    placeholder="0"
                                    min="0"
                                    step="0.01"
                                  />
                                </td>
                                {['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map(month => (
                                  <td key={month} className="py-2 px-0.5 text-center bg-amber-50/20">
                                    <input
                                      type="number"
                                      value={monthlyHours[month] || ''}
                                      onChange={(e) => setProjectManhours(prev => prev.map(m => {
                                        if (m.id === empData.id) {
                                          return { ...m, monthly_hours: { ...m.monthly_hours, [month]: e.target.value } };
                                        }
                                        return m;
                                      }))}
                                      className={`w-full text-[10px] px-0.5 py-0.5 border border-gray-200 rounded text-center focus:ring-1 focus:ring-amber-400 ${empData.salary_type === 'monthly' ? 'bg-blue-50/50' : ''}`}
                                      placeholder="–"
                                      min="0"
                                      step="0.5"
                                      title={empData.salary_type === 'monthly' ? 'Auto-fetched from Attendance (editable)' : ''}
                                    />
                                  </td>
                                ))}
                                <td className="py-2 px-2 text-center font-semibold text-purple-700 bg-purple-50/50">
                                  {totalHrs.toFixed(1)}
                                </td>
                                <td className="py-2 px-2 text-center font-semibold text-green-700 bg-green-50/50">
                                  ₹{companyCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 px-2 text-center font-semibold text-blue-700 bg-blue-50/50">
                                  ₹{accentCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 px-1 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setProjectManhours(prev => prev.filter(m => m.id !== empData.id))}
                                    className="text-red-400 hover:text-red-600"
                                    title="Remove employee"
                                  >
                                    <XMarkIcon className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {/* Totals Row */}
                          <tr className="bg-gradient-to-r from-purple-100 to-gray-100 font-semibold">
                            <td className="py-2 px-2 text-gray-800 sticky left-0 bg-purple-100 z-10 border-r border-gray-200">Grand Total</td>
                            <td className="py-2 px-2 bg-green-100/50"></td>
                            <td className="py-2 px-2 bg-blue-100/50"></td>
                            <td className="py-2 px-2 bg-blue-100/50"></td>
                            {['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map(month => {
                              const monthTotal = projectManhours.reduce((sum, emp) => sum + (parseFloat(emp.monthly_hours?.[month]) || 0), 0);
                              return (
                                <td key={month} className="py-2 px-1 text-center text-gray-700 bg-amber-100/50">
                                  {monthTotal > 0 ? monthTotal.toFixed(1) : '–'}
                                </td>
                              );
                            })}
                            <td className="py-2 px-2 text-center text-purple-800 bg-purple-200/50">
                              {projectManhours.reduce((sum, emp) => sum + Object.values(emp.monthly_hours || {}).reduce((s, h) => s + (parseFloat(h) || 0), 0), 0).toFixed(1)}
                            </td>
                            <td className="py-2 px-2 text-center text-green-800 bg-green-200/50">
                              ₹{projectManhours.reduce((sum, emp) => {
                                const hrs = Object.values(emp.monthly_hours || {}).reduce((s, h) => s + (parseFloat(h) || 0), 0);
                                return sum + (hrs * (parseFloat(emp.rate_company) || 0));
                              }, 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 px-2 text-center text-blue-800 bg-blue-200/50">
                              ₹{projectManhours.reduce((sum, emp) => {
                                const hrs = Object.values(emp.monthly_hours || {}).reduce((s, h) => s + (parseFloat(h) || 0), 0);
                                return sum + (hrs * (parseFloat(emp.rate_accent) || 0));
                              }, 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 px-1"></td>
                          </tr>
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

            {/* Project Activity Tab - Admin view for all team members */}
            {activeTab === 'project_activity' && (
              <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-800 text-lg">Project Activities</h2>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">{projectActivities.length} activities</span>
                    <span className="text-blue-600 font-medium">Plan: {projectActivities.reduce((sum, a) => sum + getActivityTotalPlanned(a), 0).toFixed(1)}h</span>
                    <span className="text-green-600 font-medium">Actual: {projectActivities.reduce((sum, a) => sum + getActivityTotalActual(a), 0).toFixed(1)}h</span>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {functions.length > 0 && (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={toggleActivitySelector}
                        className={`px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 transition-all ${
                          showActivitySelector ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {showActivitySelector ? (
                          <><XMarkIcon className="h-4 w-4" />Close</>
                        ) : (
                          <><PlusIcon className="h-4 w-4" />Add Activities</>
                        )}
                      </button>
                      {projectActivities.length > 0 && <div className="text-sm text-gray-500">{projectActivities.length} added</div>}
                    </div>
                  )}

                  {showActivitySelector && functions.length > 0 && (
                    <div className="border border-gray-200 rounded-lg bg-white text-sm">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                        <input type="text" value={activitySelectorSearch} onChange={(e) => setActivitySelectorSearch(e.target.value)} placeholder="Search..." className="px-2 py-1 text-sm border border-gray-300 rounded w-48 focus:outline-none focus:border-blue-500" />
                        <div className="flex items-center gap-3">
                          {getSelectedCount() > 0 && <span className="text-blue-600 font-medium">{getSelectedCount()} selected</span>}
                          <button type="button" onClick={addSelectedActivities} disabled={getSelectedCount() === 0} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed">Add</button>
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                        {functions.map(func => {
                          const filteredActs = (func.activities || []).filter(act => !activitySelectorSearch || act.activity_name?.toLowerCase().includes(activitySelectorSearch.toLowerCase()));
                          if (activitySelectorSearch && filteredActs.length === 0) return null;
                          const allSelected = filteredActs.length > 0 && filteredActs.every(act => selectedActivitiesForAdd[`${func.id}|${act.id}`]);
                          const someSelected = filteredActs.some(act => selectedActivitiesForAdd[`${func.id}|${act.id}`]);
                          return (
                            <div key={func.id}>
                              <div className={`flex items-center gap-2 px-3 py-1 bg-gray-50 ${filteredActs.length > 0 ? 'cursor-pointer hover:bg-gray-100' : ''}`} onClick={() => filteredActs.length > 0 && toggleAllActivitiesInDiscipline(func.id, filteredActs)}>
                                {filteredActs.length > 0 ? <input type="checkbox" checked={allSelected} ref={el => el && (el.indeterminate = someSelected && !allSelected)} onChange={() => toggleAllActivitiesInDiscipline(func.id, filteredActs)} className="h-3.5 w-3.5 text-blue-600 rounded border-gray-300" onClick={(e) => e.stopPropagation()} /> : <span className="h-3.5 w-3.5" />}
                                <span className="font-medium text-gray-700 text-xs">{func.function_name}</span>
                                <span className="text-gray-400 text-xs">{filteredActs.length > 0 ? `(${filteredActs.length})` : '(no activities)'}</span>
                              </div>
                              {filteredActs.length > 0 && (
                                <div className="grid grid-cols-3 gap-x-1 px-2 py-1">
                                  {filteredActs.map(activity => {
                                    const isAlreadyAdded = projectActivities.some(pa => String(pa.id) === String(activity.id) && pa.type === 'activity');
                                    const isSelected = selectedActivitiesForAdd[`${func.id}|${activity.id}`];
                                    return (
                                      <label key={activity.id} className={`flex items-center gap-1 py-0.5 cursor-pointer text-xs truncate ${isAlreadyAdded ? 'opacity-40 cursor-not-allowed' : isSelected ? 'text-blue-700' : 'text-gray-600 hover:text-gray-900'}`} title={activity.activity_name}>
                                        <input type="checkbox" checked={isSelected || false} disabled={isAlreadyAdded} onChange={() => !isAlreadyAdded && toggleActivitySelection(func.id, activity.id)} className="h-3 w-3 text-blue-600 rounded border-gray-300 flex-shrink-0" />
                                        <span className={`truncate ${isAlreadyAdded ? 'line-through' : ''}`}>{activity.activity_name}</span>
                                        {isAlreadyAdded && <span className="text-green-600 flex-shrink-0">✓</span>}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {projectActivities.length === 0 ? (
                    <div className="text-center py-6 text-gray-400 text-sm">No activities added yet. Click the button above to add activities.</div>
                  ) : (
                    <div className="space-y-4">
                      {(() => {
                        const grouped = projectActivities.reduce((acc, act) => { const discipline = act.discipline || act.function_name || 'Manual Entry'; if (!acc[discipline]) acc[discipline] = []; acc[discipline].push(act); return acc; }, {});
                        return Object.entries(grouped).map(([discipline, acts]) => (
                          <div key={discipline} style={{ overflow: 'visible' }}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-semibold text-gray-800 text-sm">{discipline} <span className="font-normal text-gray-400 text-xs">({acts.length})</span></span>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="text-blue-600 font-medium">{acts.reduce((sum, a) => sum + getActivityTotalPlanned(a), 0).toFixed(1)}h plan</span>
                                <span className="text-green-600 font-medium">{acts.reduce((sum, a) => sum + getActivityTotalActual(a), 0).toFixed(1)}h actual</span>
                              </div>
                            </div>
                            <div style={{ overflow: 'visible' }}>
                              <table className="w-full text-xs border-collapse" style={{ overflow: 'visible' }}>
                                <thead>
                                  <tr className="border-b border-gray-200">
                                    <th className="text-left py-1 px-2 font-medium text-gray-400 text-[10px] uppercase" style={{ width: '3%' }}></th>
                                    <th className="text-left py-1 px-2 font-medium text-gray-400 text-[10px] uppercase" style={{ width: '20%' }}></th>
                                    <th className="text-center py-1 px-2 font-medium text-gray-500 text-[10px] uppercase bg-green-50 border-l border-r border-green-200" style={{ width: '10%' }}>Team</th>
                                    <th colSpan={2} className="text-center py-1 px-1 font-medium text-gray-500 text-[10px] uppercase bg-purple-50 border-l border-r border-purple-200" style={{ width: '10%' }}>Unit/Qty</th>
                                    <th colSpan={4} className="text-center py-1 px-1 font-medium text-gray-500 text-[10px] uppercase bg-blue-50 border-l border-r border-blue-200" style={{ width: '24%' }}>Progress</th>
                                    <th className="text-center py-1 px-2 font-medium text-gray-500 text-[10px] uppercase bg-amber-50 border-l border-r border-amber-200" style={{ width: '15%' }}>Notes</th>
                                    <th className="py-1 px-1" style={{ width: '4%' }}></th>
                                  </tr>
                                  <tr className="border-b border-gray-300">
                                    <th className="text-left py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">#</th>
                                    <th className="text-left py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Activity</th>
                                    <th className="text-center py-2 px-2 font-medium text-gray-500 text-[11px] uppercase bg-green-50 border-l border-r border-green-200">Member</th>
                                    <th className="text-center py-2 px-1 font-medium text-gray-500 text-[11px] uppercase bg-purple-50 border-l border-purple-200">Asgn</th>
                                    <th className="text-center py-2 px-1 font-medium text-gray-500 text-[11px] uppercase bg-purple-50 border-r border-purple-200">Done</th>
                                    <th className="text-center py-2 px-1 font-medium text-gray-500 text-[11px] uppercase bg-blue-50 border-l border-blue-200">Plan</th>
                                    <th className="text-center py-2 px-1 font-medium text-gray-500 text-[11px] uppercase bg-blue-50">Actual</th>
                                    <th className="text-center py-2 px-1 font-medium text-gray-500 text-[11px] uppercase bg-blue-50">Due</th>
                                    <th className="text-center py-2 px-1 font-medium text-gray-500 text-[11px] uppercase bg-blue-50 border-r border-blue-200">Status</th>
                                    <th className="text-center py-2 px-2 font-medium text-gray-500 text-[11px] uppercase bg-amber-50 border-l border-r border-amber-200">Remarks</th>
                                    <th className="py-2 px-1"></th>
                                  </tr>
                                </thead>
                                <tbody style={{ overflow: 'visible' }}>
                                  {acts.map((act, idx) => {
                                    const assignedUsers = act.assigned_users || [];
                                    const hasUsers = assignedUsers.length > 0;
                                    return (
                                      <Fragment key={`${act.id}-${act.type}-${idx}`}>
                                        <tr className="border-b border-gray-200 bg-gray-50/50">
                                          <td className="py-2 px-2 text-gray-500 font-medium align-middle">{idx + 1}</td>
                                          <td className="py-2 px-2" colSpan={9}>
                                            <div className="flex items-center gap-2">
                                              <input type="text" value={act.activity_name || act.name || ''} onChange={(e) => updateScopeActivity(act.id, 'activity_name', e.target.value)} className="flex-1 max-w-xs px-2 py-1 text-xs border-0 border-b border-gray-200 focus:border-blue-500 focus:outline-none text-gray-800 bg-transparent font-medium" placeholder="Activity name" />
                                              <div className="relative" data-user-selector-dropdown>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); setOpenUserSelectorForActivity(openUserSelectorForActivity === act.id ? null : act.id); }} className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap">+ Add User</button>
                                                {openUserSelectorForActivity === act.id && (
                                                  <div className="absolute z-[9999] mt-1 right-0 w-48 bg-white border border-gray-200 rounded-md shadow-lg" onClick={(e) => e.stopPropagation()}>
                                                    <div className="px-2 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between">
                                                      <span>Select Member</span>
                                                      <button type="button" onClick={() => setOpenUserSelectorForActivity(null)} className="text-gray-400 hover:text-gray-600">×</button>
                                                    </div>
                                                    <div className="max-h-40 overflow-y-auto">
                                                      {(allUsers.length > 0 ? allUsers : userMaster).filter(user => !isUserAssigned(act.assigned_users, user.id)).map(user => (
                                                        <div key={user.id} onClick={() => toggleUserForActivity(act.id, user.id)} className="px-2 py-1.5 cursor-pointer text-xs text-gray-700 hover:bg-blue-50 border-b border-gray-100 last:border-b-0">
                                                          {user.full_name || user.employee_name || user.username || user.email || 'Unknown'}
                                                        </div>
                                                      ))}
                                                      {(allUsers.length > 0 ? allUsers : userMaster).filter(user => !isUserAssigned(act.assigned_users, user.id)).length === 0 && <div className="px-2 py-1.5 text-xs text-gray-500 text-center">All assigned</div>}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </td>
                                          <td className="py-2 px-1 text-center align-middle"><button type="button" onClick={() => removeScopeActivity(act.id)} className="text-gray-300 hover:text-red-500" title="Remove">×</button></td>
                                        </tr>
                                        {hasUsers && assignedUsers.map((assignment, uIdx) => {
                                          const odUserId = typeof assignment === 'object' ? assignment.user_id : assignment;
                                          const userList = allUsers.length > 0 ? allUsers : userMaster;
                                          const user = userList.find(u => String(u.id) === String(odUserId));
                                          const name = user ? (user.full_name || user.employee_name || user.username || user.email || '?') : '?';
                                          const plannedHrs = typeof assignment === 'object' ? (assignment.planned_hours || '') : '';
                                          const actualHrs = typeof assignment === 'object' ? (assignment.actual_hours || '') : '';
                                          const qtyAssigned = typeof assignment === 'object' ? (assignment.qty_assigned || '') : '';
                                          const qtyCompleted = typeof assignment === 'object' ? (assignment.qty_completed || '') : '';
                                          const dueDate = typeof assignment === 'object' ? (assignment.due_date || '') : '';
                                          const status = typeof assignment === 'object' ? (assignment.status || 'Not Started') : 'Not Started';
                                          const remarks = typeof assignment === 'object' ? (assignment.remarks || '') : '';
                                          const description = typeof assignment === 'object' ? (assignment.description || '') : '';
                                          return (
                                            <tr key={`${act.id}-user-${odUserId}`} className="border-b border-gray-100">
                                              <td className="py-1.5 px-2"></td>
                                              <td className="py-1.5 px-2">
                                                <input type="text" value={description} onChange={(e) => updateUserManhours(act.id, odUserId, 'description', e.target.value)} className="w-full px-1 py-0.5 text-xs border border-gray-200 rounded focus:border-blue-500 focus:outline-none bg-white" placeholder="Description for this user..." />
                                              </td>
                                              <td className="py-1.5 px-2 text-gray-600 text-xs bg-green-50/50"><span className="text-gray-400 mr-1">{uIdx + 1}.</span>{name}</td>
                                              <td className="py-1.5 px-1 bg-purple-50/50"><input type="number" value={qtyAssigned} onChange={(e) => updateUserManhours(act.id, odUserId, 'qty_assigned', e.target.value)} className="w-full px-1 py-0.5 text-xs border-0 border-b border-purple-200 text-center focus:border-purple-500 focus:outline-none bg-transparent" placeholder="–" min="0" /></td>
                                              <td className="py-1.5 px-1 bg-purple-50/50"><input type="number" value={qtyCompleted} onChange={(e) => updateUserManhours(act.id, odUserId, 'qty_completed', e.target.value)} className="w-full px-1 py-0.5 text-xs border-0 border-b border-purple-200 text-center focus:border-purple-500 focus:outline-none bg-transparent" placeholder="–" min="0" /></td>
                                              <td className="py-1.5 px-1 bg-blue-50/50"><input type="number" value={plannedHrs} onChange={(e) => updateUserManhours(act.id, odUserId, 'planned_hours', e.target.value)} className="w-full px-0.5 py-0.5 text-xs border-0 border-b border-blue-200 text-center focus:border-blue-500 focus:outline-none bg-transparent" placeholder="–" min="0" step="0.5" /></td>
                                              <td className="py-1.5 px-1 bg-blue-50/50"><input type="number" value={actualHrs} onChange={(e) => updateUserManhours(act.id, odUserId, 'actual_hours', e.target.value)} className="w-full px-0.5 py-0.5 text-xs border-0 border-b border-blue-200 text-center focus:border-blue-500 focus:outline-none bg-transparent" placeholder="–" min="0" step="0.5" /></td>
                                              <td className="py-1.5 px-0.5 bg-blue-50/50" style={{ width: '60px' }}><input type="date" value={dueDate} onChange={(e) => updateUserManhours(act.id, odUserId, 'due_date', e.target.value)} className="w-full px-0 py-0.5 text-[9px] border-0 border-b border-blue-200 focus:border-blue-500 focus:outline-none bg-transparent" /></td>
                                              <td className="py-1.5 px-1 bg-blue-50/50" style={{ minWidth: '85px' }}><select value={status} onChange={(e) => updateUserManhours(act.id, odUserId, 'status', e.target.value)} className="w-full px-0.5 py-0.5 text-[10px] border-0 border-b border-blue-200 focus:border-blue-500 focus:outline-none bg-transparent"><option value="Not Started">Not Started</option><option value="In Progress">In Progress</option><option value="Completed">Completed</option><option value="On Hold">On Hold</option></select></td>
                                              <td className="py-1.5 px-2 bg-amber-50/50"><textarea value={remarks} onChange={(e) => updateUserManhours(act.id, odUserId, 'remarks', e.target.value)} className="w-full px-1 py-0.5 text-xs border border-amber-200 rounded focus:border-amber-500 focus:outline-none bg-transparent resize-y min-h-[24px]" placeholder="–" rows={1} /></td>
                                              <td className="py-1.5 px-1 text-center"><button type="button" onClick={() => toggleUserForActivity(act.id, odUserId)} className="text-gray-300 hover:text-red-500" title="Remove">×</button></td>
                                            </tr>
                                          );
                                        })}
                                        {hasUsers && (
                                          <tr className="border-t border-gray-200 bg-gray-50/30">
                                            <td className="py-1.5 px-2"></td>
                                            <td className="py-1.5 px-2"></td>
                                            <td className="py-1.5 px-2 text-right text-gray-400 text-xs bg-green-50/50">Total</td>
                                            <td className="py-1.5 px-1 font-semibold text-purple-700 text-xs text-center bg-purple-50/50">{(act.assigned_users || []).reduce((sum, u) => sum + (parseFloat(typeof u === 'object' ? u.qty_assigned : 0) || 0), 0)}</td>
                                            <td className="py-1.5 px-1 font-semibold text-purple-700 text-xs text-center bg-purple-50/50">{(act.assigned_users || []).reduce((sum, u) => sum + (parseFloat(typeof u === 'object' ? u.qty_completed : 0) || 0), 0)}</td>
                                            <td className="py-1.5 px-2 font-semibold text-blue-700 text-xs text-center bg-blue-50/50">{getActivityTotalPlanned(act).toFixed(1)}</td>
                                            <td className="py-1.5 px-2 font-semibold text-blue-700 text-xs text-center bg-blue-50/50">{getActivityTotalActual(act).toFixed(1)}</td>
                                            <td className="py-1.5 px-2 bg-blue-50/50"></td>
                                            <td className="py-1.5 px-2 bg-blue-50/50"></td>
                                            <td className="py-1.5 px-2 bg-amber-50/50"></td>
                                            <td className="py-1.5 px-1"></td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ));
                      })()}
                      <div className="pt-3 mt-2 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
                        <span>{projectActivities.length} activities • {Object.keys(projectActivities.reduce((acc, a) => { acc[a.discipline || a.function_name || 'Manual'] = true; return acc; }, {})).length} disciplines</span>
                        <div className="flex items-center gap-4">
                          <span>Plan: <strong className="text-blue-600">{projectActivities.reduce((sum, a) => sum + getActivityTotalPlanned(a), 0).toFixed(1)}h</strong></span>
                          <span>Actual: <strong className="text-green-600">{projectActivities.reduce((sum, a) => sum + getActivityTotalActual(a), 0).toFixed(1)}h</strong></span>
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

            {/* Quotation Tab */}
            {activeTab === 'quotation' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-black">Project Quotation</h2>
                    <p className="text-xs text-gray-600 mt-1">
                      {canEditQuotations ? 'Quotation details fetched from project data' : 'View-only mode - You have read permission only'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEditQuotations && (
                      <button
                        type="button"
                        onClick={syncQuotationFromProject}
                        className="px-3 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-200 flex items-center gap-2 border border-gray-300"
                        title="Refresh data from project fields"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Sync from Project
                      </button>
                    )}
                    {canEditQuotations && (
                      <button
                        type="button"
                        onClick={saveQuotation}
                        disabled={quotationSaving}
                        className="px-4 py-2 bg-[#7F2487] text-white text-xs font-medium rounded-md hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                      {quotationSaving ? (
                        <>
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckIcon className="h-4 w-4" />
                          Save Quotation
                        </>
                      )}
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="px-6 py-5 space-y-6">
                    {/* Row 1: Quotation Number, Date & Client Name */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Quotation Number
                        </label>
                        <input
                          type="text"
                          name="quotation_number"
                          value={quotationData.quotation_number}
                          onChange={handleQuotationChange}
                          placeholder="QTN-00001"
                          readOnly={!canEditQuotations}
                          disabled={!canEditQuotations}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Quotation Date</label>
                        <input
                          type="date"
                          name="quotation_date"
                          value={quotationData.quotation_date}
                          onChange={handleQuotationChange}
                          readOnly={!canEditQuotations}
                          disabled={!canEditQuotations}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Client Name
                        </label>
                        <input
                          type="text"
                          name="client_name"
                          value={quotationData.client_name}
                          onChange={handleQuotationChange}
                          placeholder="Client Name"
                          readOnly={!canEditQuotations}
                          disabled={!canEditQuotations}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-50 cursor-not-allowed'}`}
                        />
                      </div>
                    </div>

                    {/* Row 2: Enquiry Number & Quantity */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Enquiry Number
                        </label>
                        <input
                          type="text"
                          name="enquiry_number"
                          value={quotationData.enquiry_number}
                          onChange={handleQuotationChange}
                          placeholder="ENQ-001"
                          readOnly={!canEditQuotations}
                          disabled={!canEditQuotations}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Enquiry Quantity
                        </label>
                        <input
                          type="text"
                          name="enquiry_quantity"
                          value={quotationData.enquiry_quantity}
                          onChange={handleQuotationChange}
                          placeholder="e.g., 100 units"
                          readOnly={!canEditQuotations}
                          disabled={!canEditQuotations}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                        />
                      </div>
                    </div>

                    {/* Row 3: Scope of Work */}
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Scope of Work
                      </label>
                      <textarea
                        name="scope_of_work"
                        value={quotationData.scope_of_work}
                        onChange={handleQuotationChange}
                        rows={4}
                        placeholder="Enter scope of work..."
                        readOnly={!canEditQuotations}
                        disabled={!canEditQuotations}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md resize-y ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                      />
                    </div>

                    {/* Row 4: Amount Section */}
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 mb-4">Amount Details</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-black mb-1">Gross Amount (₹)</label>
                          <input
                            type="number"
                            name="gross_amount"
                            value={quotationData.gross_amount}
                            onChange={handleQuotationChange}
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                            readOnly={!canEditQuotations}
                            disabled={!canEditQuotations}
                            className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-black mb-1">GST @ {quotationData.gst_percentage}% (₹)</label>
                          <input
                            type="number"
                            name="gst_amount"
                            value={quotationData.gst_amount}
                            disabled
                            placeholder="0.00"
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-100 text-gray-600 cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-black mb-1">Net Amount (₹)</label>
                          <input
                            type="number"
                            name="net_amount"
                            value={quotationData.net_amount}
                            disabled
                            placeholder="0.00"
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-100 text-gray-700 font-semibold cursor-not-allowed"
                          />
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">GST Percentage</label>
                        <select
                          name="gst_percentage"
                          value={quotationData.gst_percentage}
                          onChange={handleQuotationChange}
                          disabled={!canEditQuotations}
                          className={`w-32 px-3 py-1.5 text-xs border border-gray-300 rounded-md ${canEditQuotations ? 'focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white' : 'bg-gray-100 cursor-not-allowed text-gray-500'}`}
                        >
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                          <option value="28">28%</option>
                        </select>
                      </div>
                    </div>

                    {/* Summary Card */}
                    {quotationData.net_amount && parseFloat(quotationData.net_amount) > 0 && (
                      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-4 border border-purple-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Quotation Value</p>
                            <p className="text-2xl font-bold text-[#7F2487]">₹{parseFloat(quotationData.net_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Gross: ₹{parseFloat(quotationData.gross_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                            <p className="text-xs text-gray-500">GST ({quotationData.gst_percentage}%): ₹{parseFloat(quotationData.gst_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Save Button at Bottom */}
                    {canEditQuotations && (
                      <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={syncQuotationFromProject}
                          className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-2 border border-gray-300 transition-colors"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Sync from Project
                        </button>
                        <button
                          type="button"
                          onClick={saveQuotation}
                          disabled={quotationSaving}
                          className="px-6 py-2.5 bg-[#7F2487] text-white text-sm font-medium rounded-lg hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
                        >
                          {quotationSaving ? (
                            <>
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Saving Quotation...
                            </>
                          ) : (
                            <>
                              <CheckIcon className="h-5 w-5" />
                              Save Quotation
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
              </section>
            )}

            {/* Purchase Order Tab */}
            {activeTab === 'purchase_order' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-black">Purchase Order</h2>
                    <p className="text-xs text-gray-600 mt-1">
                      {canEditPurchaseOrders ? 'Enter purchase order details' : 'View-only mode - You have read permission only'}
                    </p>
                  </div>
                  {canEditPurchaseOrders && (
                    <button
                      type="button"
                      onClick={savePurchaseOrder}
                      disabled={purchaseOrderSaving}
                      className="px-4 py-2 bg-[#7F2487] text-white text-xs font-medium rounded-md hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                    {purchaseOrderSaving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckIcon className="h-4 w-4" />
                        Save PO
                      </>
                    )}
                    </button>
                  )}
                </div>
                
                <div className="px-6 py-5 space-y-6">
                  {/* Row 1: PO Number, Date & Client Name */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        PO Number <span className="text-gray-400 text-[10px]">(auto-generated)</span>
                      </label>
                      <input
                        type="text"
                        name="po_number"
                        value={purchaseOrderData.po_number}
                        onChange={handlePurchaseOrderChange}
                        placeholder="PO-00001"
                        disabled={!canEditPurchaseOrders}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">PO Date</label>
                      <input
                        type="date"
                        name="po_date"
                        value={purchaseOrderData.po_date}
                        onChange={handlePurchaseOrderChange}
                        disabled={!canEditPurchaseOrders}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Client Name <span className="text-gray-400 text-[10px]">(from Project)</span>
                      </label>
                      <input
                        type="text"
                        name="client_name"
                        value={purchaseOrderData.client_name}
                        onChange={handlePurchaseOrderChange}
                        placeholder="Client Name"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-gray-50"
                        disabled
                      />
                    </div>
                  </div>

                  {/* Row 2: Vendor Name & Delivery Date */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Vendor Name <span className="text-gray-400 text-[10px]">(from Vendor Master)</span>
                      </label>
                      <select
                        value={selectedVendor?.id || purchaseOrderData.vendor_id || ''}
                        onChange={handleVendorSelect}
                        disabled={!canEditPurchaseOrders || loadingVendors}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      >
                        <option value="">
                          {loadingVendors ? 'Loading vendors...' : '-- Select a Vendor --'}
                        </option>
                        {vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>
                            {vendor.vendor_name} {vendor.vendor_id ? `(${vendor.vendor_id})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Delivery Date</label>
                      <input
                        type="date"
                        name="delivery_date"
                        value={purchaseOrderData.delivery_date}
                        onChange={handlePurchaseOrderChange}
                        disabled={!canEditPurchaseOrders}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                  </div>

                  {/* Selected Vendor Details */}
                  {selectedVendor && (
                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                      <h3 className="text-xs font-semibold text-purple-900 mb-3">Selected Vendor Details</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                        <div>
                          <span className="text-purple-600">Vendor Name:</span>
                          <p className="font-medium text-gray-900">{selectedVendor.vendor_name || '-'}</p>
                        </div>
                        <div>
                          <span className="text-purple-600">Email:</span>
                          <p className="font-medium text-gray-900">{selectedVendor.email || '-'}</p>
                        </div>
                        <div>
                          <span className="text-purple-600">Phone:</span>
                          <p className="font-medium text-gray-900">{selectedVendor.phone || '-'}</p>
                        </div>
                        <div>
                          <span className="text-purple-600">GST/VAT ID:</span>
                          <p className="font-medium text-gray-900">{selectedVendor.gst_vat_tax_id || '-'}</p>
                        </div>
                        <div className="col-span-2">
                          <span className="text-purple-600">Address:</span>
                          <p className="font-medium text-gray-900">
                            {[selectedVendor.address_street, selectedVendor.address_city, selectedVendor.address_state, selectedVendor.address_country].filter(Boolean).join(', ') || '-'}
                          </p>
                        </div>
                        <div>
                          <span className="text-purple-600">Contact Person:</span>
                          <p className="font-medium text-gray-900">{selectedVendor.contact_person || '-'}</p>
                        </div>
                        <div>
                          <span className="text-purple-600">Vendor Type:</span>
                          <p className="font-medium text-gray-900">{selectedVendor.vendor_type || '-'}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Row 3: Scope of Work */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Scope of Work</label>
                    <textarea
                      name="scope_of_work"
                      value={purchaseOrderData.scope_of_work}
                      onChange={handlePurchaseOrderChange}
                      rows={4}
                      placeholder="Enter scope of work for this purchase order..."
                      disabled={!canEditPurchaseOrders}
                      className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent resize-y ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                    />
                  </div>

                  {/* Row 4: Amount Section */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Amount Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Gross Amount (₹)</label>
                        <input
                          type="number"
                          name="gross_amount"
                          value={purchaseOrderData.gross_amount}
                          onChange={handlePurchaseOrderChange}
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          disabled={!canEditPurchaseOrders}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">GST @ {purchaseOrderData.gst_percentage}% (₹)</label>
                        <input
                          type="number"
                          name="gst_amount"
                          value={purchaseOrderData.gst_amount}
                          disabled
                          placeholder="0.00"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-100 text-gray-600 cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Net Amount (₹)</label>
                        <input
                          type="number"
                          name="net_amount"
                          value={purchaseOrderData.net_amount}
                          disabled
                          placeholder="0.00"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-100 text-gray-700 font-semibold cursor-not-allowed"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-gray-500 mb-1">GST Percentage</label>
                      <select
                        name="gst_percentage"
                        value={purchaseOrderData.gst_percentage}
                        onChange={handlePurchaseOrderChange}
                        disabled={!canEditPurchaseOrders}
                        className={`w-32 px-3 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      >
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="12">12%</option>
                        <option value="18">18%</option>
                        <option value="28">28%</option>
                      </select>
                    </div>
                  </div>

                  {/* Row 5: Payment Terms & Remarks */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Payment Terms</label>
                      <input
                        type="text"
                        name="payment_terms"
                        value={purchaseOrderData.payment_terms}
                        onChange={handlePurchaseOrderChange}
                        placeholder="e.g., Net 30, Advance, etc."
                        disabled={!canEditPurchaseOrders}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Remarks</label>
                      <input
                        type="text"
                        name="remarks"
                        value={purchaseOrderData.remarks}
                        onChange={handlePurchaseOrderChange}
                        placeholder="Any additional remarks..."
                        disabled={!canEditPurchaseOrders}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditPurchaseOrders ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                  </div>

                  {/* Summary Card */}
                  {purchaseOrderData.net_amount && parseFloat(purchaseOrderData.net_amount) > 0 && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Total PO Value</p>
                          <p className="text-2xl font-bold text-blue-700">₹{parseFloat(purchaseOrderData.net_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Gross: ₹{parseFloat(purchaseOrderData.gross_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                          <p className="text-xs text-gray-500">GST ({purchaseOrderData.gst_percentage}%): ₹{parseFloat(purchaseOrderData.gst_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save Purchase Order Button */}
                  {canEditPurchaseOrders && (
                    <div className="flex justify-end pt-4 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={savePurchaseOrder}
                        disabled={purchaseOrderSaving}
                        className="px-6 py-3 bg-gradient-to-r from-[#7F2487] to-[#9a2fa3] text-white text-sm font-medium rounded-lg hover:from-[#6a1f72] hover:to-[#7F2487] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg transition-all"
                      >
                        {purchaseOrderSaving ? (
                          <>
                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Saving Purchase Order...
                          </>
                        ) : (
                          <>
                            <CheckIcon className="h-5 w-5" />
                            Save Purchase Order
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Invoice Tab */}
            {activeTab === 'invoice' && (
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-black">Invoice</h2>
                    <p className="text-xs text-gray-600 mt-1">
                      {canEditInvoices ? 'Create and manage project invoices' : 'View-only mode - You have read permission only'}
                    </p>
                  </div>
                  {canEditInvoices && (
                    <button
                      type="button"
                      onClick={saveInvoice}
                      disabled={invoiceSaving}
                      className="px-4 py-2 bg-[#7F2487] text-white text-xs font-medium rounded-md hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                    {invoiceSaving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckIcon className="h-4 w-4" />
                        Save Invoice
                      </>
                    )}
                    </button>
                  )}
                </div>
                
                <div className="px-6 py-5 space-y-6">
                  {/* PO Information Summary (Read-only from PO) */}
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <h3 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                      <DocumentTextIcon className="h-4 w-4" />
                      Purchase Order Information
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-blue-700 mb-1">PO Number</label>
                        <p className="text-sm font-semibold text-gray-800 bg-white px-3 py-2 rounded border border-blue-200">
                          {invoiceData.po_number || '-'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-blue-700 mb-1">PO Date</label>
                        <p className="text-sm text-gray-800 bg-white px-3 py-2 rounded border border-blue-200">
                          {invoiceData.po_date ? new Date(invoiceData.po_date).toLocaleDateString('en-IN') : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-blue-700 mb-1">PO Amount (₹)</label>
                        <p className="text-sm font-semibold text-gray-800 bg-white px-3 py-2 rounded border border-blue-200">
                          {invoiceData.po_amount ? parseFloat(invoiceData.po_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-blue-700 mb-1">Balance Amount (₹)</label>
                        <p className={`text-sm font-bold bg-white px-3 py-2 rounded border ${parseFloat(invoiceData.balance_amount) > 0 ? 'text-green-600 border-green-200' : 'text-gray-600 border-blue-200'}`}>
                          {invoiceData.balance_amount ? parseFloat(invoiceData.balance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Row 1: Invoice Number, Date & Client Name */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Invoice Number <span className="text-gray-400 text-[10px]">(auto-generated)</span>
                      </label>
                      <input
                        type="text"
                        name="invoice_number"
                        value={invoiceData.invoice_number}
                        onChange={handleInvoiceChange}
                        placeholder="INV-00001-01"
                        disabled={!canEditInvoices}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Invoice Date</label>
                      <input
                        type="date"
                        name="invoice_date"
                        value={invoiceData.invoice_date}
                        onChange={handleInvoiceChange}
                        disabled={!canEditInvoices}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Client Name <span className="text-gray-400 text-[10px]">(from Project)</span>
                      </label>
                      <input
                        type="text"
                        name="client_name"
                        value={invoiceData.client_name}
                        onChange={handleInvoiceChange}
                        placeholder="Client Name"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-gray-50"
                        disabled
                      />
                    </div>
                  </div>

                  {/* Row 2: Invoice Amount & Payment Due Date */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Invoice Amount (₹)</label>
                      <input
                        type="number"
                        name="invoice_amount"
                        value={invoiceData.invoice_amount || ''}
                        onChange={handleInvoiceChange}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        max={parseFloat(invoiceData.balance_amount) || undefined}
                        disabled={!canEditInvoices}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                      {parseFloat(invoiceData.balance_amount) > 0 && (
                        <p className="text-xs text-gray-500 mt-1">Max: ₹{parseFloat(invoiceData.balance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">Payment Due Date</label>
                      <input
                        type="date"
                        name="payment_due_date"
                        value={invoiceData.payment_due_date}
                        onChange={handleInvoiceChange}
                        disabled={!canEditInvoices}
                        className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                      />
                    </div>
                  </div>

                  {/* Row 3: Scope of Work */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Scope of Work</label>
                    <textarea
                      name="scope_of_work"
                      value={invoiceData.scope_of_work}
                      onChange={handleInvoiceChange}
                      rows={3}
                      placeholder="Description of work covered in this invoice..."
                      disabled={!canEditInvoices}
                      className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent resize-y ${!canEditInvoices ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                    />
                  </div>

                  {/* Row 4: Remarks */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">Remarks</label>
                    <input
                      type="text"
                      name="remarks"
                      value={invoiceData.remarks || ''}
                      onChange={handleInvoiceChange}
                      placeholder="Any additional remarks..."
                      disabled={!canEditInvoices}
                      className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                    />
                  </div>

                  {/* Previous Invoices List */}
                  {invoices.length > 0 && (
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <DocumentTextIcon className="h-4 w-4" />
                        Previous Invoices ({invoices.length})
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-300">
                              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Invoice #</th>
                              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Date</th>
                              <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Amount (₹)</th>
                              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Due Date</th>
                              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map((inv, idx) => (
                              <tr key={inv.id || idx} className="border-b border-gray-200 hover:bg-white">
                                <td className="py-2 px-2 font-medium text-gray-800">{inv.invoice_number}</td>
                                <td className="py-2 px-2 text-gray-600">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-IN') : '-'}</td>
                                <td className="py-2 px-2 text-right font-semibold text-gray-800">
                                  {parseFloat(inv.invoice_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="py-2 px-2 text-gray-600">{inv.payment_due_date ? new Date(inv.payment_due_date).toLocaleDateString('en-IN') : '-'}</td>
                                <td className="py-2 px-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                    inv.status === 'paid' ? 'bg-green-100 text-green-800' :
                                    inv.status === 'overdue' ? 'bg-red-100 text-red-800' :
                                    'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {inv.status || 'pending'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-100">
                              <td colSpan="2" className="py-2 px-2 font-semibold text-gray-700">Total Invoiced</td>
                              <td className="py-2 px-2 text-right font-bold text-gray-800">
                                ₹{invoices.reduce((sum, inv) => sum + (parseFloat(inv.invoice_amount) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td colSpan="2"></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Summary Card */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">PO Amount</p>
                        <p className="text-lg font-bold text-blue-700">₹{parseFloat(invoiceData.po_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Total Invoiced</p>
                        <p className="text-lg font-bold text-purple-700">₹{parseFloat(invoiceData.total_invoiced || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Balance</p>
                        <p className={`text-lg font-bold ${parseFloat(invoiceData.balance_amount) > 0 ? 'text-green-700' : 'text-gray-500'}`}>
                          ₹{parseFloat(invoiceData.balance_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* My Activities Tab - Personalized user manhours tracking */}
            {activeTab === 'my_activities' && (
              <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Header with Totals */}
                <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <ClockIcon className="h-5 w-5 text-[#7F2487]" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">My Activities</h2>
                        <p className="text-xs text-gray-500">Your assigned activities and manhours tracking</p>
                      </div>
                    </div>
                    {/* Total Hours Summary */}
                    {(() => {
                      const myActs = projectActivities.filter(act => {
                        const assignedUsers = act.assigned_users || [];
                        return assignedUsers.some(assignment => {
                          const odUserId = typeof assignment === 'object' ? assignment.user_id : assignment;
                          return String(odUserId) === String(sessionUser?.id);
                        });
                      });
                      const totalsHeader = myActs.reduce((acc, act) => {
                        const assignedUsers = act.assigned_users || [];
                        const myAssignment = assignedUsers.find(a => {
                          const odUserId = typeof a === 'object' ? a.user_id : a;
                          return String(odUserId) === String(sessionUser?.id);
                        });
                        if (myAssignment && typeof myAssignment === 'object') {
                          acc.plannedHours += parseFloat(myAssignment.planned_hours) || 0;
                          const dailyEntries = myAssignment.daily_entries || [];
                          acc.actualHours += dailyEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
                        }
                        return acc;
                      }, { plannedHours: 0, actualHours: 0 });
                      const remaining = totalsHeader.plannedHours - totalsHeader.actualHours;
                      return (
                        <div className="flex items-center gap-4 bg-white/80 rounded-lg px-4 py-2 border border-purple-100">
                          <div className="text-center border-r border-gray-200 pr-4">
                            <span className="text-[10px] text-gray-500 uppercase block">Planned</span>
                            <strong className="text-blue-600 text-lg">{totalsHeader.plannedHours.toFixed(1)}h</strong>
                          </div>
                          <div className="text-center border-r border-gray-200 pr-4">
                            <span className="text-[10px] text-gray-500 uppercase block">Actual</span>
                            <strong className="text-green-600 text-lg">{totalsHeader.actualHours.toFixed(1)}h</strong>
                          </div>
                          <div className="text-center">
                            <span className="text-[10px] text-gray-500 uppercase block">Remaining</span>
                            <strong className={`text-lg ${remaining > 0 ? 'text-orange-600' : 'text-green-600'}`}>{remaining.toFixed(1)}h</strong>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Content */}
                <div className="p-6">
                  {(() => {
                    // Filter activities where current user is assigned
                    const myActivities = projectActivities.filter(act => {
                      const assignedUsers = act.assigned_users || [];
                      return assignedUsers.some(assignment => {
                        const odUserId = typeof assignment === 'object' ? assignment.user_id : assignment;
                        return String(odUserId) === String(sessionUser?.id);
                      });
                    });

                    if (myActivities.length === 0) {
                      return (
                        <div className="text-center py-12">
                          <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500 text-sm">No activities assigned to you in this project</p>
                        </div>
                      );
                    }

                    // Group by discipline
                    const groupedByDiscipline = myActivities.reduce((acc, act) => {
                      const discipline = act.discipline || act.function_name || 'Manual';
                      if (!acc[discipline]) acc[discipline] = [];
                      acc[discipline].push(act);
                      return acc;
                    }, {});

                    // Calculate totals from daily entries
                    const totals = myActivities.reduce((acc, act) => {
                      const assignedUsers = act.assigned_users || [];
                      const myAssignment = assignedUsers.find(a => {
                        const odUserId = typeof a === 'object' ? a.user_id : a;
                        return String(odUserId) === String(sessionUser?.id);
                      });
                      if (myAssignment && typeof myAssignment === 'object') {
                        acc.qtyAssigned += parseFloat(myAssignment.qty_assigned) || 0;
                        acc.plannedHours += parseFloat(myAssignment.planned_hours) || 0;
                        // Sum from daily entries
                        const dailyEntries = myAssignment.daily_entries || [];
                        acc.qtyCompleted += dailyEntries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
                        acc.actualHours += dailyEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
                      }
                      return acc;
                    }, { qtyAssigned: 0, qtyCompleted: 0, plannedHours: 0, actualHours: 0 });

                    return (
                      <div className="space-y-4">
                        {/* Discipline Groups */}
                        {Object.entries(groupedByDiscipline).map(([discipline, acts]) => {
                          // Calculate discipline totals for current user from daily entries
                          const disciplineTotals = acts.reduce((acc, act) => {
                            const assignedUsers = act.assigned_users || [];
                            const myAssignment = assignedUsers.find(a => {
                              const odUserId = typeof a === 'object' ? a.user_id : a;
                              return String(odUserId) === String(sessionUser?.id);
                            });
                            if (myAssignment && typeof myAssignment === 'object') {
                              acc.planned += parseFloat(myAssignment.planned_hours) || 0;
                              const dailyEntries = myAssignment.daily_entries || [];
                              acc.actual += dailyEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
                            }
                            return acc;
                          }, { planned: 0, actual: 0 });

                          return (
                            <div key={discipline} className="border border-gray-200 rounded-lg overflow-hidden">
                              {/* Discipline Header */}
                              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                                <span className="font-semibold text-gray-800 text-sm">{discipline} <span className="font-normal text-gray-400 text-xs">({acts.length})</span></span>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-blue-600 font-medium">{disciplineTotals.planned.toFixed(1)}h plan</span>
                                  <span className="text-green-600 font-medium">{disciplineTotals.actual.toFixed(1)}h actual</span>
                                </div>
                              </div>

                              {/* Activities Table */}
                              <div style={{ overflow: 'visible' }}>
                                <table className="w-full text-xs" style={{ overflow: 'visible' }}>
                                  <thead>
                                    <tr className="bg-gradient-to-r from-slate-50 to-slate-100">
                                      <th className="py-2.5 px-3" style={{ width: '3%' }}></th>
                                      <th className="py-2.5 px-3" style={{ width: '18%' }}></th>
                                      <th className="py-2.5 px-3" style={{ width: '20%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-700 uppercase tracking-wider">Description</span>
                                      </th>
                                      <th className="py-2.5 px-2 text-center" style={{ width: '8%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Date</span>
                                      </th>
                                      <th colSpan={2} className="py-2.5 px-2 text-center" style={{ width: '12%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Hours</span>
                                      </th>
                                      <th colSpan={3} className="py-2.5 px-2 text-center" style={{ width: '18%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 uppercase tracking-wider">Quantity</span>
                                      </th>
                                      <th className="py-2.5 px-2 text-center" style={{ width: '8%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-700 uppercase tracking-wider">Due</span>
                                      </th>
                                      <th className="py-2.5 px-2 text-center" style={{ width: '8%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Status</span>
                                      </th>
                                      <th className="py-2.5 px-3 text-center" style={{ width: '12%' }}>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Notes</span>
                                      </th>
                                      <th className="py-2.5 px-1" style={{ width: '3%' }}></th>
                                    </tr>
                                    <tr className="border-b-2 border-slate-200 bg-white">
                                      <th className="text-left py-2 px-3 font-semibold text-slate-500 text-[10px] uppercase tracking-wide">#</th>
                                      <th className="text-left py-2 px-3 font-semibold text-slate-500 text-[10px] uppercase tracking-wide">Activity</th>
                                      <th className="text-left py-2 px-3 font-medium text-gray-600 text-[10px] uppercase bg-gray-50/50"></th>
                                      <th className="text-center py-2 px-2 font-medium text-emerald-600 text-[10px] uppercase bg-emerald-50/50 rounded-t"></th>
                                      <th className="text-center py-2 px-2 font-medium text-blue-600 text-[10px] uppercase bg-blue-50/50">Plan</th>
                                      <th className="text-center py-2 px-2 font-medium text-blue-600 text-[10px] uppercase bg-blue-50/50">Actual</th>
                                      <th className="text-center py-2 px-2 font-medium text-purple-600 text-[10px] uppercase bg-purple-50/50">Asgn</th>
                                      <th className="text-center py-2 px-2 font-medium text-purple-600 text-[10px] uppercase bg-purple-50/50">Done</th>
                                      <th className="text-center py-2 px-2 font-medium text-purple-600 text-[10px] uppercase bg-purple-100/50">Bal</th>
                                      <th className="text-center py-2 px-2 font-medium text-orange-600 text-[10px] uppercase bg-orange-50/50"></th>
                                      <th className="text-center py-2 px-2 font-medium text-slate-500 text-[10px] uppercase bg-slate-50/50"></th>
                                      <th className="text-left py-2 px-3 font-medium text-amber-600 text-[10px] uppercase bg-amber-50/50"></th>
                                      <th className="py-2 px-1"></th>
                                    </tr>
                                  </thead>
                                  <tbody style={{ overflow: 'visible' }}>
                                    {acts.map((act, idx) => {
                                      const assignedUsers = act.assigned_users || [];
                                      const myAssignment = assignedUsers.find(a => {
                                        const odUserId = typeof a === 'object' ? a.user_id : a;
                                        return String(odUserId) === String(sessionUser?.id);
                                      });

                                      const qtyAssigned = myAssignment && typeof myAssignment === 'object' ? (myAssignment.qty_assigned || '') : '';
                                      const dailyEntries = myAssignment && typeof myAssignment === 'object' ? (myAssignment.daily_entries || []) : [];
                                      const totalQtyDone = dailyEntries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
                                      const totalActualHrs = dailyEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
                                      const plannedHrs = myAssignment && typeof myAssignment === 'object' ? (myAssignment.planned_hours || '') : '';
                                      const myDescription = myAssignment && typeof myAssignment === 'object' ? (myAssignment.description || '') : '';
                                      const dueDate = myAssignment && typeof myAssignment === 'object' ? (myAssignment.due_date || '') : '';
                                      const status = myAssignment && typeof myAssignment === 'object' ? (myAssignment.status || 'Not Started') : 'Not Started';
                                      const remarks = myAssignment && typeof myAssignment === 'object' ? (myAssignment.remarks || '') : '';
                                      const balancedQty = (parseFloat(qtyAssigned) || 0) - totalQtyDone;

                                      return (
                                        <Fragment key={act.id}>
                                          {/* Activity Row with Totals */}
                                          <tr className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 hover:from-slate-100 hover:to-slate-100 transition-colors">
                                            <td className="py-3 px-3">
                                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-600 font-semibold text-[10px]">{idx + 1}</span>
                                            </td>
                                            <td className="py-3 px-3">
                                              <div className="flex items-center gap-3">
                                                <span className="text-slate-800 font-semibold text-sm">{act.activity_name || act.name}</span>
                                                <button
                                                  type="button"
                                                  onClick={() => addDailyEntry(act.id, sessionUser?.id)}
                                                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors"
                                                >
                                                  <span>+</span> Add Day
                                                </button>
                                              </div>
                                            </td>
                                            <td className="py-3 px-3">
                                              <input
                                                type="text"
                                                value={myDescription}
                                                onChange={(e) => updateUserManhours(act.id, sessionUser?.id, 'description', e.target.value)}
                                                className="w-full px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md focus:ring-2 focus:ring-gray-200 focus:border-gray-300 focus:outline-none transition-shadow"
                                                placeholder="Enter your description..."
                                              />
                                            </td>
                                            <td className="py-3 px-2 text-center">
                                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total</span>
                                            </td>
                                            {/* Hours - Plan (Read-only) */}
                                            <td className="py-3 px-2 text-center bg-blue-50/60">
                                              <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-blue-700 bg-blue-100 rounded-md">
                                                {plannedHrs || '–'}
                                              </span>
                                            </td>
                                            {/* Hours - Actual */}
                                            <td className="py-3 px-2 text-center bg-blue-50/60">
                                              <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-md">{totalActualHrs.toFixed(1)}</span>
                                            </td>
                                            {/* Qty - Assigned (Read-only) */}
                                            <td className="py-3 px-2 text-center bg-purple-50/60">
                                              <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-purple-700 bg-purple-100 rounded-md">
                                                {qtyAssigned || '–'}
                                              </span>
                                            </td>
                                            {/* Qty - Done */}
                                            <td className="py-3 px-2 text-center bg-purple-50/60">
                                              <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-md">{totalQtyDone || '0'}</span>
                                            </td>
                                            {/* Qty - Balance */}
                                            <td className="py-3 px-2 text-center bg-purple-100/60">
                                              <span className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold rounded-md ${balancedQty > 0 ? 'text-orange-700 bg-orange-100' : 'text-emerald-700 bg-emerald-100'}`}>
                                                {qtyAssigned ? balancedQty : '–'}
                                              </span>
                                            </td>
                                            <td className="py-3 px-2">
                                              <input 
                                                type="date" 
                                                value={dueDate} 
                                                onChange={(e) => updateUserManhours(act.id, sessionUser?.id, 'due_date', e.target.value)} 
                                                className="w-full px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md focus:ring-2 focus:ring-orange-200 focus:border-orange-300 focus:outline-none transition-shadow" 
                                              />
                                            </td>
                                            <td className="py-3 px-2">
                                              <select
                                                value={status}
                                                onChange={(e) => updateUserManhours(act.id, sessionUser?.id, 'status', e.target.value)}
                                                className={`w-full px-2 py-1 text-xs font-medium rounded-md border focus:ring-2 focus:outline-none transition-shadow ${
                                                  status === 'Completed' ? 'text-emerald-700 bg-emerald-50 border-emerald-200 focus:ring-emerald-200' :
                                                  status === 'In Progress' ? 'text-blue-700 bg-blue-50 border-blue-200 focus:ring-blue-200' :
                                                  status === 'On Hold' ? 'text-amber-700 bg-amber-50 border-amber-200 focus:ring-amber-200' :
                                                  'text-slate-600 bg-slate-50 border-slate-200 focus:ring-slate-200'
                                                }`}
                                              >
                                                <option value="Not Started">Not Started</option>
                                                <option value="In Progress">In Progress</option>
                                                <option value="Completed">Completed</option>
                                                <option value="On Hold">On Hold</option>
                                              </select>
                                            </td>
                                            <td className="py-3 px-3">
                                              <input
                                                type="text"
                                                value={remarks}
                                                onChange={(e) => updateUserManhours(act.id, sessionUser?.id, 'remarks', e.target.value)}
                                                className="w-full px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md focus:ring-2 focus:ring-amber-200 focus:border-amber-300 focus:outline-none transition-shadow"
                                                placeholder="Add note..."
                                              />
                                            </td>
                                            <td className="py-3 px-1"></td>
                                          </tr>

                                          {/* Daily Entry Rows */}
                                          {dailyEntries.map((entry, eIdx) => {
                                            // Entry is locked if explicitly marked or from a previous day
                                            const today = new Date();
                                            today.setHours(0, 0, 0, 0);
                                            const entryDate = entry.date ? new Date(entry.date) : null;
                                            if (entryDate) entryDate.setHours(0, 0, 0, 0);
                                            const isLocked = entry.isLocked === true || (entryDate && entryDate < today);
                                            
                                            // Calculate remaining qty balance up to this entry
                                            const doneUpToThisEntry = dailyEntries.slice(0, eIdx + 1).reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
                                            const remainingQtyAfterThisEntry = (parseFloat(qtyAssigned) || 0) - doneUpToThisEntry;
                                            
                                            // Calculate remaining hours balance up to this entry
                                            const hoursUpToThisEntry = dailyEntries.slice(0, eIdx + 1).reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
                                            const remainingHoursAfterThisEntry = (parseFloat(plannedHrs) || 0) - hoursUpToThisEntry;
                                            
                                            return (
                                              <tr key={`${act.id}-day-${eIdx}`} className={`border-b border-slate-100 transition-colors ${isLocked ? 'bg-slate-50/50' : 'hover:bg-slate-50/80'}`}>
                                                <td className="py-2.5 px-3"></td>
                                                <td className="py-2.5 px-3">
                                                  <div className="flex items-center gap-2 pl-4">
                                                    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                                      Day {eIdx + 1}
                                                    </span>
                                                    {isLocked && <span className="text-amber-500 text-[10px]" title="Entry locked">🔒</span>}
                                                  </div>
                                                </td>
                                                <td className="py-2.5 px-2 text-center">
                                                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] text-slate-600 bg-emerald-50 rounded font-medium">
                                                    {entry.date ? new Date(entry.date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '–'}
                                                  </span>
                                                </td>
                                                {/* Hours - Plan (empty for daily rows) */}
                                                <td className="py-2.5 px-2 text-center bg-blue-50/20">
                                                  <span className="text-slate-300">·</span>
                                                </td>
                                                {/* Hours - Actual */}
                                                <td className="py-2.5 px-2 text-center bg-blue-50/20">
                                                  {isLocked ? (
                                                    <span className="inline-flex items-center justify-center w-12 px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 rounded">{entry.hours || '–'}</span>
                                                  ) : (
                                                    <input
                                                      type="number"
                                                      value={entry.hours || ''}
                                                      onChange={(e) => updateDailyEntry(act.id, sessionUser?.id, eIdx, 'hours', e.target.value)}
                                                      className="w-12 px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded text-center focus:ring-1 focus:ring-blue-300 focus:border-blue-300 focus:outline-none"
                                                      placeholder="0"
                                                      min="0"
                                                      step="0.5"
                                                    />
                                                  )}
                                                </td>
                                                {/* Qty - Assigned (empty for daily rows) */}
                                                <td className="py-2.5 px-2 text-center bg-purple-50/20">
                                                  <span className="text-slate-300">·</span>
                                                </td>
                                                {/* Qty - Done */}
                                                <td className="py-2.5 px-2 text-center bg-purple-50/20">
                                                  {isLocked ? (
                                                    <span className="inline-flex items-center justify-center w-12 px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 rounded">{entry.qty_done || '–'}</span>
                                                  ) : (
                                                    <input
                                                      type="number"
                                                      value={entry.qty_done || ''}
                                                      onChange={(e) => updateDailyEntry(act.id, sessionUser?.id, eIdx, 'qty_done', e.target.value)}
                                                      className="w-12 px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded text-center focus:ring-1 focus:ring-purple-300 focus:border-purple-300 focus:outline-none"
                                                      placeholder="0"
                                                      min="0"
                                                    />
                                                  )}
                                                </td>
                                                {/* Qty - Balance */}
                                                <td className="py-2.5 px-2 text-center bg-purple-100/20">
                                                  <span className={`inline-flex items-center justify-center w-12 px-2 py-0.5 text-[11px] font-semibold rounded ${
                                                    remainingQtyAfterThisEntry > 0 ? 'text-orange-600 bg-orange-50' : 
                                                    remainingQtyAfterThisEntry === 0 ? 'text-emerald-600 bg-emerald-50' : 
                                                    'text-red-600 bg-red-50'
                                                  }`}>
                                                    {qtyAssigned ? remainingQtyAfterThisEntry : '–'}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-2"></td>
                                                <td className="py-2.5 px-2"></td>
                                                <td className="py-2.5 px-3">
                                                  {isLocked ? (
                                                    <span className="text-[11px] text-slate-500">{entry.remarks || '–'}</span>
                                                  ) : (
                                                    <input
                                                      type="text"
                                                      value={entry.remarks || ''}
                                                      onChange={(e) => updateDailyEntry(act.id, sessionUser?.id, eIdx, 'remarks', e.target.value)}
                                                      className="w-full px-2 py-0.5 text-[11px] text-slate-600 bg-white border border-slate-200 rounded focus:ring-1 focus:ring-amber-200 focus:border-amber-300 focus:outline-none"
                                                      placeholder="Add note..."
                                                    />
                                                  )}
                                                </td>
                                                <td className="py-2.5 px-1 text-center">
                                                  {!isLocked && (
                                                    <button 
                                                      type="button" 
                                                      onClick={() => removeDailyEntry(act.id, sessionUser?.id, eIdx)} 
                                                      className="w-5 h-5 inline-flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                      title="Remove"
                                                    >
                                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                    </button>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}

                                          {/* No entries message */}
                                          {dailyEntries.length === 0 && (
                                            <tr>
                                              <td className="py-4 px-3"></td>
                                              <td colSpan={10} className="py-4 px-3">
                                                <div className="flex items-center justify-center gap-2 text-slate-400">
                                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                                  <span className="text-xs">No daily entries yet. Click &quot;+ Add Day&quot; to log your work.</span>
                                                </div>
                                              </td>
                                              <td className="py-4 px-1"></td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
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
                            <th className="text-left py-3 px-4 font-semibold" style={{ width: '20%' }}>Discipline</th>
                            <th className="text-left py-3 px-4 font-semibold" style={{ width: '25%' }}>Activity</th>
                            <th className="text-left py-3 px-4 font-semibold" style={{ width: '30%' }}>Description</th>
                            <th className="text-left py-3 px-4 font-semibold" style={{ width: '25%' }}>Sub-Activity</th>
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
                                  <td className="py-3 px-4 text-gray-400 italic" colSpan="3">No activities defined</td>
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
                                      {isActivitySelected ? (
                                        <input
                                          type="text"
                                          value={projectActivities.find(pa => pa.id === activity.id && pa.type === 'activity')?.description || ''}
                                          onChange={(e) => {
                                            setProjectActivities(prev => prev.map(pa => 
                                              pa.id === activity.id && pa.type === 'activity' 
                                                ? { ...pa, description: e.target.value } 
                                                : pa
                                            ));
                                          }}
                                          placeholder="Enter description..."
                                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                                        />
                                      ) : (
                                        <span className="text-gray-400 text-xs">—</span>
                                      )}
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
                                    disabled
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
