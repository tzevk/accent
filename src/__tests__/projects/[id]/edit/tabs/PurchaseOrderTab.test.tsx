import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PurchaseOrderTab from '@/app/projects/[id]/edit/tabs/PurchaseOrderTab'

describe('PurchaseOrderTab', () => {
    const mockInvoiceData = {
        company_name: 'Test Corp',
        city: 'Mumbai',
        invoice_number: 'PO-999',
        invoice_date: '2026-05-25',
        invoice_amount: 1500,
        project_number: 'PRJ-101',
        remarks: 'Sample PO'
    }

    const mockInvoices = [
        {
            id: 1,
            tab_type: 'purchase_order',
            company_name: 'Test Corp',
            city: 'Mumbai',
            invoice_number: 'PO-999',
            invoice_date: '2026-05-25',
            invoice_amount: 1500,
            project_number: 'PRJ-101',
            remarks: 'Sample PO'
        }
    ]

    it('renders purchase orders correctly', () => {
        render(
            <PurchaseOrderTab
                canEditPurchaseOrders={true}
                handleAddInvoice={vi.fn()}
                invoiceSaving={false}
                invoiceData={mockInvoiceData}
                editingInvoiceId={null}
                handleInvoiceChange={vi.fn()}
                setEditingInvoiceId={vi.fn()}
                setInvoiceData={vi.fn()}
                form={{}}
                invoices={mockInvoices as any}
                handleEditInvoice={vi.fn()}
                handleDeleteInvoice={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('PO-999')).toBeInTheDocument()
        expect(screen.getByDisplayValue('1500')).toBeInTheDocument()
        expect(screen.getByText('Test Corp')).toBeInTheDocument()
        expect(screen.getAllByText((content) => content.includes('1,500.00')).length).toBeGreaterThan(0)
    })

    it('calls handleAddInvoice when Add PO is clicked', async () => {
        const user = userEvent.setup()
        const handleAddInvoice = vi.fn()

        render(
            <PurchaseOrderTab
                canEditPurchaseOrders={true}
                handleAddInvoice={handleAddInvoice}
                invoiceSaving={false}
                invoiceData={mockInvoiceData}
                editingInvoiceId={null}
                handleInvoiceChange={vi.fn()}
                setEditingInvoiceId={vi.fn()}
                setInvoiceData={vi.fn()}
                form={{}}
                invoices={[]}
                handleEditInvoice={vi.fn()}
                handleDeleteInvoice={vi.fn()}
            />
        )

        const addButton = screen.getAllByRole('button', { name: /Add PO/i })[0]
        await user.click(addButton)

        expect(handleAddInvoice).toHaveBeenCalled()
    })

    it('calls handleDeleteInvoice when delete action is clicked', async () => {
        const user = userEvent.setup()
        const handleDeleteInvoice = vi.fn()

        render(
            <PurchaseOrderTab
                canEditPurchaseOrders={true}
                handleAddInvoice={vi.fn()}
                invoiceSaving={false}
                invoiceData={mockInvoiceData}
                editingInvoiceId={null}
                handleInvoiceChange={vi.fn()}
                setEditingInvoiceId={vi.fn()}
                setInvoiceData={vi.fn()}
                form={{}}
                invoices={mockInvoices as any}
                handleEditInvoice={vi.fn()}
                handleDeleteInvoice={handleDeleteInvoice}
            />
        )

        const deleteBtn = screen.getByTitle('Delete PO')
        await user.click(deleteBtn)

        expect(handleDeleteInvoice).toHaveBeenCalledWith(1)
    })
})
