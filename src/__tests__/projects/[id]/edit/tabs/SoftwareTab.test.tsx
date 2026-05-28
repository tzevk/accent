import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import SoftwareTab from '@/app/projects/[id]/edit/tabs/SoftwareTab';

describe('SoftwareTab', () => {
  const mockCategories = [{ id: '1', name: 'CAD' }];
  const mockAvailableSoftware = [{ id: '2', name: 'AutoCAD' }];
  const mockAvailableVersions = [{ id: '3', name: '2024' }];

  const mockSoftwareItems = [
    {
      id: '10',
      category_name: 'CAD',
      software_name: 'AutoCAD',
      provider: 'Autodesk',
      version_name: '2024',
      release_date: '2023-03-01',
      notes: 'Production use',
    },
  ];

  it('renders software items correctly', () => {
    render(
      <SoftwareTab
        selectedSoftwareCategory=""
        setSelectedSoftwareCategory={vi.fn()}
        selectedSoftware=""
        setSelectedSoftware={vi.fn()}
        selectedSoftwareVersion=""
        setSelectedSoftwareVersion={vi.fn()}
        softwareCategories={mockCategories}
        availableSoftware={mockAvailableSoftware}
        availableVersions={mockAvailableVersions}
        softwareItems={mockSoftwareItems}
        addSoftwareItem={vi.fn()}
        removeSoftwareItem={vi.fn()}
      />
    );

    expect(screen.getAllByText('CAD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AutoCAD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2024').length).toBeGreaterThan(0);
  });

  it('calls addSoftwareItem when Add Software is clicked', async () => {
    const user = userEvent.setup();
    const addSoftwareItem = vi.fn();

    render(
      <SoftwareTab
        selectedSoftwareCategory="1"
        setSelectedSoftwareCategory={vi.fn()}
        selectedSoftware="2"
        setSelectedSoftware={vi.fn()}
        selectedSoftwareVersion="3"
        setSelectedSoftwareVersion={vi.fn()}
        softwareCategories={mockCategories}
        availableSoftware={mockAvailableSoftware}
        availableVersions={mockAvailableVersions}
        softwareItems={[]}
        addSoftwareItem={addSoftwareItem}
        removeSoftwareItem={vi.fn()}
      />
    );

    const addButton = screen.getByRole('button', { name: /Add Software/i });
    await user.click(addButton);

    expect(addSoftwareItem).toHaveBeenCalled();
  });

  it('calls removeSoftwareItem when Remove software button is clicked', async () => {
    const user = userEvent.setup();
    const removeSoftwareItem = vi.fn();

    render(
      <SoftwareTab
        selectedSoftwareCategory=""
        setSelectedSoftwareCategory={vi.fn()}
        selectedSoftware=""
        setSelectedSoftware={vi.fn()}
        selectedSoftwareVersion=""
        setSelectedSoftwareVersion={vi.fn()}
        softwareCategories={mockCategories}
        availableSoftware={mockAvailableSoftware}
        availableVersions={mockAvailableVersions}
        softwareItems={mockSoftwareItems}
        addSoftwareItem={vi.fn()}
        removeSoftwareItem={removeSoftwareItem}
      />
    );

    const removeBtn = screen.getByTitle('Remove software');
    await user.click(removeBtn);

    expect(removeSoftwareItem).toHaveBeenCalledWith('10');
  });
});
