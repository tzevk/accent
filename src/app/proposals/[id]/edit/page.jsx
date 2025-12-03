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
    proposal_value: 0,
    currency: 'INR',

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
            proposal_value: p.proposal_value ?? p.value ?? 0,
            currency: p.currency ?? prev.currency,
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

/* -------------------------- Forms -------------------------- */

function BasicInfoForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);

  return (
    <div className="space-y-8">
      <Section title="Identification" subtitle="Basic proposal information" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
          <ProposalIdField label="Proposal ID *" value={proposalData.proposal_id} onChange={v => set('proposal_id', v)} required />
          <Text label="Proposal Title *" value={proposalData.proposal_title} onChange={v => set('proposal_title', v)} required />
          <Textarea label="Description" rows={4} value={proposalData.description} onChange={v => set('description', v)} />
          <Text label="Client Name" value={proposalData.client_name} onChange={v => set('client_name', v)} />
          {/* Project Manager removed from proposal form */}
          <Text label="Industry" placeholder="e.g., Oil & Gas, Petrochemical…" value={proposalData.industry} onChange={v => set('industry', v)} />
          <Text label="Contract Type" placeholder="e.g., EPC, Consultancy, T&M…" value={proposalData.contract_type} onChange={v => set('contract_type', v)} />
        </div>

        <div className="space-y-4">
          <Section title="Status & Control" />
          <div className="grid grid-cols-2 gap-4">
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

          <Number label="Progress (%)" min={0} max={100} step={0.1} value={proposalData.progress} onChange={v => set('progress', v)} />

          <div className="grid grid-cols-2 gap-4">
            <Number label="Proposal Value" min={0} step={0.01} value={proposalData.proposal_value} onChange={v => set('proposal_value', v)} />
            <Select
              label="Currency"
              value={proposalData.currency}
              onChange={v => set('currency', v)}
              options={[
                { value: 'INR', label: 'INR' },
                { value: 'USD', label: 'USD' },
                { value: 'EUR', label: 'EUR' },
                { value: 'GBP', label: 'GBP' },
              ]}
            />
          </div>

          <Textarea label="Payment Terms" rows={3} value={proposalData.payment_terms} onChange={v => set('payment_terms', v)} />
          <Textarea label="Notes" rows={4} value={proposalData.notes} onChange={v => set('notes', v)} />
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

  const itemsInitial = Array.isArray(proposalData.software_items) ? proposalData.software_items : [];
  const [items, setItems] = useState(itemsInitial);
  const [masterSoftwares, setMasterSoftwares] = useState([]);
  const [selectedMasterId, setSelectedMasterId] = useState('');

  useEffect(() => {
    setItems(Array.isArray(proposalData.software_items) ? proposalData.software_items : []);
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
              flat.push({ id: sw.id, name: sw.name, provider: sw.provider || '', versions: sw.versions || [] });
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
    // sort numerically by id before persisting
    const sorted = [...next].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <select value={selectedMasterId} onChange={e => setSelectedMasterId(e.target.value)} className="px-2 py-1 border rounded text-sm">
            <option value="">Select from Software master…</option>
            {masterSoftwares.map(sw => (
              <option key={sw.id} value={sw.id}>{`${sw.id} — ${sw.name}${sw.provider ? ` (${sw.provider})` : ''}`}</option>
            ))}
          </select>
          <button type="button" onClick={addItem} className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">+ Add Selected / New</button>
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="py-2 px-3 text-left">Software id</th>
              <th className="py-2 px-3 text-left">Software name</th>
              <th className="py-2 px-3 text-left">Software versions</th>
              <th className="py-2 px-3 text-left">Current version</th>
              <th className="py-2 px-3 text-left">Company provider</th>
              <th className="py-2 px-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b">
                <td className="py-2 px-3 w-32">
                  <input
                    type="number"
                    value={it.id}
                    onChange={e => updateItem(idx, 'id', Number(e.target.value || 0))}
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </td>
                <td className="py-2 px-3">
                  <input
                    type="text"
                    value={it.name || ''}
                    onChange={e => updateItem(idx, 'name', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </td>
                <td className="py-2 px-3">
                  <input
                    type="text"
                    value={(Array.isArray(it.versions) ? it.versions.join(', ') : String(it.versions || ''))}
                    onChange={e => updateItem(idx, 'versions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="v1.0, v1.1, v2.0"
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </td>
                <td className="py-2 px-3 w-40">
                  <input
                    type="text"
                    value={it.current_version || ''}
                    onChange={e => updateItem(idx, 'current_version', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </td>
                <td className="py-2 px-3 w-48">
                  <input
                    type="text"
                    value={it.provider || ''}
                    onChange={e => updateItem(idx, 'provider', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </td>
                <td className="py-2 px-3 text-center">
                  <button type="button" onClick={() => removeItem(idx)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      
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
            sub_activity_ids: [],
            showSubPicker: false,
          },
        ]
  );

  const [disciplineOptions, setDisciplineOptions] = useState([]);
  const [activityOptions, setActivityOptions] = useState([]);
  const [subActivityOptions, setSubActivityOptions] = useState([]);

  useEffect(() => {
    // Fetch discipline/activity/subactivity master lists
    let mounted = true;
    (async () => {
      try {
        const [discRes, actRes, subRes] = await Promise.all([
          fetch('/api/activity-master'),
          fetch('/api/activity-master/activities'),
          fetch('/api/activity-master/subactivities'),
        ]);
        const discJson = await discRes.json();
        const actJson = await actRes.json();
        const subJson = await subRes.json();

        if (!mounted) return;

        if (discJson?.success && Array.isArray(discJson.data)) setDisciplineOptions(discJson.data);
        if (actJson?.success && Array.isArray(actJson.data)) setActivityOptions(actJson.data);
        if (subJson?.success && Array.isArray(subJson.data)) setSubActivityOptions(subJson.data);
      } catch (e) {
        console.warn('Failed to load activity master data:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Normalize legacy free-text activity entries into ids when possible
  // Also normalize single `sub_activity_id` into `sub_activity_ids` for compatibility
  useEffect(() => {
    if (!activityOptions.length || !items.some(i => i.activities && !(i.activity_ids && i.activity_ids.length))) return;
    setItems(prev => prev.map(it => {
      if ((it.activity_ids && it.activity_ids.length) || !it.activities) return it;
      // try to find activity by name
      const found = activityOptions.find(a => a.activity_name === it.activities);
      if (found) return { ...it, activity_ids: [found.id], discipline_id: found.function_id };
      return it;
    }));
  }, [activityOptions, items]);

  // Normalize legacy single sub_activity_id into sub_activity_ids array
  useEffect(() => {
    if (!subActivityOptions.length || !items.some(i => i.sub_activity_id && !(i.sub_activity_ids && i.sub_activity_ids.length))) return;
    setItems(prev => prev.map(it => {
      if (!it.sub_activity_id || (it.sub_activity_ids && it.sub_activity_ids.length)) return it;
      return { ...it, sub_activity_ids: [it.sub_activity_id] };
    }));
  }, [subActivityOptions, items]);

  // When sub-activities load, for items that have an activity selected but no sub_activity_ids,
  // default to selecting all sub-activities for that activity and populate defaults (manhours/rate)
  useEffect(() => {
    if (!subActivityOptions.length) return;

    setItems(prev => {
      let changed = false;
      const next = prev.map(it => {
        if (!it.activity_ids || !it.activity_ids.length) return it;
        if (it.sub_activity_ids && it.sub_activity_ids.length) return it;
        // find sub-activities for these activities
        const subs = subActivityOptions.filter(s => (it.activity_ids || []).map(String).includes(String(s.activity_id)));
        if (!subs.length) return it;
        changed = true;
        const updated = { ...it };
        const ids = subs.map(s => s.id);
        updated.sub_activity_ids = ids;
        // sum default_manhours
        const sumMan = subs.reduce((s, sub) => s + (parseFloat(sub.default_manhours || sub.defaultManhours || 0) || 0), 0);
        updated.man_hours = parseFloat(sumMan.toFixed(2));
        // avg default_rate if present
        const rates = subs.map(sub => parseFloat(sub.default_rate || sub.defaultRate || 0) || 0).filter(r => r > 0);
        const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
        if (avgRate > 0) updated.man_hour_rate = parseFloat(avgRate.toFixed(2));
        updated.total_amount = parseFloat(((parseFloat(updated.man_hours || 0) || 0) * (parseFloat(updated.man_hour_rate || 0) || 0)).toFixed(2));
        return updated;
      });
      return changed ? next : prev;
    });
  }, [subActivityOptions, items]);

  useEffect(() => {
    // Keep parent state in sync
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
        activity_id: '',
        sub_activity_ids: [],
        showSubPicker: false,
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
        // start with a shallow copy
        const updated = { ...i };

        // set the changed field
        if (field === 'man_hours' || field === 'man_hour_rate') {
          updated[field] = parseFloat(value || 0);
        } else {
          updated[field] = value;
        }

        // If the activity changed, default-select its sub-activities and compute defaults
        if (field === 'activity_ids') {
          const selectedActivityIds = Array.isArray(value) ? value : [];
          // collect subs for all selected activities
          const subs = subActivityOptions.filter(s => selectedActivityIds.map(String).includes(String(s.activity_id)));
          const ids = subs.map(s => s.id);
          if (ids.length) {
            updated.sub_activity_ids = ids;
            // sum default_manhours
            const sumMan = subs.reduce((s, sub) => s + (parseFloat(sub.default_manhours || sub.defaultManhours || 0) || 0), 0);
            if (sumMan > 0 && (!updated.man_hours || parseFloat(updated.man_hours) === 0)) {
              updated.man_hours = parseFloat(sumMan.toFixed(2));
            }
            // avg default_rate if present
            const rates = subs.map(sub => parseFloat(sub.default_rate || sub.defaultRate || 0) || 0).filter(r => r > 0);
            const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
            if (avgRate > 0 && (!updated.man_hour_rate || parseFloat(updated.man_hour_rate) === 0)) {
              updated.man_hour_rate = parseFloat(avgRate.toFixed(2));
            }
          }
        }
        if (field === 'sub_activity_ids') {
          // when sub activities selection changes, compute man_hours and man_hour_rate
          const subs = subActivityOptions.filter(s => (value || []).map(String).includes(String(s.id)));
          const sumMan = subs.reduce((s, sub) => s + (parseFloat(sub.default_manhours || sub.defaultManhours || 0) || 0), 0);
          updated.man_hours = parseFloat(sumMan.toFixed(2));
          const rates = subs.map(sub => parseFloat(sub.default_rate || sub.defaultRate || 0) || 0).filter(r => r > 0);
          const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
          if (avgRate > 0) updated.man_hour_rate = parseFloat(avgRate.toFixed(2));
        }

        // Recalculate total_amount = man_hours * man_hour_rate
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
    <div className="space-y-8">
      <Section title="Commercials" subtitle="Activity-wise commercial breakdown" />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
        >
          + Add Item
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              <Th>Sr no</Th>
              <Th className="w-52">Discipline</Th>
              <Th className="w-52">Activity</Th>
              <Th>Sub-Activities</Th>
              <Th className="w-32">Man-Hours</Th>
              <Th className="w-36">Man-Hour Rate</Th>
              <Th className="w-36">Total Amount</Th>
              <Th className="w-24 text-center">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-gray-200">
                <Td className="text-center">{item.sr_no}</Td>
                <Td>
                  <select
                    value={item.discipline_id ?? ''}
                    onChange={e => updateItem(item.id, 'discipline_id', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded bg-white"
                  >
                    <option value="">Select discipline…</option>
                    {disciplineOptions.map(d => (
                      <option key={d.id} value={d.id}>{d.function_name || d.name || d.label || d.id}</option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {!item.discipline_id ? (
                      <div className="text-sm text-gray-500">Select a discipline first to choose activities.</div>
                    ) : activityOptions
                        .filter(a => String(a.function_id) === String(item.discipline_id))
                        .map(a => {
                        const subsForAct = subActivityOptions.filter(s => String(s.activity_id) === String(a.id));
                        const sumManForAct = subsForAct.reduce((s, sub) => s + (parseFloat(sub.default_manhours || sub.defaultManhours || 0) || 0), 0);
                        const ratesForAct = subsForAct.map(sub => parseFloat(sub.default_rate || sub.defaultRate || 0) || 0).filter(r => r > 0);
                        const avgRateForAct = ratesForAct.length ? (ratesForAct.reduce((a, b) => a + b, 0) / ratesForAct.length) : 0;
                        return (
                          <label key={a.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={(item.activity_ids || []).map(String).includes(String(a.id))}
                              onChange={() => {
                                const current = Array.isArray(item.activity_ids) ? [...item.activity_ids] : [];
                                const strId = String(a.id);
                                const exists = current.map(String).includes(strId);
                                let next;
                                if (exists) next = current.filter(cid => String(cid) !== strId);
                                else next = [...current, a.id];
                                updateItem(item.id, 'activity_ids', next);
                              }}
                            />
                            <span className="flex-1">{a.activity_name}</span>
                            <span className="text-xs text-gray-500 whitespace-nowrap">{sumManForAct.toFixed(1)} hrs</span>
                            <span className="text-xs text-gray-500 pl-2">{avgRateForAct > 0 ? `₹${avgRateForAct.toFixed(2)}` : '—'}</span>
                          </label>
                        );
                      })}

                    {/* free-text fallback if legacy value exists */}
                    {item.activities && !activityOptions.find(a => a.activity_name === item.activities) && (
                      <div className="mt-2 text-sm">
                        <label className="block text-xs text-gray-600">Other activity</label>
                        <input
                          type="text"
                          value={item.activities}
                          onChange={e => updateItem(item.id, 'activities', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded mt-1"
                        />
                      </div>
                    )}

                    <div className="pt-1 text-xs text-gray-500">Select one or more activities</div>
                  </div>
                </Td>
                <Td>
                  <div className="w-full">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 text-sm text-gray-700">
                        {item.sub_activity_ids && item.sub_activity_ids.length ? (
                            // Group selected sub-activities by their parent activity for clarity
                            (() => {
                              const byActivity = {};
                              (subActivityOptions || []).forEach(s => {
                                if (!item.sub_activity_ids.map(String).includes(String(s.id))) return;
                                const aid = String(s.activity_id || '');
                                if (!byActivity[aid]) byActivity[aid] = [];
                                byActivity[aid].push(s);
                              });
                              const groups = Object.keys(byActivity).map(aid => ({ activity: activityOptions.find(a => String(a.id) === aid) || { id: aid, activity_name: 'Other' }, subs: byActivity[aid] }));
                              return (
                                <div className="space-y-2">
                                  {groups.map(g => (
                                    <div key={g.activity.id}>
                                      <div className="text-sm font-medium text-gray-700">{g.activity.activity_name || g.activity.name || 'Other'}</div>
                                      <ul className="list-none pl-3 space-y-1">
                                        {g.subs.map(s => (
                                          <li key={s.id} className="text-sm text-gray-700 flex items-center justify-between">
                                            <span>{s.subactivity_name || s.name || s.id}</span>
                                            <span className="text-xs text-gray-500">{(parseFloat(s.default_manhours || s.defaultManhours || 0) || 0).toFixed(1)} hrs • {((parseFloat(s.default_rate || s.defaultRate || 0) || 0) > 0 ? `₹${(parseFloat(s.default_rate || s.defaultRate || 0)).toFixed(2)}` : '—')}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()
                          ) : (
                            <div className="text-gray-400">No sub-activities selected</div>
                          )}
                      </div>
                      <div className="flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => updateItem(item.id, 'showSubPicker', !item.showSubPicker)}
                          className="px-2 py-1 text-xs bg-gray-100 rounded"
                        >
                          {item.showSubPicker ? 'Close' : 'Select'}
                        </button>
                      </div>
                    </div>
                      {item.showSubPicker && (
                        <div className="mt-2 border rounded p-2 max-h-56 overflow-y-auto bg-white">
                          {/* Group subs by activity inside the picker for easier scanning */}
                          {(
                            (item.activity_ids && item.activity_ids.length)
                              ? activityOptions.filter(a => (item.activity_ids || []).map(String).includes(String(a.id)))
                              : (item.discipline_id ? activityOptions.filter(a => String(a.function_id) === String(item.discipline_id)) : [])
                          ).map(a => {
                          const subs = (subActivityOptions || []).filter(s => String(s.activity_id) === String(a.id));
                          if (!subs.length) return null;
                          const allSelected = subs.every(s => (item.sub_activity_ids || []).map(String).includes(String(s.id)));
                          return (
                            <div key={a.id} className="mb-2">
                              <label className="flex items-center justify-between text-sm font-medium">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={() => {
                                      const current = Array.isArray(item.sub_activity_ids) ? [...item.sub_activity_ids] : [];
                                      const subIds = subs.map(s => s.id);
                                      let next;
                                      if (allSelected) next = current.filter(cid => !subIds.map(String).includes(String(cid)));
                                      else next = Array.from(new Set([...current, ...subIds]));
                                      updateItem(item.id, 'sub_activity_ids', next);
                                    }}
                                  />
                                  <span>{a.activity_name || a.name || a.id}</span>
                                </div>
                                <div className="text-xs text-gray-500">{subs.reduce((s, sub) => s + (parseFloat(sub.default_manhours || sub.defaultManhours || 0) || 0), 0).toFixed(1)} hrs • {(() => { const rates = subs.map(sub => parseFloat(sub.default_rate || sub.defaultRate || 0) || 0).filter(r=>r>0); return rates.length ? `₹${(rates.reduce((a,b)=>a+b,0)/rates.length).toFixed(2)}` : '—'; })()}</div>
                              </label>
                              <div className="pl-6 mt-1 space-y-1">
                                {subs.map(s => (
                                  <label key={s.id} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={(item.sub_activity_ids || []).map(String).includes(String(s.id))}
                                      onChange={() => {
                                        const current = Array.isArray(item.sub_activity_ids) ? [...item.sub_activity_ids] : [];
                                        const strId = String(s.id);
                                        const exists = current.map(String).includes(strId);
                                        let next;
                                        if (exists) next = current.filter(cid => String(cid) !== strId);
                                        else next = [...current, s.id];
                                        updateItem(item.id, 'sub_activity_ids', next);
                                      }}
                                    />
                                    <span className="flex-1">{s.subactivity_name || s.name || s.id}</span>
                                    <span className="text-xs text-gray-500">{(parseFloat(s.default_manhours || s.defaultManhours || 0) || 0).toFixed(1)} hrs • {((parseFloat(s.default_rate || s.defaultRate || 0) || 0) > 0 ? `₹${(parseFloat(s.default_rate || s.defaultRate || 0)).toFixed(2)}` : '—')}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Td>
                <Td>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={item.man_hours}
                    onChange={e => updateItem(item.id, 'man_hours', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </Td>
                <Td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.man_hour_rate}
                    onChange={e => updateItem(item.id, 'man_hour_rate', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded"
                  />
                </Td>
                <Td>
                  <input
                    type="number"
                    readOnly
                    value={(parseFloat(item.total_amount) || 0).toFixed(2)}
                    className="w-full px-2 py-1 border border-gray-300 rounded bg-gray-50"
                  />
                </Td>
                <Td className="text-center">
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="px-2 py-1 text-xs rounded-md bg-red-100 text-red-700 hover:bg-red-200"
                  >
                    ✕
                  </button>
                </Td>
              </tr>
            ))}
            <tr className="bg-green-50 border-t-2 border-green-300 font-semibold">
              <Td colSpan={4}>Total</Td>
              <Td>{totalManHours.toFixed(1)}</Td>
              <Td>—</Td>
              <Td>{totalAmount.toFixed(2)}</Td>
              <Td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard title="Total Items" value={items.length} />
        <StatCard title="Total Man-Hours" value={totalManHours.toFixed(1)} />
        <StatCard title={`Total Amount (${proposalData.currency || 'INR'})`} value={totalAmount.toFixed(2)} />
      </div>
    </div>
  );
}

function QuotationForm({ proposalData, setProposalData }) {
  const set = useMemo(() => fieldSetter(setProposalData), [setProposalData]);
  const [termsOpen, setTermsOpen] = useState(false);
  const [scopeTab, setScopeTab] = useState('schedule');

  return (
    <div className="space-y-8">
      <Section title="Quotation Details" subtitle="Quotation and enquiry information" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Text label="Quotation No." value={proposalData.quotation_number} onChange={v => set('quotation_number', v)} />
          <DateField label="Date of Quotation" value={proposalData.quotation_date} onChange={v => set('quotation_date', v)} />
          <Text label="Enquiry No." value={proposalData.enquiry_number} onChange={v => set('enquiry_number', v)} />
          <DateField label="Date of Enquiry" value={proposalData.enquiry_date} onChange={v => set('enquiry_date', v)} />
  <Text label="Duration" placeholder="e.g., 6 months, 120 days…" value={proposalData.duration} onChange={v => set('duration', v)} />
        <DateField label="Target Date" value={proposalData.target_date} onChange={v => set('target_date', v)} />
        <Text label="Lead ID (read-only if converted)" value={String(proposalData.lead_id ?? '')} onChange={v => set('lead_id', v)} readOnly />

        {/* Display fields from Scope tab */}
        <div className="lg:col-span-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Scope of Work</label>

              <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setScopeTab('documents')}
                className={`px-3 py-1 text-sm rounded ${scopeTab === 'documents' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                Input Documents
              </button>
              <button
                type="button"
                onClick={() => setScopeTab('deliverables')}
                className={`px-3 py-1 text-sm rounded ${scopeTab === 'deliverables' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                Deliverables
              </button>
            </div>

            <div className="w-full px-3 py-3 border border-gray-200 rounded bg-gray-50 text-sm text-gray-800">
              {scopeTab === 'documents' && (
                <div>{renderTextList(proposalData.input_document)}</div>
              )}
              {scopeTab === 'deliverables' && (
                <div>{renderTextList(proposalData.list_of_deliverables)}</div>
              )}
            </div>
          </div>
        </div>

  {/* Quotation-specific editable fields */}

        {/* Quotation meta: display these fields read-only inside the Quotation Details tab */}
        <div className="lg:col-span-2">
          <Section title="Quotation Meta" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Site Visit</label>
              <textarea readOnly className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-sm" value={proposalData.site_visit || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-sm" value={proposalData.duration || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Validity</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-sm" value={proposalData.quotation_validity || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mode of Delivery</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-sm" value={proposalData.mode_of_delivery || ''} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Revision</label>
              <input readOnly type="text" className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-sm" value={proposalData.revision || ''} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Exclusions</label>
              <textarea readOnly className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-sm" rows={4} value={proposalData.exclusions || ''} />
            </div>
          </div>

          {/* Custom / additional fields (structured) */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold">Custom fields</h4>
            <p className="text-xs text-gray-500">Add arbitrary key/value fields to the quotation. These are saved as structured additional fields.</p>
            <CustomFieldsEditor proposalData={proposalData} setProposalData={setProposalData} />
          </div>
        </div>

        {/* Display software items in quotation view as a read-only list */}
        <div className="lg:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">Software</label>
          <div className="w-full px-3 py-3 border border-gray-200 rounded bg-gray-50 text-sm text-gray-800">
            {Array.isArray(proposalData.software_items) && proposalData.software_items.length ? (
              <ul className="list-none space-y-2">
                {proposalData.software_items.map((s, i) => (
                  <li key={i} className="p-2 border rounded bg-white">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-semibold">{s.name || 'Untitled'} {s.id ? <span className="text-xs text-gray-500">(ID: {s.id})</span> : null}</div>
                        <div className="text-xs text-gray-600">Provider: {s.provider || '—'}</div>
                      </div>
                      <div className="text-right text-sm text-gray-700">
                        <div>Current: {s.current_version || '—'}</div>
                        <div className="text-xs text-gray-500">Versions: {(Array.isArray(s.versions) ? s.versions.join(', ') : String(s.versions || '—'))}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-500">—</div>
            )}
          </div>
        </div>
      </div>
      <div className="pt-4 space-y-6">
        <div>
          <h4 className="text-sm font-semibold">Billing & Payment terms</h4>
          <div className="mt-2">
            <Textarea label="" rows={6} value={proposalData.billing_payment_terms} onChange={v => set('billing_payment_terms', v)} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Other Terms & Conditions</h4>
            <button type="button" onClick={() => setTermsOpen(o => !o)} className="text-sm text-indigo-600 hover:underline">
              {termsOpen ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="mt-3">
            {termsOpen ? (
              <Textarea label="" rows={8} value={proposalData.other_terms} onChange={v => set('other_terms', v)} />
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 whitespace-pre-line">
                {proposalData.other_terms}
              </div>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold">Additional fields</h4>
          <div className="mt-2">
            <Textarea label="" rows={4} value={proposalData.additional_fields} onChange={v => set('additional_fields', v)} placeholder="Add any additional items or notes here…" />
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

/* -------------------------- Small UI primitives -------------------------- */

function Section({ title, subtitle }) {
  return (
    <div className="pb-3 border-b border-gray-200 mb-2">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="text-sm text-gray-600 mt-1">{subtitle}</p> : null}
    </div>
  );
}

function Text({ label, value, onChange, placeholder = '', required = false, readOnly = false }) {
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

function Number({ label, value, onChange, min, max, step, placeholder = '' }) {
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

function Textarea({ label, value, onChange, rows = 3, placeholder = '' }) {
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

function Select({ label, value, onChange, options }) {
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