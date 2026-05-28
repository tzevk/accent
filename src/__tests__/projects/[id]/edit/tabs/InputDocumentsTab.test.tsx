import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import InputDocumentsTab from '@/app/projects/[id]/edit/tabs/InputDocumentsTab';

describe('InputDocumentsTab', () => {
  const mockNewDoc = {
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
    subLot: '',
  };

  const mockDocsList = [
    {
      id: 1,
      sr_no: '1',
      date_received: '2026-05-25',
      description: 'Input Doc A',
      drawing_number: 'IN-DRW-001',
      sheet_number: '1',
      revision_number: '0',
      unit_qty: '12',
      document_sent_by: 'Sub',
      remarks: 'Fine',
      category: 'lot',
      lotNumber: 'L1',
      subLot: 'S1',
    },
  ];

  it('renders input documents and inputs correctly', () => {
    render(
      <InputDocumentsTab
        newInputDocument={mockNewDoc}
        setNewInputDocument={vi.fn()}
        handleInputDocumentKeyPress={vi.fn()}
        addInputDocument={vi.fn()}
        inputDocumentsList={mockDocsList}
        setInputDocumentsList={vi.fn()}
        setForm={vi.fn()}
        removeInputDocument={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('Input Doc A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('IN-DRW-001')).toBeInTheDocument();
  });

  it('calls removeInputDocument when delete button is clicked', async () => {
    const user = userEvent.setup();
    const removeInputDocument = vi.fn();
    render(
      <InputDocumentsTab
        newInputDocument={mockNewDoc}
        setNewInputDocument={vi.fn()}
        handleInputDocumentKeyPress={vi.fn()}
        addInputDocument={vi.fn()}
        inputDocumentsList={mockDocsList}
        setInputDocumentsList={vi.fn()}
        setForm={vi.fn()}
        removeInputDocument={removeInputDocument}
      />
    );

    const deleteBtn = screen.getByTitle('Remove document');
    await user.click(deleteBtn);

    expect(removeInputDocument).toHaveBeenCalledWith(1);
  });
});
