import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DocumentationTab from '@/app/projects/[id]/edit/tabs/DocumentationTab';

describe('DocumentationTab', () => {
  const mockNewDoc = '';

  const mockDocsList = [
    {
      id: 1,
      name: 'Drawing A',
      addedAt: '2026-05-25',
    },
  ];

  it('renders input elements and table records correctly', () => {
    render(
      <DocumentationTab
        newInputDocument={mockNewDoc}
        setNewInputDocument={vi.fn()}
        handleInputDocumentKeyPress={vi.fn()}
        addInputDocument={vi.fn()}
        handleInputDocumentFileUpload={vi.fn()}
        inputDocumentsList={mockDocsList}
        removeInputDocument={vi.fn()}
      />
    );

    expect(screen.getByText('Drawing A')).toBeInTheDocument();
  });

  it('calls removeInputDocument when delete button clicked', async () => {
    const user = userEvent.setup();
    const removeInputDocument = vi.fn();
    render(
      <DocumentationTab
        newInputDocument={mockNewDoc}
        setNewInputDocument={vi.fn()}
        handleInputDocumentKeyPress={vi.fn()}
        addInputDocument={vi.fn()}
        handleInputDocumentFileUpload={vi.fn()}
        inputDocumentsList={mockDocsList}
        removeInputDocument={removeInputDocument}
      />
    );

    const deleteBtn = screen.getByTitle('Remove document');
    await user.click(deleteBtn);

    expect(removeInputDocument).toHaveBeenCalledWith(1);
  });
});
