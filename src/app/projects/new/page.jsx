'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const TABS = [
  { id: 'general', label: 'General Project Information' },
  { id: 'commercial', label: 'Commercial Details' },
  { id: 'engineering', label: 'Engineering Deliverables' },
  { id: 'procurement', label: 'Procurement & Material' },
  { id: 'construction', label: 'Construction / Site' },
  { id: 'risk', label: 'Risk & Issues' },
  { id: 'closeout', label: 'Project Closeout' }
];

const STATUS_MAP = {
  Planning: 'planning',
  Ongoing: 'in-progress',
  'On Hold': 'on-hold',
  Completed: 'completed',
  Cancelled: 'cancelled'
};

const createInitialState = (datePreset = '') => ({
  general: {
    projectCode: '',
    projectName: '',
    clientName: '',
    clientContact: '',
    companyId: '',
    projectManager: '',
    locationCountry: '',
    locationCity: '',
    locationSite: '',
    industry: '',
    contractType: '',
    startDate: datePreset,
    endDate: datePreset,
    durationPlanned: '',
    durationActual: '',
    status: 'Ongoing',
    projectOverview: ''
  },
  commercial: {
    projectValue: '',
    currency: 'INR',
    paymentTerms: 'Milestones',
    invoicingStatus: 'Pending',
    costToCompany: '',
    profitabilityEstimate: '',
    subcontractorsList: '',
    vendorsList: ''
  },
  engineering: {
    disciplineDeliverables: '',
    plannedSubmissionDates: '',
    actualSubmissionDates: '',
    approvalStatus: 'Submitted',
    manhoursPlanned: '',
    manhoursConsumed: ''
  },
  procurement: {
    longLeadItems: '',
    vendorPoDetails: '',
    deliveryDates: '',
    inspectionRecords: ''
  },
  construction: {
    mobilizationDate: '',
    siteProgress: '',
    installationPercentPlanned: '',
    installationPercentActual: '',
    commissioningDate: '',
    handoverDate: ''
  },
  risk: {
    majorRisks: '',
    mitigationPlans: '',
    changeOrders: '',
    claimsDisputes: ''
  },
  closeout: {
    finalDocumentationStatus: '',
    lessonsLearned: '',
    clientFeedback: '',
    actualProfitLoss: ''
  }
});

const INDUSTRIES = ['Oil & Gas', 'Petrochemical', 'Solar', 'Wind', 'Infrastructure', 'Manufacturing', 'Other'];
const CONTRACT_TYPES = ['EPC', 'Consultancy', 'PMC', 'Lump Sum', 'Reimbursable', 'Hybrid'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'];
const PAYMENT_TERMS = ['Milestones', 'Monthly', 'Percent Completion', 'Advance + Milestone'];
const INVOICING_STATUS = ['Pending', 'Raised', 'Partially Paid', 'Paid', 'Overdue'];
const APPROVAL_STATUS = ['Submitted', 'Approved', 'Resubmitted', 'Rejected'];

/** Wrapper component that provides a Suspense boundary */
export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm">Loading…</div>}>
      <NewProjectForm />
    </Suspense>
  );
}

