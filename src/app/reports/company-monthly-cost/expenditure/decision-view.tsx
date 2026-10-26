'use client';

/**
 * The company-first decision composition of the company expenditure report.
 *
 * It leads with the company summary — the existing company headline,
 * comparable-period change, separate payroll estimate, and close/revision
 * context — follows immediately with the compact review summary, and keeps
 * the verbose comparison detail, filtered subtotal, currency subtotals, and
 * existing operational sections below the review. It computes no financial
 * figure: every number arrives on the existing reconciliation payload and
 * every action stays in its existing section. The review summary counts only
 * what existing supported states already state, and its links reveal the
 * existing destination section and move focus to it.
 */

import type { MouseEvent, ReactNode } from 'react';
import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatCurrencyIn } from '@/lib/format';
import type {
	ClosePayload,
	CostRecordJson,
	RevisionPayload,
} from '@/lib/company-expenditure';
import type {
	ClientOrderRow,
	DrilldownPayload,
	PayrollDrilldownPayload,
	ReconciliationPayload,
} from './types';
import { CompanyReconciliationPanel } from './company-reconciliation';
import {
	ComparisonDetail,
	ComparisonSummary,
	CompanyCurrencySubtotals,
	FilteredProjectSubtotal,
} from './comparison-panel';
import { ProjectBreakdown } from './project-breakdown';
import { PayrollSummary } from './payroll-summary';
import { RecognitionQueue } from './recognition-queue';
import type { CommandTarget } from './recognition-queue';
import { BalancesPanel } from './balances-panel';
import BudgetSection from './budget-section';
import CloseSection from './close-section';
import RevisionSection from './revision-section';

export type DecisionSectionId =
	| 'project-detail'
	| 'payroll'
	| 'recognition'
	| 'evidence'
	| 'budget'
	| 'close'
	| 'revision';

const SECTION_ANCHORS: Record<DecisionSectionId, string> = {
	'project-detail': 'decision-project-detail',
	payroll: 'decision-payroll',
	recognition: 'decision-recognition',
	evidence: 'decision-evidence',
	budget: 'decision-budget',
	close: 'decision-close',
	revision: 'decision-revision',
};

const QUEUE_RECOVERY_MESSAGE =
	'Check your connection, then select Refresh to try again.';

export interface DecisionViewProps {
	/** The reconciled month, as the existing report publishes it. */
	data: ReconciliationPayload;
	/** The month under report (`YYYY-MM`). */
	month: string;
	/** The close state from the reconciliation response, or null when absent. */
	close: ClosePayload | null;
	/** True while the reconciliation response is still missing close data. */
	closeLoading: boolean;
	/** The revision state from the reconciliation response, or null when absent. */
	revisions: RevisionPayload | null;
	/** True while the reconciliation response is still missing revision data. */
	revisionsLoading: boolean;
	/** Client orders, for the filtered Project and row context. */
	clientOrders: ClientOrderRow[];
	clientOrdersByProject: Map<number, ClientOrderRow[]>;
	costRanks: Map<string, number>;
	increaseRanks: Map<string, number>;
	rankedRows: Array<{
		row: ReconciliationPayload['projects'][number];
		rank: number | null;
	}>;
	rankingMode: 'cost' | 'increase';
	expandedProject: number | null;
	onProjectExpand: (projectId: number | null) => void;
	drilldownLoading: boolean;
	drilldownRecords: CostRecordJson[] | undefined;
	drilldownPeriodCharges: DrilldownPayload['period_charges'] | undefined;
	drilldownMonth: string | undefined;
	evidenceLoading: boolean;
	evidenceRecords: CostRecordJson[] | undefined;
	payrollEmployees: PayrollDrilldownPayload['employees'];
	payrollLoading: boolean;
	payrollFailed: boolean;
	payrollError: Error | null;
	proposeSubmitting: boolean;
	reviewSubmitting: boolean;
	onProposeReconstruction: (slipId: number) => void;
	onReviewReconstruction: (input: {
		proposalUid: string;
		command: 'approve' | 'reject';
		expectedVersion: number;
		reason?: string;
	}) => void;
	reconstructionError: Error | null;
	expandedEmployee: number | null;
	onEmployeeExpand: (employeeId: number | null) => void;
	reconstructionReason: string;
	onReconstructionReasonChange: (reason: string) => void;
	canProposeReconstruction: boolean;
	canReviewReconstruction: boolean;
	canRevise: boolean;
	canEditCost: boolean;
	canRecognize: boolean;
	canCloseMonth: boolean;
	canReviseClosed: boolean;
	queue: CostRecordJson[];
	queueLoading: boolean;
	queueFailed: boolean;
	queueError: Error | null;
	onCommandReset: () => void;
	onEditTargetChange: (target: CostRecordJson | null) => void;
	onCommandTargetChange: (target: CommandTarget | null) => void;
}

