import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import InvoiceTab from '@/app/projects/[id]/edit/tabs/InvoiceTab';

describe('InvoiceTab', () => {
  const mockInvoices = [
    {
      id: 1,
      invoice_number: 'INV-001',
      invoice_date: '2026-05-25',
      invoice_amount: '1200.00',
      status: 'Paid',
      remarks: 'Paid fully',
    },
  ];

  const mockInvoiceData = {
    invoice_number: '',
    invoice_date: '',
    amount: '',
    status: '',
    remarks: '',
  };

  it('renders invoices list and form elements correctly', () => {
    render(
      <InvoiceTab
        canEditInvoices={true}
        handleAddInvoice={vi.fn()}
        invoiceSaving={false}
        invoiceData={mockInvoiceData}
        editingInvoiceId={null}
        handleInvoiceChange={vi.fn()}
        setEditingInvoiceId={vi.fn()}
        setInvoiceData={vi.fn()}
        form={{}}
        invoices={mockInvoices}
        handleEditInvoice={vi.fn()}
        handleDeleteInvoice={vi.fn()}
        loadingAccountHeads={false}
        accountHeads={[]}
      />
    );

    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(
      screen.getAllByText((content) => content.includes('1,200.00'))[0]
    ).toBeInTheDocument();
  });

  it('calls handleDeleteInvoice when delete action is triggered', async () => {
    const user = userEvent.setup();
    const handleDeleteInvoice = vi.fn();
    render(
      <InvoiceTab
        canEditInvoices={true}
        handleAddInvoice={vi.fn()}
        invoiceSaving={false}
        invoiceData={mockInvoiceData}
        editingInvoiceId={null}
        handleInvoiceChange={vi.fn()}
        setEditingInvoiceId={vi.fn()}
        setInvoiceData={vi.fn()}
        form={{}}
        invoices={mockInvoices}
        handleEditInvoice={vi.fn()}
        handleDeleteInvoice={handleDeleteInvoice}
        loadingAccountHeads={false}
        accountHeads={[]}
      />
    );

    const deleteBtn = screen.getByTitle('Delete invoice');
    await user.click(deleteBtn);

    expect(handleDeleteInvoice).toHaveBeenCalledWith(1);
  });
});
