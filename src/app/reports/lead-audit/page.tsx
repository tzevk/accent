'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	ExclamationTriangleIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { LEAD_AUDIT_VIEWS } from '@/server/reports/lead-audit/types';
import FilterToolbar from './filter-toolbar';
import ReportHeader from './report-header';
import IntakeView from './views/intake-view';
import OverviewView from './views/overview-view';
import WorkView from './views/work-view';
import WorkSummary from './work/work-summary';
import CurrentStateView from './views/current-state-view';
import CurrentStateEvidence from './current-state-evidence';
import ConversionView from './views/conversion-view';
import TimingView from './views/timing-view';
import AuditView from './views/audit-view';
import CoverageView from './views/coverage-view';
import type { LeadAuditWorkMetric } from '@/server/reports/lead-audit/work-types';
import type { CurrentStateEvidenceSelection } from '@/server/reports/lead-audit/current-state-types';
import type {
	LeadAuditConversionEvidenceFilter,
	LeadAuditConversionEvidenceSection,
} from '@/server/reports/lead-audit/conversion-types';
import { DEFAULT_DRAFT, draftToQuery, validateDraft } from './filters';
import type {
	LeadAuditFilterDraft,
	LeadAuditReport,
	LeadAuditMetric,
	LeadAuditRegisterSection,
} from './types';

interface SessionUser {
	is_super_admin?: boolean | number | null;
	field_permissions?: unknown;
}

interface ReportEnvelope {
	success: boolean;
	data?: LeadAuditReport;
	error?: string;
}

interface RegisterEnvelope {
	success: boolean;
	data?: LeadAuditRegisterSection;
	error?: string;
}

interface ConversionEnvelope {
	success: boolean;
	data?: LeadAuditConversionEvidenceSection;
	error?: string;
}

const PAGE_SIZE = 25;