function revealSection(id: DecisionSectionId): void {
	if (typeof document === 'undefined') return;
	const anchor = document.getElementById(SECTION_ANCHORS[id]);
	if (!anchor) return;
	const toggles = Array.from(
		anchor.querySelectorAll<HTMLElement>(
			'[data-decision-reveal="true"][aria-expanded="false"]'
		)
	);
	for (const toggle of toggles) toggle.click();
	const target =
		anchor.querySelector<HTMLElement>('[data-decision-focus]') ??
		(anchor.hasAttribute('data-decision-focus') ? anchor : null);
	if (target) {
		if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
		target.focus({ preventScroll: true });
	}
	if (typeof anchor.scrollIntoView === 'function') {
		anchor.scrollIntoView({ block: 'start' });
	}
}

function DecisionSection({
	id,
	title,
	testId,
	expanded,
	onToggle,
	children,
}: {
	id: DecisionSectionId;
	title: string;
	testId: string;
	expanded: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	const panelId = `${SECTION_ANCHORS[id]}-panel`;
	// Close and revisions reuse their own module's collapse owner: a second
	// wrapper toggle would duplicate the heading and the collapse state, and
	// the review link already reveals the inner toggle too.
	if (id === 'close' || id === 'revision') {
		return (
			<section id={SECTION_ANCHORS[id]} aria-label={title} data-testid={testId}>
				{children}
			</section>
		);
	}
	return (
		<section
			id={SECTION_ANCHORS[id]}
			aria-label={title}
			data-testid={testId}
			data-decision-focus
			tabIndex={-1}
		>
			<h2 className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold">
				<button
					type="button"
					data-decision-reveal="true"
					aria-expanded={expanded}
					aria-controls={panelId}
					onClick={onToggle}
					className="flex w-full items-center gap-2 text-left"
				>
					{expanded ? (
						<ChevronDownIcon className="h-4 w-4 shrink-0" />
					) : (
						<ChevronRightIcon className="h-4 w-4 shrink-0" />
					)}
					{title}
				</button>
			</h2>
			{expanded && <div id={panelId}>{children}</div>}
		</section>
	);
}

function DecisionLink({
	section,
	children,
}: {
	section: DecisionSectionId;
	children: ReactNode;
}) {
	const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.altKey ||
			event.ctrlKey ||
			event.shiftKey
		) {
			return;
		}
		event.preventDefault();
		revealSection(section);
	};
	return (
		<a
			href={`#${SECTION_ANCHORS[section]}`}
			onClick={onClick}
			className="font-medium text-[#64126D] underline underline-offset-2"
		>
			{children}
		</a>
	);
}

