import {
  DocumentTextIcon,
  PlusIcon,
  XMarkIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

export default function InvoiceTab({
  canEditInvoices,
  handleAddInvoice,
  invoiceSaving,
  invoiceData,
  editingInvoiceId,
  handleInvoiceChange,
  setEditingInvoiceId,
  setInvoiceData,
  form,
  invoices = [],
  handleEditInvoice,
  handleDeleteInvoice,
  loadingAccountHeads,
  accountHeads = [],
}) {
  const invoiceOnly = invoices.filter(
    (inv) => inv.tab_type !== "purchase_order",
  );

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <DocumentTextIcon className="h-4 w-4 text-[#7F2487]" />
              <h2 className="text-sm font-bold text-gray-900">Purchase Invoices</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {canEditInvoices
                ? "Create and manage project invoices"
                : "View-only mode - You have read permission only"}
            </p>
          </div>
          {canEditInvoices && (
            <button
              type="button"
              onClick={handleAddInvoice}
              disabled={invoiceSaving || !invoiceData.invoice_number}
              className="px-4 py-2 bg-[#7F2487] text-white text-xs font-medium rounded-md hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {invoiceSaving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {editingInvoiceId ? "Updating..." : "Adding..."}
                </>
              ) : (
                <>
                  <PlusIcon className="h-4 w-4" />
                  {editingInvoiceId ? "Update Invoice" : "Add Invoice"}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Invoice Input Form - Compact Grid Layout */}
        <div className="bg-purple-25/30 rounded-lg p-3 border border-purple-100">
          <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <DocumentTextIcon className="h-3.5 w-3.5 text-[#7F2487]" />
            {editingInvoiceId
              ? "Edit Invoice"
              : canEditInvoices
                ? "New Invoice"
                : "Invoice Details"}
          </h3>

          {/* Row 1: Company Name, City, Invoice No, Invoice Date */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="company_name"
                value={invoiceData.company_name}
                onChange={handleInvoiceChange}
                placeholder="Auto-filled"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">City</label>
              <input
                type="text"
                name="city"
                value={invoiceData.city}
                onChange={handleInvoiceChange}
                placeholder="Auto-filled"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>

            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">
                Invoice No. <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="invoice_number"
                value={invoiceData.invoice_number}
                onChange={handleInvoiceChange}
                placeholder="INV-00001"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">Invoice Date</label>
              <input
                type="date"
                name="invoice_date"
                value={invoiceData.invoice_date}
                onChange={handleInvoiceChange}
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
          </div>

          {/* Row 2: Invoice Amount, Project No, Expenses Head, Payment */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">
                Invoice Amount (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="invoice_amount"
                value={invoiceData.invoice_amount}
                onChange={handleInvoiceChange}
                placeholder="0.00"
                step="0.01"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">Project No.</label>
              <input
                type="text"
                name="project_number"
                value={invoiceData.project_number}
                onChange={handleInvoiceChange}
                placeholder="Auto-filled"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>

            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">
                Expenses Head <span className="text-red-500">*</span>
              </label>
              <select
                name="expenses_head"
                value={invoiceData.expenses_head}
                onChange={handleInvoiceChange}
                disabled={!canEditInvoices || loadingAccountHeads}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              >
                <option value="">Select Expense Head</option>
                {accountHeads.length > 0 ? (
                  accountHeads.map((head) => (
                    <option key={head.id} value={head.name || head.head_name || ""}>
                      {head.name || head.head_name || head.description || ""}
                    </option>
                  ))
                ) : (
                  <option disabled>No expense heads available</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">Payment (₹)</label>
              <input
                type="number"
                name="payment"
                value={invoiceData.payment}
                onChange={handleInvoiceChange}
                placeholder="0.00"
                step="0.01"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
          </div>

          {/* Row 3: Overdue Days, Purchase Description, Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">Overdue Days</label>
              <input
                type="number"
                name="payment_overdue_days"
                value={invoiceData.payment_overdue_days}
                onChange={handleInvoiceChange}
                placeholder="0"
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">Purchase Description</label>
              <input
                type="text"
                name="purchase_description"
                value={invoiceData.purchase_description}
                onChange={handleInvoiceChange}
                placeholder="Description..."
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-700 mb-0.5">Remarks</label>
              <input
                type="text"
                name="remarks"
                value={invoiceData.remarks}
                onChange={handleInvoiceChange}
                placeholder="Notes..."
                disabled={!canEditInvoices}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent ${!canEditInvoices ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"}`}
              />
            </div>
          </div>

          {/* ADD / UPDATE Button */}
          {canEditInvoices && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-purple-100">
              <span className="text-[10px] text-gray-400 italic">
                {editingInvoiceId
                  ? `Editing invoice ID: ${editingInvoiceId}`
                  : "Fill fields above and click Add Invoice"}
              </span>
              <div className="flex items-center gap-2">
                {editingInvoiceId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingInvoiceId(null);
                      setInvoiceData((prev) => ({
                        ...prev,
                        invoice_number: "",
                        invoice_date: new Date().toISOString().split("T")[0],
                        invoice_amount: "",
                        purchase_description: "",
                        expenses_head: "",
                        payment: "",
                        payment_overdue_days: "",
                        remarks: "",
                        company_name: form.client_name || "",
                        city: form.project_location_city || "",
                        project_number: form.project_id || "",
                      }));
                    }}
                    className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded hover:bg-gray-200 flex items-center gap-1"
                  >
                    <XMarkIcon className="h-3 w-3" /> Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddInvoice}
                  disabled={invoiceSaving || !invoiceData.invoice_number}
                  className="px-3 py-1 bg-[#7F2487] text-white text-xs font-medium rounded hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {invoiceSaving ? (
                    <>
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>{" "}
                      {editingInvoiceId ? "Updating..." : "Adding..."}
                    </>
                  ) : (
                    <>
                      <PlusIcon className="h-3 w-3" />{" "}
                      {editingInvoiceId ? "Update Invoice" : "Add Invoice"}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Invoices List */}
        {invoiceOnly.length > 0 && (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Sr. No.</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Company Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">City</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Invoice No.</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Invoice Date</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Invoice Amount</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Project No</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Expenses Head</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Payment</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Overdue Days</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Remarks</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoiceOnly.map((inv, idx) => (
                  <tr key={inv.id || idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-center text-gray-600 font-semibold">{idx + 1}</td>
                    <td className="px-3 py-2 text-gray-700">{inv.company_name || "-"}</td>
                    <td className="px-3 py-2 text-gray-700">{inv.city || "-"}</td>
                    <td className="px-3 py-2 text-gray-700 font-medium">{inv.invoice_number || "-"}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {inv.invoice_date
                        ? new Date(inv.invoice_date).toLocaleDateString("en-IN")
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">
                      ₹
                      {parseFloat(inv.invoice_amount || 0).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{inv.project_number || "-"}</td>
                    <td className="px-3 py-2 text-gray-700">{inv.expenses_head || "-"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">
                      {inv.payment
                        ? `₹${parseFloat(inv.payment || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-700">{inv.payment_overdue_days || "0"}</td>
                    <td className="px-3 py-2 text-gray-700">{inv.remarks || "-"}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditInvoice(inv)}
                          disabled={!canEditInvoices}
                          className="text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed p-1 rounded hover:bg-blue-50"
                          title="Edit invoice"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteInvoice(inv.id || idx)}
                          disabled={!canEditInvoices}
                          className="text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed p-1 rounded hover:bg-red-50"
                          title="Delete invoice"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty State */}
        {invoiceOnly.length === 0 && (
          <div className="text-center py-12 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg">
            <DocumentTextIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-2">No invoices added yet</p>
            <p className="text-gray-400 text-xs">
              Fill in the form above and click &ldquo;Add Invoice&rdquo; to create your first invoice
            </p>
          </div>
        )}

        {/* Summary Card */}
        {invoiceOnly.length > 0 && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Total Invoices</p>
                <p className="text-lg font-bold text-blue-700">{invoiceOnly.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Total Amount</p>
                <p className="text-lg font-bold text-purple-700">
                  ₹
                  {parseFloat(
                    invoiceOnly.reduce(
                      (sum, inv) => sum + (parseFloat(inv.invoice_amount) || 0),
                      0,
                    ),
                  ).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Avg. Overdue Days</p>
                <p className="text-lg font-bold text-orange-700">
                  {invoiceOnly.length > 0
                    ? (
                        invoiceOnly.reduce(
                          (sum, inv) => sum + (parseFloat(inv.payment_overdue_days) || 0),
                          0,
                        ) / invoiceOnly.length
                      ).toFixed(0)
                    : "0"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
