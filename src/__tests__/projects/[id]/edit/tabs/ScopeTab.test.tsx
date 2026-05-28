import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ScopeTab from '@/app/projects/[id]/edit/tabs/ScopeTab';

const baseForm = {
  scope_of_work: '',
  additional_scope: '',
  description: '',
};

describe('ScopeTab', () => {
  it('renders without crashing and displays empty states', () => {
    render(<ScopeTab form={baseForm} setForm={vi.fn()} />);

    // Verify empty state messages
    expect(
      screen.getByText('No original scope defined yet')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No additional scope items added yet')
    ).toBeInTheDocument();

    // Verify badge
    expect(screen.getByText('No Original Scope')).toBeInTheDocument();

    // Overview section should not be present
    expect(
      screen.queryByText('Complete Scope Overview')
    ).not.toBeInTheDocument();
  });

  it('renders original scope from scope_of_work and displays correct badges', () => {
    const form = {
      ...baseForm,
      scope_of_work: 'Original design scope contents',
    };
    render(<ScopeTab form={form} setForm={vi.fn()} />);

    expect(screen.getAllByText('Original design scope contents')).toHaveLength(
      2
    );
    expect(screen.getByText('Original Scope Defined')).toBeInTheDocument();
    expect(screen.getByText('Complete Scope Overview')).toBeInTheDocument();
  });

  it('renders original scope from description when scope_of_work is empty', () => {
    const form = {
      ...baseForm,
      description: 'Fallback scope description',
    };
    render(<ScopeTab form={form} setForm={vi.fn()} />);

    expect(screen.getAllByText('Fallback scope description')).toHaveLength(2);
    expect(screen.getByText('No Original Scope')).toBeInTheDocument();
  });

  it('renders additional scope items list and badge details', () => {
    const form = {
      ...baseForm,
      additional_scope: 'Item A\nItem B\nItem C',
    };
    render(<ScopeTab form={form} setForm={vi.fn()} />);

    // Check if items are in document (both list and overview)
    expect(screen.getAllByText('Item A')).toHaveLength(2);
    expect(screen.getAllByText('Item B')).toHaveLength(2);
    expect(screen.getAllByText('Item C')).toHaveLength(2);

    // Check badges
    expect(screen.getByText('Additional Scope Added')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();

    // Complete Scope Overview should have both header and item texts
    expect(screen.getByText('Complete Scope Overview')).toBeInTheDocument();
  });

  it('calls setForm when adding an item via input keydown Enter', async () => {
    const user = userEvent.setup();
    const setForm = vi.fn();
    render(<ScopeTab form={baseForm} setForm={setForm} />);

    const input = screen.getByPlaceholderText(/Type new scope item/);
    await user.type(input, 'New Item 1{enter}');

    expect(setForm).toHaveBeenCalledTimes(1);

    // Verify state update behavior
    const updater = setForm.mock.calls[0][0];
    const updatedState = updater(baseForm);
    expect(updatedState.additional_scope).toBe('New Item 1');
  });

  it('calls setForm when adding an item via clicking the Add button', async () => {
    const user = userEvent.setup();
    const setForm = vi.fn();
    const form = {
      ...baseForm,
      additional_scope: 'Existing Item',
    };
    render(<ScopeTab form={form} setForm={setForm} />);

    const input = screen.getByPlaceholderText(/Type new scope item/);
    await user.type(input, 'New Item 2');

    const addButton = screen.getByRole('button', { name: /Add/ });
    await user.click(addButton);

    expect(setForm).toHaveBeenCalledTimes(1);

    const updater = setForm.mock.calls[0][0];
    const updatedState = updater(form);
    expect(updatedState.additional_scope).toBe('Existing Item\nNew Item 2');
  });

  it('calls setForm to remove an item', async () => {
    const user = userEvent.setup();
    const setForm = vi.fn();
    const form = {
      ...baseForm,
      additional_scope: 'First Item\nSecond Item\nThird Item',
    };
    render(<ScopeTab form={form} setForm={setForm} />);

    const removeButtons = screen.getAllByTitle('Remove item');
    expect(removeButtons).toHaveLength(3);

    // Remove the second item ("Second Item")
    await user.click(removeButtons[1]);

    expect(setForm).toHaveBeenCalledTimes(1);
    const updater = setForm.mock.calls[0][0];
    const updatedState = updater(form);
    // 'First Item\nThird Item'
    expect(updatedState.additional_scope).toBe('First Item\nThird Item');
  });
});