export function DecisionView(props: DecisionViewProps) {
	const { data } = props;
	const [expanded, setExpanded] = useState<Record<DecisionSectionId, boolean>>({
		'project-detail': true,
		payroll: true,
		recognition: true,
		evidence: true,
		budget: true,
		close: true,
		revision: true,
	});
	const toggle = (id: DecisionSectionId) =>
		setExpanded((value) => ({ ...value, [id]: !value[id] }));

	const overBudgetProjects = new Set(
		data.budgets.comparisons
			.filter((row) => row.outcome === 'compared' && row.over_budget === true)
			.map((row) => row.project_id)
	);
	const unusableBudgetProjects = new Set(
		data.budgets.comparisons
			.filter((row) => row.outcome !== 'compared')
			.map((row) => row.project_id)
	);
	const scoped = data.project_id !== null;
	const close = props.closeLoading ? null : props.close;
	const revisions = props.revisionsLoading ? null : props.revisions;
	const revisionCount = revisions?.revisions.length ?? 0;
	const payrollEstimate = formatCurrencyIn(
		data.payroll.estimated_total,
		data.payroll.currency
	);
	const payrollNotices = data.coverage.filter(
		(notice) =>
			notice.code === 'payroll_not_generated' ||
			notice.code === 'payroll_not_finalized' ||
			notice.code === 'payroll_slip_missing' ||
			notice.code === 'payroll_pricing_missing' ||
			notice.code === 'payroll_allocation_missing'
	);
	const coverageNotices = data.coverage.filter(
		(notice) =>
			notice.code !== 'payroll_not_generated' &&
			notice.code !== 'payroll_not_finalized' &&
			notice.code !== 'payroll_slip_missing' &&
			notice.code !== 'payroll_pricing_missing' &&
			notice.code !== 'payroll_allocation_missing' &&
			notice.code !== 'payroll_reconstructed' &&
			notice.code !== 'payroll_reconstruction_pending' &&
			notice.code !== 'payroll_no_logged_hours' &&
			notice.code !== 'payroll_no_project_hours' &&
			notice.code !== 'payroll_allocation_revised'
	);

	return (
		<div data-testid="decision-view" data-month={data.month}>
			<section
				aria-label={`Company summary — ${data.month_label}`}
				data-testid="decision-summary"
				data-month={data.month}
				data-scoped={scoped ? String(data.project_id) : ''}
			>
				<h2 className="sr-only">Company summary for {data.month_label}</h2>
				<CompanyReconciliationPanel data={data} />
				<div className="mt-3 grid gap-3 lg:grid-cols-[1fr_320px]">
					<ComparisonSummary data={data} />
					<div
						data-testid="decision-close-context"
						data-close-status={close === null ? '' : close.status}
						data-revision-status={revisions === null ? '' : revisions.status}
						className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
					>
						<h3 className="text-xs font-semibold text-gray-700">
							Financial close
						</h3>
						{close === null ? (
							<p className="mt-1 text-xs text-gray-700">
								Financial close: unavailable
							</p>
						) : (
							<>
								<p className="mt-1 text-xs text-gray-700">
									<DecisionLink section="close">
										Financial close: {close.status}
									</DecisionLink>{' '}
									<span className="text-gray-500">
										({close.review.blockers.length} blocker(s),{' '}
										{close.review.warnings.length} warning(s))
									</span>
								</p>
								{close.status === 'closed' && (
									<p className="mt-1 text-[11px] text-gray-500">
										Figures are frozen; later corrections arrive as revisions.
									</p>
								)}
							</>
						)}
						{revisions === null ? (
							<p className="mt-2 text-xs text-gray-700">
								Financial revisions: unavailable
							</p>
						) : (
							<p className="mt-2 text-xs text-gray-700">
								<DecisionLink section="revision">
									Financial revisions: {revisions.status}
								</DecisionLink>{' '}
								<span className="text-gray-500">
									({revisionCount} revision(s))
								</span>
							</p>
						)}
					</div>
				</div>
			</section>

			{/* Compact review summary: existing supported states only */}
			<section
				aria-label="Review summary"
				data-testid="decision-review"
				data-scoped={scoped ? String(data.project_id) : ''}
				className="mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
			>
				<h2 className="text-xs font-semibold text-gray-700">Review summary</h2>
				{scoped && (
					<p className="mt-1 text-[11px] text-indigo-800">
						Project detail is filtered to one Project; company totals and
						company review context below stay unfiltered.
					</p>
				)}
				<ul className="mt-2 space-y-1 text-xs text-gray-700">
					<li data-testid="decision-review-over-budget">
						<DecisionLink section="project-detail">
							{overBudgetProjects.size} project(s) over budget
						</DecisionLink>{' '}
						<span className="text-gray-500">
							(valid approved monthly comparisons
							{scoped ? ', filtered project detail' : ''})
						</span>
					</li>
					<li data-testid="decision-review-unusable-budget">
						<DecisionLink section="budget">
							{unusableBudgetProjects.size} project(s) without a usable budget
							comparison
						</DecisionLink>{' '}
						<span className="text-gray-500">
							(missing, unapproved, incompatible, ambiguous, or unconfirmed cost
							{scoped ? ', filtered project detail' : ''})
						</span>
					</li>
					<li data-testid="decision-review-queue">
						{props.queueLoading ? (
							'Unconfirmed cost: loading…'
						) : props.queueFailed ? (
							<span role="alert">
								Unconfirmed cost: unavailable
								{props.queueError ? ` (${props.queueError.message})` : ''}.{' '}
								{QUEUE_RECOVERY_MESSAGE}
							</span>
						) : (
							<>
								<DecisionLink section="recognition">
									{props.queue.length} unconfirmed record(s)
								</DecisionLink>{' '}
								<span className="text-gray-500">
									(drafts and pending evidence excluded from totals)
								</span>
							</>
						)}
					</li>
					<li data-testid="decision-review-payroll">
						<DecisionLink section="payroll">
							Payroll: estimated {payrollEstimate} · {payrollNotices.length}{' '}
							coverage notice(s)
						</DecisionLink>{' '}
						<span className="text-gray-500">
							(estimate excluded from confirmed cost
							{data.payroll.missing_pricing_count > 0
								? `, ${data.payroll.missing_pricing_count} unknown pricing`
								: ''}
							)
						</span>
					</li>
					<li data-testid="decision-review-evidence">
						<DecisionLink section="evidence">
							{data.evidence.pending_evidence.count} pending record(s) ·{' '}
							{data.evidence.draft.count} draft(s) · {coverageNotices.length}{' '}
							coverage notice(s)
						</DecisionLink>{' '}
						<span className="text-gray-500">
							(separate categories; one record can appear in more than one)
						</span>
					</li>
					<li data-testid="decision-review-close">
						{close === null ? (
							'Financial close: unavailable'
						) : (
							<>
								<DecisionLink section="close">
									Financial close: {close.status}
								</DecisionLink>{' '}
								<span className="text-gray-500">
									({close.review.blockers.length} blocker(s),{' '}
									{close.review.warnings.length} warning(s))
								</span>
							</>
						)}
					</li>
					<li data-testid="decision-review-revision">
						{revisions === null ? (
							'Financial revisions: unavailable'
						) : (
							<>
								<DecisionLink section="revision">
									Financial revisions: {revisions.status}
								</DecisionLink>{' '}
								<span className="text-gray-500">
									({revisionCount} revision(s))
								</span>
							</>
						)}
					</li>
				</ul>
			</section>

			<ComparisonDetail data={data} />
			<FilteredProjectSubtotal data={data} clientOrders={props.clientOrders} />
			<CompanyCurrencySubtotals data={data} />

			<DecisionSection
				id="project-detail"
				title="Project detail"
				testId="decision-section-project-detail"
				expanded={expanded['project-detail']}
				onToggle={() => toggle('project-detail')}
			>
				<ProjectBreakdown
					data={data}
					month={props.month}
					canManageBudgets={props.canEditCost || props.canRecognize}
					canRecordBudget={props.canEditCost}
					clientOrdersByProject={props.clientOrdersByProject}
					costRanks={props.costRanks}
					increaseRanks={props.increaseRanks}
					rankedRows={props.rankedRows}
					rankingMode={props.rankingMode}
					expandedProject={props.expandedProject}
					onProjectExpand={props.onProjectExpand}
					drilldownLoading={props.drilldownLoading}
					drilldownRecords={props.drilldownRecords}
					drilldownPeriodCharges={props.drilldownPeriodCharges}
					drilldownMonth={props.drilldownMonth}
					evidenceLoading={props.evidenceLoading}
					evidenceRecords={props.evidenceRecords}
				/>
			</DecisionSection>

			<DecisionSection
				id="payroll"
				title="Payroll detail"
				testId="decision-section-payroll"
				expanded={expanded.payroll}
				onToggle={() => toggle('payroll')}
			>
				<PayrollSummary
					data={data}
					payrollEmployees={props.payrollEmployees}
					payrollLoading={props.payrollLoading}
					payrollFailed={props.payrollFailed}
					payrollError={props.payrollError}
					proposeSubmitting={props.proposeSubmitting}
					reviewSubmitting={props.reviewSubmitting}
					onProposeReconstruction={props.onProposeReconstruction}
					onReviewReconstruction={props.onReviewReconstruction}
					reconstructionError={props.reconstructionError}
					expandedEmployee={props.expandedEmployee}
					onEmployeeExpand={props.onEmployeeExpand}
					reconstructionReason={props.reconstructionReason}
					onReconstructionReasonChange={props.onReconstructionReasonChange}
					canProposeReconstruction={props.canProposeReconstruction}
					canReviewReconstruction={props.canReviewReconstruction}
					canRevise={props.canRevise}
				/>
			</DecisionSection>

			<DecisionSection
				id="recognition"
				title="Recognition queue"
				testId="decision-section-recognition"
				expanded={expanded.recognition}
				onToggle={() => toggle('recognition')}
			>
				{props.queueLoading ? (
					<p className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-4 text-center text-xs text-gray-500">
						Unconfirmed cost: loading…
					</p>
				) : props.queueFailed ? (
					<p
						role="alert"
						className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-4 text-center text-xs text-rose-700"
					>
						Unconfirmed cost: unavailable
						{props.queueError ? ` (${props.queueError.message})` : ''}.{' '}
						{QUEUE_RECOVERY_MESSAGE}
					</p>
				) : (
					<RecognitionQueue
						data={data}
						queue={props.queue}
						canEditCost={props.canEditCost}
						canRecognize={props.canRecognize}
						onCommandReset={props.onCommandReset}
						onEditTargetChange={props.onEditTargetChange}
						onCommandTargetChange={props.onCommandTargetChange}
					/>
				)}
			</DecisionSection>

			<DecisionSection
				id="evidence"
				title="Evidence and coverage"
				testId="decision-section-evidence"
				expanded={expanded.evidence}
				onToggle={() => toggle('evidence')}
			>
				<BalancesPanel data={data} />
			</DecisionSection>

			<DecisionSection
				id="budget"
				title="Budget detail"
				testId="decision-section-budget"
				expanded={expanded.budget}
				onToggle={() => toggle('budget')}
			>
				<BudgetSection
					month={props.month}
					section={data.budgets}
					canManageBudgets={props.canEditCost || props.canRecognize}
					canRecordBudget={props.canEditCost}
				/>
			</DecisionSection>

			<DecisionSection
				id="close"
				title="Financial close"
				testId="decision-section-close"
				expanded={expanded.close}
				onToggle={() => toggle('close')}
			>
				<CloseSection
					month={props.month}
					canClose={props.canCloseMonth}
					initialClose={props.close}
				/>
			</DecisionSection>

			<DecisionSection
				id="revision"
				title="Financial revisions"
				testId="decision-section-revision"
				expanded={expanded.revision}
				onToggle={() => toggle('revision')}
			>
				<RevisionSection
					month={props.month}
					canRevise={props.canReviseClosed}
					initialRevisions={props.revisions}
				/>
			</DecisionSection>
		</div>
	);
}
