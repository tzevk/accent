import ProjectOrdersPanel from '@/components/ProjectOrdersPanel';

/**
 * Project tab → Orders (ticket #310).
 *
 * The old tab edited one ambiguous `project_purchase_orders` row per Project
 * (a client name and a vendor name on the same record) and wrote orders into
 * `project_invoices.tab_type = 'purchase_order'`, two of the four competing
 * order stores. The Project now shows its canonical orders and links to the
 * one order entry/review screen.
 */
export default function PurchaseOrderTab({
	projectId,
	canManageOrders = false,
}) {
	return (
		<ProjectOrdersPanel
			projectId={projectId}
			canManageOrders={canManageOrders}
		/>
	);
}