/** All the original logic moved here; useSearchParams lives inside Suspense now */
function NewProjectForm() {
  const searchParams = useSearchParams();
  const preset = searchParams.get('date');
  const normalizedDate = useMemo(() => {
    if (!preset) return '';
    const parsed = new Date(preset);
    if (Number.isNaN(parsed.getTime())) return '';
    return format(parsed, 'yyyy-MM-dd');
  }, [preset]);

  const router = useRouter();
  const [activeTab, setActiveTab] = useState('general');
  const [companies, setCompanies] = useState([]);
  const [formData, setFormData] = useState(() => createInitialState(normalizedDate));
  const [selectedDate, setSelectedDate] = useState(() => (normalizedDate ? new Date(normalizedDate) : null));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const response = await fetch('/api/companies');
        const result = await response.json();
        if (result.success) setCompanies(result.data);
      } catch (error) {
        console.error('Error fetching companies:', error);
      }
    };
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (normalizedDate) {
      setFormData((prev) => ({
        ...prev,
        general: {
          ...prev.general,
          startDate: prev.general.startDate || normalizedDate,
          endDate: prev.general.endDate || normalizedDate
        }
      }));
      setSelectedDate(new Date(normalizedDate));
    } else {
      setSelectedDate(null);
    }
  }, [normalizedDate]);

  const updateField = (section, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value }
    }));
  };

  const handleStartDateChange = (event) => {
    const { value } = event.target;
    updateField('general', 'startDate', value);
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        setSelectedDate(parsed);
        return;
      }
    }
    setSelectedDate(null);
  };

  const redirectToCalendar = (dateString) => {
    const params = new URLSearchParams({ view: 'calendar' });
    if (dateString) params.set('focus', dateString);
    router.push(`/projects?${params.toString()}`);
  };

  const handleCancel = () => redirectToCalendar(formData.general.startDate);

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    const { general, commercial, construction } = formData;

    if (!general.projectName.trim()) {
      alert('Project name is required.');
      setActiveTab('general');
      setSubmitting(false);
      return;
    }
    if (!general.clientName.trim()) {
      alert('Client name is required.');
      setActiveTab('general');
      setSubmitting(false);
      return;
    }

    const statusValue =
      STATUS_MAP[general.status] || general.status?.toLowerCase().replace(/\s+/g, '_') || 'planning';

    const payload = {
      name: general.projectName,
      description: general.projectOverview || '',
      company_id: formData.general.companyId || null,
      client_name: general.clientName,
      project_manager: general.projectManager || null,
      start_date: general.startDate || null,
      end_date: general.endDate || null,
      budget: commercial.projectValue || null,
      status: statusValue,
      priority: 'medium',
      progress: construction.installationPercentActual ? Number(construction.installationPercentActual) : 0,
      notes: JSON.stringify(formData)
    };

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.success) {
        redirectToCalendar(general.startDate);
      } else {
        alert('Error creating project: ' + result.error);
      }
    } catch (error) {
      console.error('Projects create error:', error);
      alert('Error creating project');
    } finally {
      setSubmitting(false);
    }
  };

  const renderGeneralTab = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-black">Project Profile</h2>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project ID / Code</label>
            <input
              type="text"
              value={formData.general.projectCode}
              onChange={(e) => updateField('general', 'projectCode', e.target.value)}
              placeholder="Auto-generated or manual reference"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Industry</label>
            <select
              value={formData.general.industry}
              onChange={(e) => updateField('general', 'industry', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="">Select industry</option>
              {INDUSTRIES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project Name *</label>
            <input
              type="text"
              value={formData.general.projectName}
              onChange={(e) => updateField('general', 'projectName', e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Contract Type</label>
            <select
              value={formData.general.contractType}
              onChange={(e) => updateField('general', 'contractType', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="">Select contract type</option>
              {CONTRACT_TYPES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Linked Company</label>
            <select
              value={formData.general.companyId}
              onChange={(e) => updateField('general', 'companyId', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="">No company linked</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.company_name || company.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-black">Client Details</h2>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Client Name *</label>
            <input
              type="text"
              value={formData.general.clientName}
              onChange={(e) => updateField('general', 'clientName', e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Client Contact Details</label>
            <input
              type="text"
              value={formData.general.clientContact}
              onChange={(e) => updateField('general', 'clientContact', e.target.value)}
              placeholder="Email / Phone / Point of Contact"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project Manager</label>
            <input
              type="text"
              value={formData.general.projectManager}
              onChange={(e) => updateField('general', 'projectManager', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Status</label>
            <select
              value={formData.general.status}
              onChange={(e) => updateField('general', 'status', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              {Object.keys(STATUS_MAP).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-black">Location & Schedule</h2>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Country</label>
            <input
              type="text"
              value={formData.general.locationCountry}
              onChange={(e) => updateField('general', 'locationCountry', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">City</label>
            <input
              type="text"
              value={formData.general.locationCity}
              onChange={(e) => updateField('general', 'locationCity', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Site</label>
            <input
              type="text"
              value={formData.general.locationSite}
              onChange={(e) => updateField('general', 'locationSite', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project Start Date</label>
            <input
              type="date"
              value={formData.general.startDate}
              onChange={handleStartDateChange}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project End Date</label>
            <input
              type="date"
              value={formData.general.endDate}
              onChange={(e) => updateField('general', 'endDate', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project Duration (Planned)</label>
            <input
              type="text"
              value={formData.general.durationPlanned}
              onChange={(e) => updateField('general', 'durationPlanned', e.target.value)}
              placeholder="e.g., 18 months"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Project Duration (Actual)</label>
            <input
              type="text"
              value={formData.general.durationActual}
              onChange={(e) => updateField('general', 'durationActual', e.target.value)}
              placeholder="e.g., 20 months"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-black mb-1">Project Overview</label>
        <textarea
          value={formData.general.projectOverview}
          onChange={(e) => updateField('general', 'projectOverview', e.target.value)}
          rows={3}
          placeholder="Summarize project scope, objectives, and key outcomes."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
    </div>
  );

  const renderCommercialTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Project Value (Contract Price)</label>
          <input
            type="number"
            value={formData.commercial.projectValue}
            onChange={(e) => updateField('commercial', 'projectValue', e.target.value)}
            min="0"
            step="0.01"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Currency</label>
          <select
            value={formData.commercial.currency}
            onChange={(e) => updateField('commercial', 'currency', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Payment Terms</label>
          <select
            value={formData.commercial.paymentTerms}
            onChange={(e) => updateField('commercial', 'paymentTerms', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          >
            {PAYMENT_TERMS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Invoicing Status</label>
          <select
            value={formData.commercial.invoicingStatus}
            onChange={(e) => updateField('commercial', 'invoicingStatus', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          >
            {INVOICING_STATUS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Cost to Company</label>
          <input
            type="number"
            value={formData.commercial.costToCompany}
            onChange={(e) => updateField('commercial', 'costToCompany', e.target.value)}
            min="0"
            step="0.01"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Profitability Estimate</label>
          <input
            type="text"
            value={formData.commercial.profitabilityEstimate}
            onChange={(e) => updateField('commercial', 'profitabilityEstimate', e.target.value)}
            placeholder="e.g., 18% gross margin"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-black mb-1">Subcontractors / Vendors (Scope & Contract Value)</label>
        <textarea
          value={formData.commercial.subcontractorsList}
          onChange={(e) => updateField('commercial', 'subcontractorsList', e.target.value)}
          rows={3}
          placeholder="List subcontractors with scope, value, and contact references."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-black mb-1">Additional Vendors</label>
        <textarea
          value={formData.commercial.vendorsList}
          onChange={(e) => updateField('commercial', 'vendorsList', e.target.value)}
          rows={3}
          placeholder="Capture vendor names, scope, PO references, and values."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
    </div>
  );

  const renderEngineeringTab = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-medium text-black mb-1">Discipline-wise Deliverables</label>
        <textarea
          value={formData.engineering.disciplineDeliverables}
          onChange={(e) => updateField('engineering', 'disciplineDeliverables', e.target.value)}
          rows={3}
          placeholder="List deliverables across Process, Mechanical, Piping, Civil, Electrical, Instrumentation, etc."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Planned Submission Dates</label>
          <textarea
            value={formData.engineering.plannedSubmissionDates}
            onChange={(e) => updateField('engineering', 'plannedSubmissionDates', e.target.value)}
            rows={3}
            placeholder="Discipline-wise planned dates"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Actual Submission Dates</label>
          <textarea
            value={formData.engineering.actualSubmissionDates}
            onChange={(e) => updateField('engineering', 'actualSubmissionDates', e.target.value)}
            rows={3}
            placeholder="Discipline-wise actual dates"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Approval Status</label>
          <select
            value={formData.engineering.approvalStatus}
            onChange={(e) => updateField('engineering', 'approvalStatus', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          >
            {APPROVAL_STATUS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Manhours Planned</label>
          <input
            type="number"
            value={formData.engineering.manhoursPlanned}
            onChange={(e) => updateField('engineering', 'manhoursPlanned', e.target.value)}
            min="0"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Manhours Consumed</label>
          <input
            type="number"
            value={formData.engineering.manhoursConsumed}
            onChange={(e) => updateField('engineering', 'manhoursConsumed', e.target.value)}
            min="0"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>
    </div>
  );

  const renderProcurementTab = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-medium text-black mb-1">Long Lead Items (LLI)</label>
        <textarea
          value={formData.procurement.longLeadItems}
          onChange={(e) => updateField('procurement', 'longLeadItems', e.target.value)}
          rows={3}
          placeholder="Capture critical equipment with lead times and responsible buyer"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-black mb-1">Vendor PO Details</label>
        <textarea
          value={formData.procurement.vendorPoDetails}
          onChange={(e) => updateField('procurement', 'vendorPoDetails', e.target.value)}
          rows={3}
          placeholder="PO numbers, vendor names, scope, value"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-black mb-1">Delivery Dates</label>
        <textarea
          value={formData.procurement.deliveryDates}
          onChange={(e) => updateField('procurement', 'deliveryDates', e.target.value)}
          rows={3}
          placeholder="Planned vs actual deliveries"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-black mb-1">Inspection & Expediting Records</label>
        <textarea
          value={formData.procurement.inspectionRecords}
          onChange={(e) => updateField('procurement', 'inspectionRecords', e.target.value)}
          rows={3}
          placeholder="Inspection status, expediting notes, NCRs"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
    </div>
  );

  const renderConstructionTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Mobilization Date</label>
          <input
            type="date"
            value={formData.construction.mobilizationDate}
            onChange={(e) => updateField('construction', 'mobilizationDate', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Commissioning Date</label>
          <input
            type="date"
            value={formData.construction.commissioningDate}
            onChange={(e) => updateField('construction', 'commissioningDate', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Handover Date</label>
          <input
            type="date"
            value={formData.construction.handoverDate}
            onChange={(e) => updateField('construction', 'handoverDate', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Installation % (Planned)</label>
          <input
            type="number"
            value={formData.construction.installationPercentPlanned}
            onChange={(e) => updateField('construction', 'installationPercentPlanned', e.target.value)}
            min="0" max="100"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Installation % (Actual)</label>
          <input
            type="number"
            value={formData.construction.installationPercentActual}
            onChange={(e) => updateField('construction', 'installationPercentActual', e.target.value)}
            min="0" max="100"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-black mb-1">Site Progress (Weekly / Monthly)</label>
        <textarea
          value={formData.construction.siteProgress}
          onChange={(e) => updateField('construction', 'siteProgress', e.target.value)}
          rows={3}
          placeholder="Capture progress summaries, key accomplishments, blockers."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        />
      </div>
    </div>
  );

  const renderRiskTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Major Risks Identified</label>
          <textarea
            value={formData.risk.majorRisks}
            onChange={(e) => updateField('risk', 'majorRisks', e.target.value)}
            rows={3}
            placeholder="List key risks with probability & impact."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Mitigation Plans</label>
          <textarea
            value={formData.risk.mitigationPlans}
            onChange={(e) => updateField('risk', 'mitigationPlans', e.target.value)}
            rows={3}
            placeholder="Actions, owners, deadlines"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Change Orders / Variations</label>
          <textarea
            value={formData.risk.changeOrders}
            onChange={(e) => updateField('risk', 'changeOrders', e.target.value)}
            rows={3}
            placeholder="Reference numbers, description, commercial impact"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Claims / Disputes</label>
          <textarea
            value={formData.risk.claimsDisputes}
            onChange={(e) => updateField('risk', 'claimsDisputes', e.target.value)}
            rows={3}
            placeholder="Client claims, contractor disputes, resolution status"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>
    </div>
  );

  const renderCloseoutTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Final Documentation Status</label>
          <input
            type="text"
            value={formData.closeout.finalDocumentationStatus}
            onChange={(e) => updateField('closeout', 'finalDocumentationStatus', e.target.value)}
            placeholder="e.g., 80% submitted"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Actual Profit / Loss</label>
          <input
            type="text"
            value={formData.closeout.actualProfitLoss}
            onChange={(e) => updateField('closeout', 'actualProfitLoss', e.target.value)}
            placeholder="e.g., +₹1.8 Cr"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">Lessons Learned</label>
          <textarea
            value={formData.closeout.lessonsLearned}
            onChange={(e) => updateField('closeout', 'lessonsLearned', e.target.value)}
            rows={3}
            placeholder="Captured best practices, improvement areas"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">Client Feedback</label>
          <textarea
            value={formData.closeout.clientFeedback}
            onChange={(e) => updateField('closeout', 'clientFeedback', e.target.value)}
            rows={3}
            placeholder="Client satisfaction, testimonials, surveys"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          />
        </div>
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general': return renderGeneralTab();
      case 'commercial': return renderCommercialTab();
      case 'engineering': return renderEngineeringTab();
      case 'procurement': return renderProcurementTab();
      case 'construction': return renderConstructionTab();
      case 'risk': return renderRiskTab();
      case 'closeout': return renderCloseoutTab();
      default: return null;
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-black transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-1" />
                  Back to Projects
                </button>
                <h1 className="mt-3 text-xl font-bold text-black">Create Project</h1>
                <p className="text-sm text-black">
                  {selectedDate
                    ? `Scheduling for ${format(selectedDate, 'EEEE, MMMM d, yyyy')}`
                    : 'Capture comprehensive project details to coordinate delivery.'}
                </p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>All sections will be saved into project notes for downstream visibility.</p>
              </div>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-6">
              <div className="bg-white rounded-lg border border-gray-200">
                <nav className="flex flex-wrap border-b border-gray-200 text-xs font-medium">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-4 py-3 border-b-2 transition-colors ${
                        activeTab === tab.id
                          ? 'border-accent-primary text-black'
                          : 'border-transparent text-gray-500 hover:text-black hover:border-gray-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
                <div className="p-6 space-y-6">{renderTabContent()}</div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {submitting ? 'Saving...' : 'Create Project'}
                </button>
              </div>
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}