'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  DocumentTextIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  PhoneIcon,
  EnvelopeIcon,
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  IdentificationIcon,
  UserGroupIcon,
  TagIcon,
  AdjustmentsHorizontalIcon,
  DocumentDuplicateIcon,
  InformationCircleIcon,
  ClipboardDocumentListIcon,
  CreditCardIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';

export default function EditProposalPage() {
  const router = useRouter();
  const params = useParams();
  const proposalId = params?.id;
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(true);

  const [proposalData, setProposalData] = useState({
    // Basic
    proposal_id: '',
    proposal_title: '',
    description: '',
    company_id: null,
    client_name: '',
    industry: '',
    contract_type: '',
    project_type: '',
    proposal_value: 0,
    
    // Pricing fields based on project type
    lumpsum_cost: 0,
    total_lines: 0,
    per_line_charges: 0,
    total_line_cost: 0,
    total_manhours: 0,
    manhour_charges: 0,
    total_manhour_cost: 0,

    // Schedule (minimal here; notes are in Scope)
    planned_start_date: '',
    planned_end_date: '',
    project_duration_planned: '',
    target_date: '',
    project_schedule: '',

    // Scope
    input_document: '',
    list_of_deliverables: '',
    disciplines: [],
    activities: [],
    discipline_descriptions: {},
    planning_activities_list: [],
    documents_list: [],

    // Meetings
    kickoff_meeting: '',
    in_house_meeting: '',
    kickoff_meeting_date: '',
    internal_meeting_date: '',
    next_internal_meeting: '',

    // Financial
    budget: 0,
    cost_to_company: 0,
    profitability_estimate: 0,
    major_risks: '',
    mitigation_plans: '',

    // Hours
    planned_hours_total: 0,
    actual_hours_total: 0,
    planned_hours_by_discipline: {},
    actual_hours_by_discipline: {},
    planned_hours_per_activity: {},
    actual_hours_per_activity: {},
    hours_variance_total: 0,
    hours_variance_percentage: 0,
    productivity_index: 0,

    // Client & Location
    client_contact_details: '',
    project_location_country: '',
    project_location_city: '',
    project_location_site: '',

    // Status
    status: 'DRAFT',
    priority: 'MEDIUM',
    progress: 0,
    notes: '',

    // Linkage
    lead_id: null,
    project_id: null,

    // Commercials (for the table tab)
    commercial_items: [
      {
        id: Date.now(),
        sr_no: 1,
        activities: '',
        scope_of_work: '',
        man_hours: 0,
        man_hour_rate: 0,
        total_amount: 0,
      },
    ],

    // Quotation
    quotation_number: '',
    quotation_date: '',
    enquiry_number: '',
    enquiry_date: '',

    // New Quotation-related fields
    software: '',
  software_items: [],
    duration: '',
    site_visit: '',
    quotation_validity: '',
    mode_of_delivery: '',
    revision: '',
    exclusions: '',
    billing_payment_terms: `Payment shall be released by the client within 7 days from the date of the invoice.
• Payment shall be by way of RTGS transfer to ATSPL bank account.
• The late payment charges will be 2% per month on the total bill amount if bills are not settled within the credit period of 30 days.
• In case of project delays beyond two-month, software cost of ₹10,000/- per month will be charged.
• Upon completion of the above scope of work, if a project is cancelled or held by the client for any reason then Accent Techno Solutions Private Limited is entitled to 100% invoice against the completed work.`,

    other_terms: `Confidentiality
• Input, output& any excerpts in between is intellectual properties of client. ATS shall not voluntarily disclose any of such documents to third parties& will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information. ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client   that it may come across. ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.

Codes and Standards:
• Basic Engineering/ Detail Engineering should be carried out in ATS’s office as per good engineering practices, project specifications and applicable client’s inputs, Indian and International Standards

Dispute Resolution
• Should any disputes arise as claimed breach of the contract originated by this offer, it shall be finally settled amicably. Teamwork shall be the essence of this contract.`,

    additional_fields: '',

    // General terms and preserve earlier payment_terms field
    general_terms: `General Terms and conditions
• Any additional work will be charged extra
• GST 18% extra as applicable on total project cost.
• The proposal is based on client's enquiry and provided input data
• Work will start within 15 days after receipt of confirmed LOI/PO.
• Mode of Payments: - Through Wire transfer to ‘Accent Techno Solutions Pvt Ltd.’ payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244`,

    payment_terms: '',
  });
  const [linkedLead, setLinkedLead] = useState(null);

  // Fetch once on mount (and when id changes)
  useEffect(() => {
    const fetchProposal = async () => {
      if (!proposalId) return;
      try {
        setLoading(true);
        // If a proposal id value was passed via query (e.g., ?pid=ATSPL/...), set it immediately so the textbox shows a value
        try {
          const pid = searchParams?.get?.('pid');
          if (pid) {
            setProposalData(prev => ({ ...prev, proposal_id: pid }));
          }
        } catch {
          // ignore
        }
        const res = await fetch(`/api/proposals/${proposalId}`);
        const data = await res.json();

        if (data?.success && data?.proposal) {
          const p = data.proposal;

          // Parse possibly-stringified JSON fields
          const parseMaybe = (val, fallback) => {
            if (val == null) return fallback;
            if (typeof val === 'string') {
              try {
                return JSON.parse(val);
              } catch {
                return fallback ?? val;
              }
            }
            return val;
          };

          setProposalData(prev => ({
            ...prev,
            proposal_id: p.proposal_id ?? '',
            proposal_title: p.proposal_title ?? p.title ?? '',
            description: p.description ?? p.project_description ?? '',
            company_id: p.company_id ?? null,
            client_name: p.client_name ?? p.client ?? '',
            
            industry: p.industry ?? '',
            contract_type: p.contract_type ?? '',
            project_type: p.project_type ?? '',
            proposal_value: p.proposal_value ?? p.value ?? 0,
            
            // Pricing fields based on project type
            lumpsum_cost: p.lumpsum_cost ?? 0,
            total_lines: p.total_lines ?? 0,
            per_line_charges: p.per_line_charges ?? 0,
            total_line_cost: p.total_line_cost ?? 0,
            total_manhours: p.total_manhours ?? 0,
            manhour_charges: p.manhour_charges ?? 0,
            total_manhour_cost: p.total_manhour_cost ?? 0,
            
            payment_terms: p.payment_terms ?? '',
            planned_start_date: p.planned_start_date ?? '',
            planned_end_date: p.planned_end_date ?? '',
            project_duration_planned: p.project_duration_planned ?? '',
            target_date: p.target_date ?? p.due_date ?? '',
            project_schedule: p.project_schedule ?? '',
            input_document: p.input_document ?? '',
            list_of_deliverables: p.list_of_deliverables ?? '',
            disciplines: parseMaybe(p.disciplines, []),
            activities: parseMaybe(p.activities, []),
            discipline_descriptions: parseMaybe(p.discipline_descriptions, {}),
            planning_activities_list: parseMaybe(p.planning_activities_list, []),
            documents_list: parseMaybe(p.documents_list, []),
            kickoff_meeting: p.kickoff_meeting ?? '',
            in_house_meeting: p.in_house_meeting ?? '',
            kickoff_meeting_date: p.kickoff_meeting_date ?? '',
            internal_meeting_date: p.internal_meeting_date ?? '',
            next_internal_meeting: p.next_internal_meeting ?? '',
            budget: p.budget ?? 0,
            cost_to_company: p.cost_to_company ?? 0,
            profitability_estimate: p.profitability_estimate ?? 0,
            major_risks: p.major_risks ?? '',
            mitigation_plans: p.mitigation_plans ?? '',
            planned_hours_total: p.planned_hours_total ?? 0,
            actual_hours_total: p.actual_hours_total ?? 0,
            planned_hours_by_discipline: parseMaybe(p.planned_hours_by_discipline, {}),
            actual_hours_by_discipline: parseMaybe(p.actual_hours_by_discipline, {}),
            planned_hours_per_activity: parseMaybe(p.planned_hours_per_activity, {}),
            actual_hours_per_activity: parseMaybe(p.actual_hours_per_activity, {}),
            hours_variance_total: p.hours_variance_total ?? 0,
            hours_variance_percentage: p.hours_variance_percentage ?? 0,
            productivity_index: p.productivity_index ?? 0,
            client_contact_details: p.client_contact_details ?? p.contact_name ?? '',
            project_location_country: p.project_location_country ?? '',
            project_location_city: p.project_location_city ?? p.city ?? '',
            project_location_site: p.project_location_site ?? '',
            status: p.status ?? 'DRAFT',
            priority: p.priority ?? 'MEDIUM',
            progress: p.progress ?? 0,
            notes: p.notes ?? '',
            software: p.software ?? '',
            software_items: Array.isArray(p.software_items) ? p.software_items : parseMaybe(p.software_items, []),
            duration: p.duration ?? p.project_duration_planned ?? '',
            site_visit: p.site_visit ?? '',
            quotation_validity: p.quotation_validity ?? '',
            mode_of_delivery: p.mode_of_delivery ?? '',
            revision: p.revision ?? '',
            exclusions: p.exclusions ?? '',
            billing_payment_terms: p.billing_payment_terms ?? prev.billing_payment_terms,
            other_terms: p.other_terms ?? prev.other_terms,
            additional_fields: p.additional_fields ?? prev.additional_fields,
            lead_id: p.lead_id ?? null,
            project_id: p.project_id ?? null,
            commercial_items: Array.isArray(p.commercial_items)
              ? p.commercial_items
              : parseMaybe(p.commercial_items, prev.commercial_items),
            general_terms: p.general_terms ?? prev.general_terms,
            quotation_number: p.quotation_number ?? '',
            quotation_date: p.quotation_date ?? '',
            enquiry_number: p.enquiry_number ?? '',
            enquiry_date: p.enquiry_date ?? '',
          }));

          // If this proposal is linked to a lead, fetch lead details and prefill client/project fields
          if (p?.lead_id) {
            try {
              const leadRes = await fetch(`/api/leads/${p.lead_id}`);
              const leadJson = await leadRes.json();
              if (leadJson?.success) {
                const lead = leadJson.data;
                setLinkedLead(lead);
                setProposalData(prev => ({
                  ...prev,
                  // prefer existing proposal values, fallback to lead values
                  client_name: prev.client_name || lead.company_name || lead.company || prev.client_name,
                  description: prev.description || lead.description || prev.notes || prev.description,
                  // also surface the lead id in the form data
                  lead_id: p.lead_id,
                  enquiry_number: prev.enquiry_number || lead.id || p.lead_id
                }));
              }
            } catch (e) {
              console.warn('Failed to fetch linked lead', e);
            }
          }
        }
      } catch (e) {
        console.error('Error fetching proposal:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchProposal();
  }, [proposalId, searchParams]);

  const handleSave = async () => {
    try {
      const processed = { ...proposalData };

      // JSON stringify complex fields for DB
      [
        'disciplines',
        'activities',
        'discipline_descriptions',
        'planning_activities_list',
        'documents_list',
        'planned_hours_by_discipline',
        'actual_hours_by_discipline',
        'planned_hours_per_activity',
        'actual_hours_per_activity',
        'commercial_items',
          'software_items',
          'additional_fields',
      ].forEach((key) => {
        if (processed[key] && typeof processed[key] === 'object') {
          processed[key] = JSON.stringify(processed[key]);
        }
      });

  // No annexure_* mapping — API persists frontend fields directly now

      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processed),
      });
      const result = await res.json();
      alert(result?.success ? 'Proposal saved successfully!' : 'Failed to save proposal.');
    } catch (e) {
      alert('Error saving proposal: ' + e.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="w-full px-8 py-16">
          <p className="text-gray-600">Loading proposal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Fixed navbar from your app */}
      <Navbar />

      {/* Header — compact, no extra margins */}
      <div className="flex-shrink-0 bg-gray-50">
        <div className="w-full px-8 pt-8 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/proposals')}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <ArrowLeftIcon className="h-6 w-6" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Edit Proposal</h1>
                <p className="text-gray-600 text-sm">
                  {proposalData.proposal_title || 'Untitled Proposal'}
                </p>
                {(linkedLead || proposalData.lead_id) && (
                  <p className="text-xs text-gray-500 mt-1">
                    Linked Lead:{' '}
                    <a href={`/leads/${linkedLead?.id || proposalData.lead_id}/edit`} className="text-indigo-600 hover:underline">
                      {linkedLead?.id ? `${linkedLead.id}${linkedLead.company_name ? ` — ${linkedLead.company_name}` : ''}` : proposalData.lead_id}
                    </a>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setActiveTab('followups');
                  // Small delay to ensure tab switch before triggering form
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('openFollowupForm'));
                  }, 100);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
              >
                <PlusIcon className="h-4 w-4" />
                Add Follow-up
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs — sticky below header (adjust top if your Navbar is fixed) */}
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200">
        <div className="w-full px-8">
          <div className="flex flex-wrap -mb-px gap-2">
            {/* Reordered per user request: show primary tabs in the exact sequence specified */}
            <Tab label="Basic info" id="basic" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Scope of work" id="scope" activeTab={activeTab} setActiveTab={setActiveTab} icon={Cog6ToothIcon} />
            <Tab label="Input documents" id="input_documents" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Deliverables" id="deliverables" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Software" id="software" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            {/* Schedule moved into Quotation Details as Duration; no separate Schedule tab */}
            <Tab label="Mode of Delivery" id="mode_of_delivery" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Revision" id="revision" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Site Visit" id="site_visit" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Quotation Validity" id="quotation_validity" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />
            <Tab label="Exclusions" id="exclusions" activeTab={activeTab} setActiveTab={setActiveTab} icon={DocumentTextIcon} />

            {/* Keep remaining tabs after the primary sequence so we don't remove any functionality */}
            <Tab label="Commercials" id="commercials" activeTab={activeTab} setActiveTab={setActiveTab} icon={CurrencyDollarIcon} />
            <Tab label="Quotation details" id="quotation" activeTab={activeTab} setActiveTab={setActiveTab} icon={ChartBarIcon} />
            <Tab label="Follow-ups" id="followups" activeTab={activeTab} setActiveTab={setActiveTab} icon={ChatBubbleLeftRightIcon} />
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-8 py-8">
          <div className="bg-white shadow-sm rounded-none p-8 w-full">
            {activeTab === 'basic' && (
              <BasicInfoForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'scope' && (
              <ScopeForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'input_documents' && (
              <InputDocumentsForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'deliverables' && (
              <DeliverablesForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'software' && (
              <SoftwareForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'schedule' && (
              <ScheduleForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'mode_of_delivery' && (
              <ModeOfDeliveryPage proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'revision' && (
              <RevisionPage proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'site_visit' && (
              <SiteVisitPage proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'quotation_validity' && (
              <QuotationValidityPage proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'exclusions' && (
              <ExclusionsPage proposalData={proposalData} setProposalData={setProposalData} />
            )}

            {/* Keep existing secondary tabs after the primary ordered list */}
            {activeTab === 'commercials' && (
              <CommercialsForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'quotation' && (
              <QuotationForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'meetings' && (
              <MeetingsForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'financial' && (
              <FinancialForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'hours' && (
              <HoursForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'location' && (
              <ClientLocationForm proposalData={proposalData} setProposalData={setProposalData} />
            )}
            {activeTab === 'followups' && (
              <FollowupsForm proposalId={proposalId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- New main-tab pages ---------------------- */
function SiteVisitPage({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  return (
    <div className="space-y-6">
      <Section title="Site Visit" subtitle="Site visit notes for the quotation" />
      <Textarea label="Site Visit" rows={6} value={proposalData.site_visit} onChange={v => set('site_visit', v)} />
    </div>
  );
}

function QuotationValidityPage({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  return (
    <div className="space-y-6">
      <Section title="Quotation Validity" subtitle="Validity period for the quotation" />
      <Text label="Quotation Validity" value={proposalData.quotation_validity} onChange={v => set('quotation_validity', v)} />
    </div>
  );
}

function ModeOfDeliveryPage({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  return (
    <div className="space-y-6">
      <Section title="Mode of Delivery" subtitle="How the deliverables will be delivered" />
      <Text label="Mode of Delivery" value={proposalData.mode_of_delivery} onChange={v => set('mode_of_delivery', v)} />
    </div>
  );
}

function RevisionPage({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  return (
    <div className="space-y-6">
      <Section title="Revision" subtitle="Revision details for the quotation" />
      <Text label="Revision" value={proposalData.revision} onChange={v => set('revision', v)} />
    </div>
  );
}

function ExclusionsPage({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  return (
    <div className="space-y-6">
      <Section title="Exclusions" subtitle="Exclusions applicable to the quotation" />
      <Textarea label="Exclusions" rows={6} value={proposalData.exclusions} onChange={v => set('exclusions', v)} />
    </div>
  );
}

/* -------------------------- UI Helpers -------------------------- */

function Tab({ id, label, activeTab, setActiveTab, icon: Icon }) {
  const isActive = activeTab === id;
  return (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 transition-colors ${
        isActive
          ? 'border-green-600 text-green-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function fieldSetter(setter) {
  return (field, value) =>
    setter(prev => ({
      ...prev,
      [field]: value,
    }));
}

function BasicInfoForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  const CardHeader = ({ icon: Icon, title, subtitle, color }) => (
    <div className={`flex items-center gap-3 pb-4 mb-4 border-b border-${color}-200`}>
      <div className={`p-2 rounded-lg bg-${color}-100`}>
        <Icon className={`h-5 w-5 text-${color}-600`} />
      </div>
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
    </div>
  );

  return (
    <div>
      {/* 4-Column Grid Layout with Equal Dimensions */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        
        {/* Column 1: Identification */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-purple-200">
            <div className="p-2 rounded-lg bg-purple-100">
              <IdentificationIcon className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Identification</h3>
              <p className="text-xs text-gray-500">Basic proposal information</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <ProposalIdField label="Proposal ID *" value={proposalData.proposal_id} onChange={v => set('proposal_id', v)} required />
            <Text label="Proposal Title *" value={proposalData.proposal_title} onChange={v => set('proposal_title', v)} required />
            <Textarea label="Description" rows={4} value={proposalData.description} onChange={v => set('description', v)} />
          </div>
        </div>

        {/* Column 2: Client Details */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-blue-200">
            <div className="p-2 rounded-lg bg-blue-100">
              <UserGroupIcon className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Client Details</h3>
              <p className="text-xs text-gray-500">Client information</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <Text label="Client Name" value={proposalData.client_name} onChange={v => set('client_name', v)} />
            <Text label="Industry" placeholder="e.g., Oil & Gas, Petrochemical…" value={proposalData.industry} onChange={v => set('industry', v)} />
          </div>
        </div>

        {/* Column 3: Types */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-amber-200">
            <div className="p-2 rounded-lg bg-amber-100">
              <TagIcon className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Types</h3>
              <p className="text-xs text-gray-500">Contract and project types</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <Text label="Contract Type" placeholder="e.g., EPC, Consultancy, T&M…" value={proposalData.contract_type} onChange={v => set('contract_type', v)} />
            <Select
              label="Type of Project"
              value={proposalData.project_type}
              onChange={v => set('project_type', v)}
              options={[
                { value: '', label: 'Select Type' },
                { value: 'lumpsum', label: 'Lumpsum' },
                { value: 'manhours_basis', label: 'Manhours Basis' },
                { value: 'line_wise', label: 'Line Wise' },
              ]}
            />
            
            {/* Conditional fields based on project type */}
            {proposalData.project_type === 'lumpsum' && (
              <div className="pt-3 border-t border-amber-100">
                <Number 
                  label="Lumpsum Cost" 
                  min={0} 
                  step={0.01} 
                  value={proposalData.lumpsum_cost} 
                  onChange={v => set('lumpsum_cost', v)} 
                />
              </div>
            )}
            
            {proposalData.project_type === 'line_wise' && (
              <div className="pt-3 border-t border-amber-100 space-y-3">
                <Number 
                  label="Total Lines" 
                  min={0} 
                  step={1} 
                  value={proposalData.total_lines} 
                  onChange={v => {
                    set('total_lines', v);
                    const totalCost = (v || 0) * (proposalData.per_line_charges || 0);
                    set('total_line_cost', totalCost);
                  }} 
                />
                <Number 
                  label="Per Line Charges" 
                  min={0} 
                  step={0.01} 
                  value={proposalData.per_line_charges} 
                  onChange={v => {
                    set('per_line_charges', v);
                    const totalCost = (proposalData.total_lines || 0) * (v || 0);
                    set('total_line_cost', totalCost);
                  }} 
                />
                <div className="bg-amber-50 p-3 rounded-lg">
                  <label className="block text-xs font-medium text-amber-700 mb-1">Total Cost (Auto-calculated)</label>
                  <div className="text-lg font-semibold text-amber-900">₹ {(proposalData.total_line_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            )}
            
            {proposalData.project_type === 'manhours_basis' && (
              <div className="pt-3 border-t border-amber-100 space-y-3">
                <Number 
                  label="Total Manhours" 
                  min={0} 
                  step={0.5} 
                  value={proposalData.total_manhours} 
                  onChange={v => {
                    set('total_manhours', v);
                    const totalCost = (v || 0) * (proposalData.manhour_charges || 0);
                    set('total_manhour_cost', totalCost);
                  }} 
                />
                <Number 
                  label="Manhour Charges" 
                  min={0} 
                  step={0.01} 
                  value={proposalData.manhour_charges} 
                  onChange={v => {
                    set('manhour_charges', v);
                    const totalCost = (proposalData.total_manhours || 0) * (v || 0);
                    set('total_manhour_cost', totalCost);
                  }} 
                />
                <div className="bg-amber-50 p-3 rounded-lg">
                  <label className="block text-xs font-medium text-amber-700 mb-1">Total Manhour Cost (Auto-calculated)</label>
                  <div className="text-lg font-semibold text-amber-900">₹ {(proposalData.total_manhour_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Column 4: Status & Control */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-green-200">
            <div className="p-2 rounded-lg bg-green-100">
              <AdjustmentsHorizontalIcon className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Status & Control</h3>
              <p className="text-xs text-gray-500">Status and tracking</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Status"
                value={proposalData.status}
                onChange={v => set('status', v)}
                options={[
                  { value: 'DRAFT', label: 'Draft' },
                  { value: 'SUBMITTED', label: 'Submitted' },
                  { value: 'APPROVED', label: 'Approved' },
                  { value: 'REJECTED', label: 'Rejected' },
                ]}
              />
              <Select
                label="Priority"
                value={proposalData.priority}
                onChange={v => set('priority', v)}
                options={[
                  { value: 'LOW', label: 'Low' },
                  { value: 'MEDIUM', label: 'Medium' },
                  { value: 'HIGH', label: 'High' },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Number label="Progress (%)" min={0} max={100} step={0.1} value={proposalData.progress} onChange={v => set('progress', v)} />
              <Number label="Proposal Value" min={0} step={0.01} value={proposalData.proposal_value} onChange={v => set('proposal_value', v)} />
            </div>
            <Textarea label="Payment Terms" rows={2} value={proposalData.payment_terms} onChange={v => set('payment_terms', v)} />
            <Textarea label="Notes" rows={2} value={proposalData.notes} onChange={v => set('notes', v)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScopeForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  return (
    <div className="space-y-8">
      <Section title="Scope of Work" subtitle="Define the scope and deliverables" />
      <Textarea label="Scope Summary" rows={6} value={proposalData.description} onChange={v => set('description', v)} />
  <Note>Use the Input documents tab to manage input documents for this proposal.</Note>
    </div>
  );
}

function InputDocumentsForm({ proposalData, setProposalData }) {
  const [docs, setDocs] = useState(() => {
    if (!proposalData || !proposalData.input_document) return [];
    const arr = String(proposalData.input_document)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    return arr;
  });
  const [newDoc, setNewDoc] = useState('');

  useEffect(() => {
    // keep local docs in sync if parent changes externally
    const arr = proposalData && proposalData.input_document
      ? String(proposalData.input_document).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      : [];
    if (JSON.stringify(arr) !== JSON.stringify(docs)) setDocs(arr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalData.input_document, docs]);

  const persist = (nextDocs) => {
    setDocs(nextDocs);
    setProposalData(prev => ({ ...prev, input_document: nextDocs.join('\n') }));
  };

  const handleAdd = () => {
    const v = String(newDoc || '').trim();
    if (!v) return;
    const next = [...docs, v];
    persist(next);
    setNewDoc('');
  };

  const handleRemove = (idx) => {
    const next = docs.filter((_, i) => i !== idx);
    persist(next);
  };

  return (
    <div className="space-y-6">
      <Section title="Input Documents" subtitle="Documents required as input for this proposal" />

      <div className="flex gap-2">
        <input
          type="text"
          value={newDoc}
          onChange={e => setNewDoc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          placeholder="Enter a document name or description…"
          className="flex-1 px-3 py-2 border border-gray-300 rounded"
        />
        <button type="button" onClick={handleAdd} className="px-4 py-2 bg-green-600 text-white rounded">Add</button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="py-2 px-3 text-left">#</th>
              <th className="py-2 px-3 text-left">Document</th>
              <th className="py-2 px-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.length ? docs.map((d, i) => (
              <tr key={i} className="border-b">
                <td className="py-2 px-3 w-12">{i + 1}</td>
                <td className="py-2 px-3">{d}</td>
                <td className="py-2 px-3 text-center">
                  <button type="button" onClick={() => handleRemove(i)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded">Remove</button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={3} className="py-4 px-3 text-sm text-gray-500">No input documents added.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeliverablesForm({ proposalData, setProposalData }) {
  // Implement single textbox + Add + table UI (same behaviour as InputDocumentsForm)
  const [items, setItems] = useState(() => {
    if (!proposalData || !proposalData.list_of_deliverables) return [];
    const arr = String(proposalData.list_of_deliverables)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    return arr;
  });
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    const arr = proposalData && proposalData.list_of_deliverables
      ? String(proposalData.list_of_deliverables).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      : [];
    if (JSON.stringify(arr) !== JSON.stringify(items)) setItems(arr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalData.list_of_deliverables, items]);

  const persist = (next) => {
    setItems(next);
    setProposalData(prev => ({ ...prev, list_of_deliverables: next.join('\n') }));
  };

  const handleAdd = () => {
    const v = String(newItem || '').trim();
    if (!v) return;
    const next = [...items, v];
    persist(next);
    setNewItem('');
  };

  const handleRemove = (idx) => {
    const next = items.filter((_, i) => i !== idx);
    persist(next);
  };

  return (
    <div className="space-y-6">
      <Section title="Deliverables" subtitle="List of deliverables for this proposal" />

      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          placeholder="Enter a deliverable description…"
          className="flex-1 px-3 py-2 border border-gray-300 rounded"
        />
        <button type="button" onClick={handleAdd} className="px-4 py-2 bg-green-600 text-white rounded">Add</button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="py-2 px-3 text-left">#</th>
              <th className="py-2 px-3 text-left">Deliverable</th>
              <th className="py-2 px-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((d, i) => (
              <tr key={i} className="border-b">
                <td className="py-2 px-3 w-12">{i + 1}</td>
                <td className="py-2 px-3">{d}</td>
                <td className="py-2 px-3 text-center">
                  <button type="button" onClick={() => handleRemove(i)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded">Remove</button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={3} className="py-4 px-3 text-sm text-gray-500">No deliverables added.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SoftwareForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  // Clean and validate items on initial load
  const cleanItems = (rawItems) => {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .filter(it => it && typeof it === 'object') // Remove null/undefined/non-objects
      .map(it => {
        // Parse versions if it's a stringified array
        let versions = it.versions;
        if (typeof versions === 'string') {
          try {
            const parsed = JSON.parse(versions);
            if (Array.isArray(parsed)) {
              // Extract names if array contains objects
              versions = parsed.map(v => 
                typeof v === 'object' && v.name ? v.name : String(v)
              ).filter(Boolean);
            } else {
              versions = [];
            }
          } catch {
            // If parsing fails, treat as comma-separated string
            versions = versions.split(',').map(s => s.trim()).filter(Boolean);
          }
        } else if (Array.isArray(versions)) {
          // Convert array of objects to array of names
          versions = versions.map(v => 
            typeof v === 'object' && v.name ? v.name : String(v)
          ).filter(Boolean);
        } else {
          versions = [];
        }
        
        return {
          id: Number(it.id) || 0,
          name: String(it.name || '').trim(),
          versions: versions,
          current_version: String(it.current_version || '').trim(),
          provider: String(it.provider || '').trim()
        };
      })
      .filter(it => it.id > 0 || it.name); // Keep only items with valid id or name
  };

  const itemsInitial = cleanItems(proposalData.software_items);
  const [items, setItems] = useState(itemsInitial);
  const [masterSoftwares, setMasterSoftwares] = useState([]);
  const [selectedMasterId, setSelectedMasterId] = useState('');

  useEffect(() => {
    const cleaned = cleanItems(proposalData.software_items);
    setItems(cleaned);
  }, [proposalData.software_items]);

  // Load software master and flatten into a simple list for selection
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/software-master');
        const json = await res.json();
        if (!mounted) return;
        if (json?.success && Array.isArray(json.data)) {
          // Flatten categories -> softwares
          const flat = [];
          json.data.forEach(cat => {
            (cat.softwares || []).forEach(sw => {
              // Extract version names from version objects
              const versionNames = (sw.versions || []).map(v => 
                typeof v === 'object' && v.name ? v.name : String(v)
              ).filter(Boolean);
              
              flat.push({ 
                id: sw.id, 
                name: sw.name, 
                provider: sw.provider || '', 
                versions: versionNames 
              });
            });
          });
          // sort by numeric id
          flat.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
          setMasterSoftwares(flat);
        }
      } catch {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  const syncToParent = (next) => {
    // Clean and sort before persisting
    const cleaned = cleanItems(next);
    const sorted = [...cleaned].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    setItems(sorted);
    set('software_items', sorted);
  };

  const addItem = () => {
    // If user selected an item from master, add that. Otherwise add a blank row with next numeric id.
    if (selectedMasterId) {
      const chosen = masterSoftwares.find(s => String(s.id) === String(selectedMasterId));
      if (!chosen) return;
      // prevent duplicates by id
      if (items.some(it => String(it.id) === String(chosen.id))) {
        alert('This software is already added to the proposal.');
        return;
      }
      const toAdd = { id: chosen.id, name: chosen.name || '', versions: Array.isArray(chosen.versions) ? chosen.versions : [], current_version: '', provider: chosen.provider || '' };
      syncToParent([...items, toAdd]);
      // clear selection
      setSelectedMasterId('');
      return;
    }

    // fallback: append a blank item with next available numeric id
    const maxId = items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0);
    const nextId = maxId + 1 || 1;
    const next = [
      ...items,
      { id: nextId, name: '', versions: [], current_version: '', provider: '' },
    ];
    syncToParent(next);
  };

  const updateItem = (idx, field, value) => {
    const next = items.map((it, i) => (i === idx ? { ...it, [field]: value } : it));
    syncToParent(next);
  };

  const removeItem = (idx) => {
    const next = items.filter((_, i) => i !== idx);
    syncToParent(next);
  };

  return (
    <div className="space-y-6">
      <Section title="Software" subtitle="Software inventory and versions" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <select 
            value={selectedMasterId} 
            onChange={e => setSelectedMasterId(e.target.value)} 
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="">Select from Software Master…</option>
            {masterSoftwares.map(sw => (
              <option key={sw.id} value={sw.id}>
                {sw.name}{sw.provider ? ` (${sw.provider})` : ''}
              </option>
            ))}
          </select>
          <button 
            type="button" 
            onClick={addItem} 
            className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            + Add Software
          </button>
        </div>
        {items.length > 0 && (
          <span className="text-sm text-gray-500">{items.length} software item{items.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {items.length > 0 ? (
        <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-3 px-4 text-left font-semibold text-gray-700">ID</th>
                <th className="py-3 px-4 text-left font-semibold text-gray-700">Software Name</th>
                <th className="py-3 px-4 text-left font-semibold text-gray-700">Available Versions</th>
                <th className="py-3 px-4 text-left font-semibold text-gray-700">Current Version</th>
                <th className="py-3 px-4 text-left font-semibold text-gray-700">Provider</th>
                <th className="py-3 px-4 text-center font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((it, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {it.id || 'N/A'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      value={it.name || ''}
                      onChange={e => updateItem(idx, 'name', e.target.value)}
                      placeholder="Enter software name"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      value={(Array.isArray(it.versions) ? it.versions.join(', ') : String(it.versions || ''))}
                      onChange={e => updateItem(idx, 'versions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder="v1.0, v1.1, v2.0"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500 text-xs"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      value={it.current_version || ''}
                      onChange={e => updateItem(idx, 'current_version', e.target.value)}
                      placeholder="e.g. v2.0"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      value={it.provider || ''}
                      onChange={e => updateItem(idx, 'provider', e.target.value)}
                      placeholder="Provider name"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button 
                      type="button" 
                      onClick={() => removeItem(idx)} 
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500 text-sm mb-4">No software items added yet</p>
          <p className="text-gray-400 text-xs">Select from the software master above or add a new item</p>
        </div>
      )}

      
    </div>
  );
}

function ScheduleForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  return (
    <div className="space-y-8">
      <Section title="Project Schedule" subtitle="Project schedule notes" />
      <Textarea label="Project Schedule Notes" rows={6} value={proposalData.project_schedule} onChange={v => set('project_schedule', v)} />
      <Note>These notes are stored on the proposal and will be saved when you use Save Changes.</Note>
    </div>
  );
}

function CommercialsForm({ proposalData, setProposalData }) {
  const [items, setItems] = useState(
    Array.isArray(proposalData.commercial_items) && proposalData.commercial_items.length
      ? proposalData.commercial_items
      : [
          {
            id: Date.now(),
            sr_no: 1,
            activities: '',
            scope_of_work: '',
            man_hours: 0,
            man_hour_rate: 0,
            total_amount: 0,
            discipline_id: '',
            activity_ids: [],
          },
        ]
  );

  const [disciplineOptions, setDisciplineOptions] = useState([]);
  const [activityOptions, setActivityOptions] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [discRes, actRes] = await Promise.all([
          fetch('/api/activity-master'),
          fetch('/api/activity-master/activities'),
        ]);
        const discJson = await discRes.json();
        const actJson = await actRes.json();

        if (!mounted) return;

        if (discJson?.success && Array.isArray(discJson.data)) setDisciplineOptions(discJson.data);
        if (actJson?.success && Array.isArray(actJson.data)) setActivityOptions(actJson.data);
      } catch (e) {
        console.warn('Failed to load activity master data:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setProposalData(prev => ({ ...prev, commercial_items: items }));
  }, [items, setProposalData]);

  const addItem = () => {
    setItems(prev => [
      ...prev,
      {
        id: Date.now(),
        sr_no: prev.length + 1,
        activities: '',
        scope_of_work: '',
        man_hours: 0,
        man_hour_rate: 0,
        total_amount: 0,
        discipline_id: '',
        activity_ids: [],
      },
    ]);
  };

  const removeItem = (id) => {
    setItems(prev =>
      prev
        .filter(i => i.id !== id)
        .map((i, idx) => ({ ...i, sr_no: idx + 1 }))
    );
  };

  const updateItem = (id, field, value) => {
    setItems(prev =>
      prev.map(i => {
        if (i.id !== id) return i;
        const updated = { ...i };

        if (field === 'man_hours' || field === 'man_hour_rate') {
          updated[field] = parseFloat(value || 0);
        } else {
          updated[field] = value;
        }

        // Recalculate total_amount
        const hours = parseFloat(updated.man_hours || 0);
        const rate = parseFloat(updated.man_hour_rate || 0);
        updated.total_amount = parseFloat((hours * rate).toFixed(2));

        return updated;
      })
    );
  };

  const totalManHours = useMemo(
    () => items.reduce((sum, i) => sum + (parseFloat(i.man_hours) || 0), 0),
    [items]
  );
  const totalAmount = useMemo(
    () => items.reduce((sum, i) => sum + (parseFloat(i.total_amount) || 0), 0),
    [items]
  );

  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-100">
            <CurrencyDollarIcon className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Commercial Breakdown</h2>
            <p className="text-sm text-gray-500">Activity-wise cost estimation</p>
          </div>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors shadow-sm"
        >
          <PlusIcon className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Commercial Items Cards */}
      <div className="space-y-4 mb-6">
        {items.map((item, index) => (
          <div key={item.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            {/* Card Header */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">
                  {item.sr_no}
                </span>
                <span className="font-medium text-gray-700">
                  {item.activity_ids?.length 
                    ? activityOptions.filter(a => item.activity_ids.map(String).includes(String(a.id))).map(a => a.activity_name).join(', ') || 'Commercial Item'
                    : 'Commercial Item'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Card Body */}
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Discipline */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Discipline</label>
                  <select
                    value={item.discipline_id ?? ''}
                    onChange={e => {
                      updateItem(item.id, 'discipline_id', e.target.value);
                      updateItem(item.id, 'activity_ids', []);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="">Select discipline…</option>
                    {disciplineOptions.map(d => (
                      <option key={d.id} value={d.id}>{d.function_name || d.name || d.label || d.id}</option>
                    ))}
                  </select>
                </div>

                {/* Activity */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Activity</label>
                  {!item.discipline_id ? (
                    <div className="px-3 py-2.5 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-sm text-gray-400 text-center">
                      <span>Select discipline first</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Selected Activities Display */}
                      {item.activity_ids?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {activityOptions
                            .filter(a => (item.activity_ids || []).map(String).includes(String(a.id)))
                            .map(a => (
                              <span key={a.id} className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                                {a.activity_name}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = (item.activity_ids || []).filter(cid => String(cid) !== String(a.id));
                                    updateItem(item.id, 'activity_ids', next);
                                  }}
                                  className="hover:bg-green-200 rounded-full p-0.5"
                                >
                                  <XMarkIcon className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                        </div>
                      )}
                      {/* Dropdown to Add Activities */}
                      <select
                        value=""
                        onChange={e => {
                          if (!e.target.value) return;
                          const current = Array.isArray(item.activity_ids) ? [...item.activity_ids] : [];
                          if (!current.map(String).includes(String(e.target.value))) {
                            updateItem(item.id, 'activity_ids', [...current, e.target.value]);
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      >
                        <option value="">{item.activity_ids?.length ? '+ Add more activities…' : 'Select activities…'}</option>
                        {activityOptions
                          .filter(a => String(a.function_id) === String(item.discipline_id))
                          .filter(a => !(item.activity_ids || []).map(String).includes(String(a.id)))
                          .map(a => (
                            <option key={a.id} value={a.id}>{a.activity_name}</option>
                          ))}
                      </select>
                      {activityOptions.filter(a => String(a.function_id) === String(item.discipline_id)).length === 0 && (
                        <div className="text-xs text-gray-500 text-center py-1">No activities available</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Man-Hours */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Man-Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={item.man_hours}
                    onChange={e => updateItem(item.id, 'man_hours', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>

                {/* Man-Hour Rate */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Rate (₹/hr)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.man_hour_rate}
                    onChange={e => updateItem(item.id, 'man_hour_rate', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              {/* Total Amount Display */}
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-end">
                <div className="bg-green-50 px-4 py-2 rounded-lg">
                  <span className="text-sm text-gray-600 mr-2">Total:</span>
                  <span className="text-lg font-bold text-green-700">
                    ₹ {(parseFloat(item.total_amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <ClipboardDocumentListIcon className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">{items.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100">
              <ClockIcon className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Man-Hours</p>
              <p className="text-2xl font-bold text-gray-900">{totalManHours.toFixed(1)}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <CurrencyDollarIcon className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Amount</p>
              <p className="text-2xl font-bold text-green-700">₹ {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuotationForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  const [termsOpen, setTermsOpen] = useState(false);
  const [scopeTab, setScopeTab] = useState('schedule');

  return (
    <div>
      {/* 4-Column Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        
        {/* Column 1: Quotation Info */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-indigo-200">
            <div className="p-2 rounded-lg bg-indigo-100">
              <DocumentDuplicateIcon className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Quotation Info</h3>
              <p className="text-xs text-gray-500">Quotation details</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <Text label="Quotation No." value={proposalData.quotation_number} onChange={v => set('quotation_number', v)} />
            <DateField label="Date of Quotation" value={proposalData.quotation_date} onChange={v => set('quotation_date', v)} />
            <Text label="Enquiry No." value={proposalData.enquiry_number} onChange={v => set('enquiry_number', v)} />
            <DateField label="Date of Enquiry" value={proposalData.enquiry_date} onChange={v => set('enquiry_date', v)} />
          </div>
        </div>

        {/* Column 2: Schedule */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-cyan-200">
            <div className="p-2 rounded-lg bg-cyan-100">
              <CalendarIcon className="h-5 w-5 text-cyan-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Schedule</h3>
              <p className="text-xs text-gray-500">Timeline details</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <Text label="Duration" placeholder="e.g., 6 months, 120 days…" value={proposalData.duration} onChange={v => set('duration', v)} />
            <DateField label="Target Date" value={proposalData.target_date} onChange={v => set('target_date', v)} />
            <Text label="Lead ID" value={String(proposalData.lead_id ?? '')} onChange={v => set('lead_id', v)} readOnly />
          </div>
        </div>

        {/* Column 3: Quotation Meta */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-rose-200">
            <div className="p-2 rounded-lg bg-rose-100">
              <InformationCircleIcon className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Quotation Meta</h3>
              <p className="text-xs text-gray-500">Additional info</p>
            </div>
          </div>
          <div className="space-y-4 flex-1">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Site Visit</label>
              <textarea readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" rows={2} value={proposalData.site_visit || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Validity</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={proposalData.quotation_validity || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mode of Delivery</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={proposalData.mode_of_delivery || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revision</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={proposalData.revision || ''} />
            </div>
          </div>
        </div>

        {/* Column 4: Software */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-violet-200">
            <div className="p-2 rounded-lg bg-violet-100">
              <ComputerDesktopIcon className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Software</h3>
              <p className="text-xs text-gray-500">Software details</p>
            </div>
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto max-h-[280px]">
            {Array.isArray(proposalData.software_items) && proposalData.software_items.length ? (
              proposalData.software_items.map((s, i) => (
                <div key={i} className="p-3 border border-gray-100 rounded-lg bg-gray-50">
                  <div className="text-sm font-semibold text-gray-900">{s.name || 'Untitled'}</div>
                  <div className="text-xs text-gray-600 mt-1">Provider: {s.provider || '—'}</div>
                  <div className="text-xs text-gray-500">Version: {s.current_version || '—'}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">No software items</div>
            )}
          </div>
        </div>
      </div>

      {/* Second Row - Scope & Exclusions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* Scope of Work */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-emerald-200">
            <div className="p-2 rounded-lg bg-emerald-100">
              <ClipboardDocumentListIcon className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Scope of Work</h3>
              <p className="text-xs text-gray-500">Documents and deliverables</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setScopeTab('documents')}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${scopeTab === 'documents' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Input Documents
              </button>
              <button
                type="button"
                onClick={() => setScopeTab('deliverables')}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${scopeTab === 'deliverables' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Deliverables
              </button>
            </div>
            <div className="w-full px-3 py-3 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-800 min-h-[120px]">
              {scopeTab === 'documents' && renderTextList(proposalData.input_document)}
              {scopeTab === 'deliverables' && renderTextList(proposalData.list_of_deliverables)}
            </div>
          </div>
        </div>

        {/* Exclusions */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-orange-200">
            <div className="p-2 rounded-lg bg-orange-100">
              <XMarkIcon className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Exclusions</h3>
              <p className="text-xs text-gray-500">Items not included</p>
            </div>
          </div>
          <div className="flex-1">
            <textarea readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm min-h-[150px]" value={proposalData.exclusions || ''} />
          </div>
        </div>
      </div>

      {/* Third Row - Terms & Conditions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* Billing & Payment Terms */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-teal-200">
            <div className="p-2 rounded-lg bg-teal-100">
              <CreditCardIcon className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Billing & Payment Terms</h3>
              <p className="text-xs text-gray-500">Payment conditions</p>
            </div>
          </div>
          <div className="flex-1">
            <Textarea label="" rows={6} value={proposalData.billing_payment_terms} onChange={v => set('billing_payment_terms', v)} />
          </div>
        </div>

        {/* Other Terms & Conditions */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-slate-200">
            <div className="p-2 rounded-lg bg-slate-100">
              <DocumentTextIcon className="h-5 w-5 text-slate-600" />
            </div>
            <div className="flex-1 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Other Terms & Conditions</h3>
                <p className="text-xs text-gray-500">Additional terms</p>
              </div>
              <button type="button" onClick={() => setTermsOpen(o => !o)} className="text-sm text-indigo-600 hover:underline font-medium">
                {termsOpen ? 'Hide' : 'Edit'}
              </button>
            </div>
          </div>
          <div className="flex-1">
            {termsOpen ? (
              <Textarea label="" rows={6} value={proposalData.other_terms} onChange={v => set('other_terms', v)} />
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-line min-h-[150px]">
                {proposalData.other_terms || <span className="text-gray-400">No terms specified</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fourth Row - Custom Fields & Additional */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Custom Fields */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-pink-200">
            <div className="p-2 rounded-lg bg-pink-100">
              <PlusIcon className="h-5 w-5 text-pink-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Custom Fields</h3>
              <p className="text-xs text-gray-500">Add key/value pairs</p>
            </div>
          </div>
          <div className="flex-1">
            <CustomFieldsEditor proposalData={proposalData} setProposalData={setProposalData} />
          </div>
        </div>

        {/* Additional Fields */}
        <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-gray-200">
            <div className="p-2 rounded-lg bg-gray-100">
              <PencilIcon className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Additional Fields</h3>
              <p className="text-xs text-gray-500">Extra notes or items</p>
            </div>
          </div>
          <div className="flex-1">
            <Textarea label="" rows={6} value={proposalData.additional_fields} onChange={v => set('additional_fields', v)} placeholder="Add any additional items or notes here…" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to render a newline/comma-separated string as a list
function renderTextList(text) {
  if (!text) return <div className="text-gray-500">—</div>;
  // split on newlines first
  let items = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // if only one line and it contains commas, split by commas
  if (items.length === 1 && items[0].includes(',')) {
    items = items[0].split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!items.length) return <div className="text-gray-500">—</div>;
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((it, idx) => (
        <li key={idx} className="text-sm text-gray-800">{it}</li>
      ))}
    </ul>
  );
}

function MeetingsForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  return (
    <div className="space-y-8">
      <Section title="Meetings & Coordination" subtitle="Meeting schedules and coordination details" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Textarea label="Kickoff Meeting Details" rows={4} value={proposalData.kickoff_meeting} onChange={v => set('kickoff_meeting', v)} />
        <Textarea label="In-House Meeting Details" rows={4} value={proposalData.in_house_meeting} onChange={v => set('in_house_meeting', v)} />
        <DateField label="Kickoff Meeting Date" value={proposalData.kickoff_meeting_date} onChange={v => set('kickoff_meeting_date', v)} />
        <DateField label="Internal Meeting Date" value={proposalData.internal_meeting_date} onChange={v => set('internal_meeting_date', v)} />
        <DateTimeField className="lg:col-span-2" label="Next Internal Meeting" value={proposalData.next_internal_meeting} onChange={v => set('next_internal_meeting', v)} />
      </div>
    </div>
  );
}

function CustomFieldsEditor({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const parseAdditional = (val) => {
    if (!val) return [];
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([k, v]) => ({ key: k, value: v }));
        return [];
      } catch {
        return [];
      }
    }
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object') return Object.entries(val).map(([k, v]) => ({ key: k, value: v }));
    return [];
  };

  const items = parseAdditional(proposalData.additional_fields);

  const saveItems = (arr) => {
    // store as JSON array
    set('additional_fields', JSON.stringify(arr));
  };

  const handleAdd = () => {
    const arr = items.length ? [...items] : [];
    // if there is legacy text in additional_fields and items is empty, preserve it as a 'notes' field
    if (!arr.length && proposalData.additional_fields && typeof proposalData.additional_fields === 'string') {
      try {
        JSON.parse(proposalData.additional_fields);
      } catch {
        if (proposalData.additional_fields.trim()) arr.push({ key: 'notes', value: proposalData.additional_fields });
      }
    }
    arr.push({ key: newKey || 'custom', value: newValue });
    saveItems(arr);
    setNewKey(''); setNewValue(''); setShowAdd(false);
  };

  const handleRemove = (idx) => {
    const arr = items.slice();
    arr.splice(idx, 1);
    saveItems(arr);
  };

  return (
    <div className="mt-2">
      {items.length ? (
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="flex items-start justify-between p-2 border rounded bg-white">
              <div>
                <div className="text-sm font-medium">{it.key}</div>
                <div className="text-sm text-gray-700">{it.value}</div>
              </div>
              <div>
                <button onClick={() => handleRemove(idx)} className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded">Remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500">No custom fields added yet.</div>
      )}

      {showAdd ? (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Field name" className="px-2 py-1 border rounded" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value" className="px-2 py-1 border rounded" />
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1 bg-green-600 text-white rounded">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1 bg-gray-100 rounded">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <button onClick={() => setShowAdd(true)} className="px-3 py-1 bg-blue-600 text-white rounded">Add custom field</button>
        </div>
      )}
    </div>
  );
}

function FinancialForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  return (
    <div className="space-y-8">
      <Section title="Financial Details" subtitle="Budget, costs, and risk management" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Number label="Budget" min={0} step={0.01} value={proposalData.budget} onChange={v => set('budget', v)} />
        <Number label="Cost to Company" min={0} step={0.01} value={proposalData.cost_to_company} onChange={v => set('cost_to_company', v)} />
        <Number label="Profitability Estimate" step={0.01} value={proposalData.profitability_estimate} onChange={v => set('profitability_estimate', v)} />
        <div className="lg:col-span-2">
          <Textarea label="Major Risks" rows={4} value={proposalData.major_risks} onChange={v => set('major_risks', v)} />
        </div>
        <div className="lg:col-span-2">
          <Textarea label="Mitigation Plans" rows={4} value={proposalData.mitigation_plans} onChange={v => set('mitigation_plans', v)} />
        </div>
      </div>
    </div>
  );
}

function HoursForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  return (
    <div className="space-y-8">
      <Section title="Hours Tracking" subtitle="Time tracking and productivity metrics" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Number label="Planned Hours (Total)" min={0} step={0.5} value={proposalData.planned_hours_total} onChange={v => set('planned_hours_total', v)} />
        <Number label="Actual Hours (Total)" min={0} step={0.5} value={proposalData.actual_hours_total} onChange={v => set('actual_hours_total', v)} />
        <Number label="Hours Variance (Total)" step={0.5} value={proposalData.hours_variance_total} onChange={v => set('hours_variance_total', v)} />
        <Number label="Hours Variance (%)" step={0.1} value={proposalData.hours_variance_percentage} onChange={v => set('hours_variance_percentage', v)} />
        <Number label="Productivity Index" step={0.01} value={proposalData.productivity_index} onChange={v => set('productivity_index', v)} />
        <div className="lg:col-span-2">
          <Note>Detailed hour breakdowns by discipline/activity are stored as JSON and can be edited in advanced views.</Note>
        </div>
      </div>
    </div>
  );
}

function ClientLocationForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  return (
    <div className="space-y-8">
      <Section title="Client & Location" subtitle="Client information and project location details" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-2">
          <Textarea
            label="Client Contact Details"
            rows={4}
            value={proposalData.client_contact_details}
            onChange={v => set('client_contact_details', v)}
            placeholder="Name, Email, Phone, Address…"
          />
        </div>
        <Text label="Project Location - Country" value={proposalData.project_location_country} onChange={v => set('project_location_country', v)} />
        <Text label="Project Location - City" value={proposalData.project_location_city} onChange={v => set('project_location_city', v)} />
        <div className="lg:col-span-2">
          <Textarea
            label="Project Location - Site/Address"
            rows={3}
            value={proposalData.project_location_site}
            onChange={v => set('project_location_site', v)}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Follow-ups Form -------------------------- */

function FollowupsForm({ proposalId }) {
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFollowup, setEditingFollowup] = useState(null);
  const [formData, setFormData] = useState({
    follow_up_date: new Date().toISOString().split('T')[0],
    follow_up_type: 'Call',
    description: '',
    status: 'Scheduled',
    outcome: '',
    next_action: '',
    next_follow_up_date: '',
    contacted_person: '',
    notes: ''
  });

  const fetchFollowups = useCallback(async () => {
    if (!proposalId) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}/followups`);
      const data = await res.json();
      if (data?.success) setFollowups(data.data || []);
    } catch (e) {
      console.error('Error fetching followups:', e);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    fetchFollowups();
  }, [fetchFollowups]);

  // Listen for external trigger to open form (from header button)
  useEffect(() => {
    const handleOpenForm = () => {
      setShowForm(true);
      setEditingFollowup(null);
      setFormData({
        follow_up_date: new Date().toISOString().split('T')[0],
        follow_up_type: 'Call',
        description: '',
        status: 'Scheduled',
        outcome: '',
        next_action: '',
        next_follow_up_date: '',
        contacted_person: '',
        notes: ''
      });
    };
    window.addEventListener('openFollowupForm', handleOpenForm);
    return () => window.removeEventListener('openFollowupForm', handleOpenForm);
  }, []);

  const resetForm = () => {
    setFormData({
      follow_up_date: new Date().toISOString().split('T')[0],
      follow_up_type: 'Call',
      description: '',
      status: 'Scheduled',
      outcome: '',
      next_action: '',
      next_follow_up_date: '',
      contacted_person: '',
      notes: ''
    });
    setEditingFollowup(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formData.follow_up_date || !formData.description) {
      alert('Please fill in date and description');
      return;
    }

    try {
      const url = `/api/proposals/${proposalId}/followups`;
      const method = editingFollowup ? 'PUT' : 'POST';
      const body = editingFollowup 
        ? { id: editingFollowup.id, ...formData }
        : formData;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      
      if (data?.success) {
        resetForm();
        fetchFollowups();
      } else {
        alert(data?.error || 'Failed to save follow-up');
      }
    } catch (e) {
      console.error('Error saving followup:', e);
      alert('Failed to save follow-up');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this follow-up?')) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}/followups?followup_id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data?.success) {
        fetchFollowups();
      } else {
        alert(data?.error || 'Failed to delete');
      }
    } catch (e) {
      console.error('Error deleting followup:', e);
      alert('Failed to delete follow-up');
    }
  };

  const handleEdit = (fu) => {
    setFormData({
      follow_up_date: fu.follow_up_date?.split('T')[0] || '',
      follow_up_type: fu.follow_up_type || 'Call',
      description: fu.description || '',
      status: fu.status || 'Scheduled',
      outcome: fu.outcome || '',
      next_action: fu.next_action || '',
      next_follow_up_date: fu.next_follow_up_date?.split('T')[0] || '',
      contacted_person: fu.contacted_person || '',
      notes: fu.notes || ''
    });
    setEditingFollowup(fu);
    setShowForm(true);
  };

  const markComplete = async (fu) => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/followups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fu.id, status: 'Completed' })
      });
      const data = await res.json();
      if (data?.success) fetchFollowups();
    } catch (e) {
      console.error('Error marking complete:', e);
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'Call': return <PhoneIcon className="h-5 w-5 text-blue-500" />;
      case 'Email': return <EnvelopeIcon className="h-5 w-5 text-green-500" />;
      case 'Meeting': return <CalendarIcon className="h-5 w-5 text-purple-500" />;
      case 'Site Visit': return <CalendarIcon className="h-5 w-5 text-orange-500" />;
      default: return <ChatBubbleLeftRightIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Completed': return 'bg-green-100 text-green-700';
      case 'Cancelled': return 'bg-gray-100 text-gray-600';
      case 'In Progress': return 'bg-blue-100 text-blue-700';
      default: return 'bg-yellow-100 text-yellow-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="pb-3 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="h-5 w-5" />
          Follow-ups ({followups.length})
        </h3>
        <p className="text-sm text-gray-600 mt-1">Track all follow-up activities for this proposal</p>
      </div>

      {/* Quick Header Form */}
      {showForm && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-purple-800">
              {editingFollowup ? 'Edit Follow-up' : 'New Follow-up'}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
              <input
                type="date"
                value={formData.follow_up_date}
                onChange={(e) => setFormData(prev => ({ ...prev, follow_up_date: e.target.value }))}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm w-36"
              />
            </div>
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select
                value={formData.follow_up_type}
                onChange={(e) => setFormData(prev => ({ ...prev, follow_up_type: e.target.value }))}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm w-32"
              >
                <option value="Call">📞 Call</option>
                <option value="Email">📧 Email</option>
                <option value="Meeting">📅 Meeting</option>
                <option value="Site Visit">🏢 Site Visit</option>
                <option value="Other">📝 Other</option>
              </select>
            </div>
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm w-32"
              >
                <option value="Scheduled">Scheduled</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person</label>
              <input
                type="text"
                value={formData.contacted_person}
                onChange={(e) => setFormData(prev => ({ ...prev, contacted_person: e.target.value }))}
                placeholder="Name"
                className="px-2 py-1.5 border border-gray-300 rounded text-sm w-36"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What needs to be discussed/done..."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetForm}
                className="px-3 py-1.5 text-gray-600 hover:text-gray-800 text-sm border border-gray-300 rounded bg-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700"
              >
                {editingFollowup ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
          {/* Additional fields row */}
          <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-purple-200">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Outcome / Result</label>
              <input
                type="text"
                value={formData.outcome}
                onChange={(e) => setFormData(prev => ({ ...prev, outcome: e.target.value }))}
                placeholder="What was the result..."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Next Follow-up</label>
              <input
                type="date"
                value={formData.next_follow_up_date}
                onChange={(e) => setFormData(prev => ({ ...prev, next_follow_up_date: e.target.value }))}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm w-36"
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Next Action</label>
              <input
                type="text"
                value={formData.next_action}
                onChange={(e) => setFormData(prev => ({ ...prev, next_action: e.target.value }))}
                placeholder="What to do next..."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes..."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Follow-ups Table */}
      {followups.length === 0 && !showForm ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <ChatBubbleLeftRightIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">No follow-ups scheduled yet</p>
          <p className="text-sm text-gray-400 mt-1">Click &quot;Add Follow-up&quot; to create one</p>
        </div>
      ) : followups.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">Sr.</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">Date</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Type</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">Status</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Contact</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Outcome</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">Next Date</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {followups.map((fu, index) => (
                <tr 
                  key={fu.id} 
                  className={`hover:bg-gray-50 ${
                    fu.status === 'Completed' ? 'bg-green-50' :
                    fu.status === 'Cancelled' ? 'bg-gray-100 opacity-60' :
                    fu.status === 'In Progress' ? 'bg-blue-50' : ''
                  }`}
                >
                  <td className="px-3 py-3 text-sm text-gray-500 font-medium">{index + 1}</td>
                  <td className="px-3 py-3 text-sm text-gray-900">
                    {fu.follow_up_date ? new Date(fu.follow_up_date).toLocaleDateString('en-IN', { 
                      day: '2-digit', month: 'short', year: 'numeric' 
                    }) : '—'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <span className="flex items-center gap-1">
                      {fu.follow_up_type === 'Call' && '📞'}
                      {fu.follow_up_type === 'Email' && '📧'}
                      {fu.follow_up_type === 'Meeting' && '📅'}
                      {fu.follow_up_type === 'Site Visit' && '🏢'}
                      {fu.follow_up_type === 'Other' && '📝'}
                      <span className="text-gray-700">{fu.follow_up_type}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(fu.status)}`}>
                      {fu.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">{fu.contacted_person || '—'}</td>
                  <td className="px-3 py-3 text-sm text-gray-700 max-w-xs">
                    <div className="truncate" title={fu.description}>{fu.description || '—'}</div>
                    {fu.notes && (
                      <div className="text-xs text-gray-400 italic truncate" title={fu.notes}>{fu.notes}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 max-w-xs">
                    <div className="truncate" title={fu.outcome}>{fu.outcome || '—'}</div>
                    {fu.next_action && (
                      <div className="text-xs text-blue-600 truncate" title={`Next: ${fu.next_action}`}>→ {fu.next_action}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    {fu.next_follow_up_date ? new Date(fu.next_follow_up_date).toLocaleDateString('en-IN', { 
                      day: '2-digit', month: 'short' 
                    }) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {fu.status !== 'Completed' && fu.status !== 'Cancelled' && (
                        <button
                          onClick={() => markComplete(fu)}
                          className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors"
                          title="Mark Complete"
                        >
                          <CheckIcon className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(fu)}
                        className="p-1.5 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                        title="Edit"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(fu.id)}
                        className="p-1.5 text-red-500 hover:bg-red-100 rounded transition-colors"
                        title="Delete"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Stats */}
      {followups.length > 0 && (
        <div className="flex gap-6 pt-4 border-t border-gray-200 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Total:</span>
            <span className="font-medium">{followups.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
            <span className="text-gray-500">Scheduled:</span>
            <span className="font-medium">{followups.filter(f => f.status === 'Scheduled').length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
            <span className="text-gray-500">In Progress:</span>
            <span className="font-medium">{followups.filter(f => f.status === 'In Progress').length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full"></span>
            <span className="text-gray-500">Completed:</span>
            <span className="font-medium">{followups.filter(f => f.status === 'Completed').length}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------- Small UI primitives -------------------------- */

function Section({ title, subtitle }) {
  return (
    <div className="pb-3 border-b border-gray-200 mb-2">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="text-sm text-gray-600 mt-1">{subtitle}</p> : null}
    </div>
  );
}

function Text({ label, value, onChange = () => {}, placeholder = '', required = false, readOnly = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent ${readOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}

function ProposalIdField({ label, value, onChange }) {
  // value is full proposal_id string. We split into three parts:
  //   prefix (read-only) e.g. ATSPL/Q/MM/YYYY/
  //   series (editable) e.g. 076
  //   suffix (editable) last 3 digits
  const defaultPrefix = useCallback(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const next = year + 1;
    return `ATSPL/Q/${month}/${year}-${next}/`;
  }, []);

  const defaultSeries = '076';

  const splitId = useCallback((val) => {
    if (!val) return { prefix: defaultPrefix(), series: defaultSeries };
    const s = String(val).trim();
    // Legacy numeric id like P<digits> (e.g. P123456789) -> try to extract a 3-digit series from digits
    const legacyMatch = s.match(/^P(\d+)$/i);
    if (legacyMatch) {
      const digits = legacyMatch[1];
      const series = digits.length >= 6 ? digits.slice(-6, -3) : defaultSeries;
      return { prefix: defaultPrefix(), series };
    }

    // Try to match ATSPL-style with series (3 digits) at the end
    const m = s.match(/^(.*?)(\d{3})$/);
    if (m) {
      const prefixPart = m[1];
      const series = m[2] || defaultSeries;
      const prefix = String(prefixPart).includes('ATSPL') ? prefixPart : defaultPrefix();
      return { prefix, series };
    }

    // Fallback: take last up to 3 digits as series
    const fallbackMatch = s.match(/^(.*?)(\d{1,})$/);
    if (fallbackMatch) {
      const allDigits = fallbackMatch[2];
      const series = allDigits.slice(-3) || defaultSeries;
      const prefixPart = s.slice(0, s.length - series.length) || defaultPrefix();
      const prefix = String(prefixPart).includes('ATSPL') ? prefixPart : defaultPrefix();
      return { prefix, series };
    }

    return { prefix: defaultPrefix(), series: defaultSeries };
  }, [defaultPrefix, defaultSeries]);

  const { prefix: initialPrefix, series: initialSeries } = splitId(value);
  const [pref, setPref] = useState(initialPrefix || defaultPrefix());
  const [series, setSeries] = useState(initialSeries || defaultSeries);

  // keep local state in sync if parent value changes
  useEffect(() => {
    const s = splitId(value);
    setPref(s.prefix || defaultPrefix());
    setSeries(s.series || defaultSeries);
  }, [value, splitId, defaultPrefix]);

  const updateParent = (nextPref, nextSeries) => {
    const padSeries = String(nextSeries || '').padStart(3, '0');
    onChange(`${nextPref || defaultPrefix()}${padSeries}`);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={pref}
          readOnly
          className="flex-1 px-3 py-2 border border-gray-300 rounded-l bg-gray-100 cursor-not-allowed"
        />
        <input
          type="number"
          min="0"
          max="999"
          value={series}
          onChange={e => {
            const v = e.target.value.replace(/^0+(?=\d)/, '');
            const cleaned = v === '' ? '' : String(Math.max(0, Math.min(999, Number(v))));
            setSeries(cleaned);
          }}
          onBlur={() => updateParent(pref, series)}
          className="w-20 px-3 py-2 border-t border-b border-gray-300 text-center"
          aria-label="Proposal series (3 digits)"
        />
        {/* suffix removed — server will assign final sequence */}
      </div>
      <p className="text-xs text-gray-500 mt-1">Format: {defaultPrefix()}<span className="font-mono">NNN</span> — edit the 3-digit series</p>
    </div>
  );
}

function Number({ label, value, onChange = () => {}, min, max, step, placeholder = '' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="number"
        value={value ?? 0}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent"
      />
    </div>
  );
}

function Textarea({ label, value, onChange = () => {}, rows = 3, placeholder = '' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <textarea
        rows={rows}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent"
      />
    </div>
  );
}

function Select({ label, value, onChange = () => {}, options }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent bg-white"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="date"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent"
      />
    </div>
  );
}

function DateTimeField({ label, value, onChange, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="datetime-local"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent"
      />
    </div>
  );
}

function Th({ children, className = '' }) {
  return <th className={`text-left py-3 px-4 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = '', colSpan }) {
  return (
    <td className={`py-3 px-4 align-top ${className}`} colSpan={colSpan}>
      {children}
    </td>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
      <p className="text-sm text-gray-600">{title}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function Note({ children }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
      {children}
    </div>
  );
}