export default function LeadAuditPage() {
	const {
		loading: authLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC() as {
		loading: boolean;
		user: SessionUser | null;
		can: (resource: string, permission: string) => boolean;
		RESOURCES: { REPORTS: string; LEADS: string };
		PERMISSIONS: { READ: string };
	};

	const [draft, setDraft] = useState<LeadAuditFilterDraft>(DEFAULT_DRAFT);
	const [applied, setApplied] = useState<LeadAuditFilterDraft>(DEFAULT_DRAFT);
	const [validationMessage, setValidationMessage] = useState('');
	const [activeView, setActiveView] = useState('overview');
	const [metric, setMetric] = useState<LeadAuditMetric>('recorded');
	const [page, setPage] = useState(1);
	const [workMetric, setWorkMetric] =
		useState<LeadAuditWorkMetric>('completed');
	const [currentSelection, setCurrentSelection] =
		useState<CurrentStateEvidenceSelection | null>(null);
	const [conversionMetric, setConversionMetric] =
		useState<LeadAuditConversionEvidenceFilter>('all');
	const [conversionPage, setConversionPage] = useState(1);

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsRead = can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasLeadsRead = can(RESOURCES.LEADS, PERMISSIONS.READ);
	const hasAccess =
		!!user && (isSuperAdmin || (hasReportsRead && hasLeadsRead));

	const queryParams = useMemo(() => draftToQuery(applied), [applied]);
	const reportParams = { ...queryParams, view: activeView };

	const reportQuery = useQuery<ReportEnvelope>({
		queryKey: ['reports', 'lead-audit', 'report', reportParams],
		queryFn: () => apiGet('/api/reports/lead-audit', reportParams),
		enabled: !authLoading && hasAccess,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		retry: false,
	});

	const report = reportQuery.data?.data ?? null;
	const appliedQuery = useMemo(
		() =>
			report
				? {
						...queryParams,
						from_date: report.scope.from_date,
						to_date: report.scope.to_date,
					}
				: queryParams,
		[queryParams, report]
	);
	const registerParams = useMemo(
		() => ({
			...appliedQuery,
			metric,
			page,
			limit: PAGE_SIZE,
		}),
		[appliedQuery, metric, page]
	);

	const registerQuery = useQuery<RegisterEnvelope>({
		queryKey: ['reports', 'lead-audit', 'register', registerParams],
		queryFn: () => apiGet('/api/reports/lead-audit/register', registerParams),
		enabled:
			!authLoading && hasAccess && activeView === 'intake' && report !== null,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		retry: false,
	});

	const conversionParams = {
		...appliedQuery,
		evidence: conversionMetric,
		page: conversionPage,
		limit: PAGE_SIZE,
	};
	const conversionQuery = useQuery<ConversionEnvelope>({
		queryKey: [
			'reports',
			'lead-audit',
			'conversion-evidence',
			conversionParams,
		],
		queryFn: () =>
			apiGet('/api/reports/lead-audit/conversion/evidence', conversionParams),
		enabled:
			!authLoading && hasAccess && activeView === 'intake' && report !== null,
	});

	// Presets come from the database calendar. Once the server resolves the
	// applied preset, the disabled date fields show the effective dates.
	useEffect(() => {
		if (!report || applied.preset === 'custom') return;
		setDraft((current) =>
			current.preset === applied.preset &&
			(current.from !== report.scope.from_date ||
				current.to !== report.scope.to_date)
				? {
						...current,
						from: report.scope.from_date,
						to: report.scope.to_date,
					}
				: current
		);
	}, [report, applied.preset]);

	const tabs = useMemo(
		() => report?.available_views ?? LEAD_AUDIT_VIEWS,
		[report]
	);
	useEffect(() => {
		if (tabs.length === 0) return;
		if (!tabs.some((tab) => tab.key === activeView)) {
			setActiveView(tabs[0].key);
		}
	}, [tabs, activeView]);

	const updateDraft = (patch: Partial<LeadAuditFilterDraft>) => {
		setDraft((current) => {
			const next = { ...current, ...patch };
			if (patch.preset === 'custom') {
				next.from = current.from || report?.scope.from_date || '';
				next.to = current.to || report?.scope.to_date || '';
			}
			if (patch.sourceMissing) {
				next.source = '';
			}
			return next;
		});
		if (validationMessage !== '') setValidationMessage('');
	};

	const applyFilters = () => {
		const validation = validateDraft(draft);
		if (!validation.valid) {
			setValidationMessage(validation.message);
			return;
		}
		setValidationMessage('');
		setApplied({ ...draft, search: draft.search.trim() });
		setPage(1);
		setCurrentSelection(null);
		setConversionPage(1);
	};

	const resetFilters = () => {
		setDraft(DEFAULT_DRAFT);
		setApplied(DEFAULT_DRAFT);
		setValidationMessage('');
		setMetric('recorded');
		setPage(1);
		setActiveView('overview');
		setCurrentSelection(null);
		setWorkMetric('completed');
		setConversionMetric('all');
		setConversionPage(1);
	};

	const selectMetric = (next: LeadAuditMetric) => {
		setMetric(next);
		setActiveView('intake');
		setPage(1);
	};

	const selectWorkMetric = (next: LeadAuditWorkMetric) => {
		setWorkMetric(next);
		setActiveView('work');
	};
	const selectCurrentGroup = (selection: CurrentStateEvidenceSelection) => {
		setCurrentSelection(selection);
		setActiveView('work');
	};
	const selectConversion = (next: LeadAuditConversionEvidenceFilter) => {
		setConversionMetric(next);
		setConversionPage(1);
		setActiveView('intake');
	};
	const drillIntoAudit = (patch: Partial<LeadAuditFilterDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		setApplied((current) => ({ ...current, ...patch }));
		setActiveView('audit');
		setPage(1);
	};

	const reportError =
		reportQuery.error?.message || reportQuery.data?.error || '';
	const registerError =
		registerQuery.error?.message || registerQuery.data?.error || '';
	const reportLoading =
		reportQuery.isLoading || (reportQuery.isFetching && report === null);

	if (authLoading) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-600">
					Loading…
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center px-4">
					<div className="max-w-md text-center">
						<XMarkIcon
							className="mx-auto mb-2 h-8 w-8 text-red-600"
							aria-hidden="true"
						/>
						<h1 className="text-lg font-bold text-gray-900">Access Denied</h1>
						<p className="mt-1 text-sm text-gray-600">
							The Lead Audit and Performance report requires both the Reports
							read grant and the Leads read grant.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-50 text-black">
			<Navbar />
			<main className="px-2 pb-10 pt-3 sm:px-4">
				<div className="mx-auto max-w-[1550px] space-y-4">
					{report ? (
						<ReportHeader
							report={report}
							evidenceFilters={applied}
							tabs={tabs}
							activeView={activeView}
							onSelectView={setActiveView}
							onRefresh={() => {
								reportQuery.refetch();
								if (activeView === 'intake') registerQuery.refetch();
							}}
							refreshing={reportQuery.isFetching}
						/>
					) : (
						<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
							<h1 className="text-xl font-bold text-gray-900">
								Lead Audit and Performance
							</h1>
							<p className="mt-1 text-sm text-gray-600">
								Lead evidence and management figures for the applied scope.
							</p>
							<nav
								aria-label="Lead Audit views"
								className="mt-3 flex flex-wrap gap-2"
							>
								{tabs.map((tab) => (
									<button
										type="button"
										key={tab.key}
										onClick={() => setActiveView(tab.key)}
										aria-current={tab.key === activeView ? 'page' : undefined}
										className="rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[#64126D]"
									>
										{tab.label}
									</button>
								))}
							</nav>
						</div>
					)}

					<FilterToolbar
						draft={draft}
						options={report?.filter_options}
						onChange={updateDraft}
						onApply={applyFilters}
						onReset={resetFilters}
						busy={reportQuery.isFetching}
						invalidMessage={validationMessage}
					/>

					{reportLoading ? (
						<div
							className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-14 text-sm text-gray-600"
							role="status"
						>
							<ArrowPathIcon
								className="h-5 w-5 motion-safe:animate-spin text-[#64126D]"
								aria-hidden="true"
							/>
							Loading the Lead Audit report…
						</div>
					) : reportError !== '' ? (
						<div
							className="rounded-xl border border-red-200 bg-red-50 p-4"
							role="alert"
						>
							<div className="flex items-start gap-2">
								<ExclamationTriangleIcon
									className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
									aria-hidden="true"
								/>
								<div>
									<h2 className="text-sm font-semibold text-red-900">
										The report could not be loaded.
									</h2>
									<p className="mt-0.5 text-sm text-red-800">{reportError}</p>
									<button
										type="button"
										onClick={() => reportQuery.refetch()}
										className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
									>
										<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
										Retry
									</button>
								</div>
							</div>
						</div>
					) : report === null ? (
						<div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-600">
							The report returned no body. Apply the filters again or refresh.
						</div>
					) : activeView === 'intake' ? (
						<div className="min-w-0 space-y-4">
							<IntakeView
								report={report}
								metric={metric}
								register={registerQuery.data?.data ?? null}
								registerLoading={
									registerQuery.isLoading ||
									(registerQuery.isFetching && !registerQuery.data)
								}
								registerError={registerError}
								page={page}
								onMetricChange={(next) => {
									setMetric(next);
									setPage(1);
								}}
								onPageChange={setPage}
								onRetry={() => registerQuery.refetch()}
							/>
							<ConversionView
								section={report.conversion}
								variant="detail"
								onSelectEvidence={selectConversion}
								selectedEvidence={conversionMetric}
								evidence={conversionQuery.data?.data ?? null}
								evidenceLoading={
									conversionQuery.isLoading || conversionQuery.isFetching
								}
								evidenceError={
									conversionQuery.error?.message ||
									conversionQuery.data?.error ||
									''
								}
								onEvidencePageChange={setConversionPage}
								onRetry={() => conversionQuery.refetch()}
							/>
						</div>
					) : activeView === 'work' ? (
						<div className="min-w-0 space-y-4">
							{currentSelection ? (
								<CurrentStateEvidence
									key={JSON.stringify([currentSelection, appliedQuery])}
									selection={currentSelection}
									appliedQuery={appliedQuery}
									onClose={() => setCurrentSelection(null)}
								/>
							) : null}
							<WorkView
								work={report.work}
								appliedQuery={appliedQuery}
								metric={workMetric}
								onMetricChange={setWorkMetric}
							/>
							<CurrentStateView
								section={report.current_state}
								variant="work"
								onSelectGroup={selectCurrentGroup}
							/>
						</div>
					) : activeView === 'audit' && report.audit !== null ? (
						<AuditView
							report={report.audit}
							appliedQuery={appliedQuery}
							onDrillDown={drillIntoAudit}
						/>
					) : activeView === 'coverage' ? (
						<CoverageView report={report.coverage} />
					) : (
						<div className="min-w-0 space-y-4">
							<OverviewView report={report} onSelectMetric={selectMetric} />
							<WorkSummary
								work={report.work}
								onSelectMetric={selectWorkMetric}
							/>
							<ConversionView
								section={report.conversion}
								variant="summary"
								onSelectEvidence={selectConversion}
							/>
							<TimingView section={report.timing} appliedQuery={appliedQuery} />
							<CurrentStateView
								section={report.current_state}
								onSelectGroup={selectCurrentGroup}
							/>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
