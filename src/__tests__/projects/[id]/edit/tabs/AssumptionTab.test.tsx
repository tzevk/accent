import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AssumptionTab from '@/app/projects/[id]/edit/tabs/AssumptionTab'

describe('AssumptionTab', () => {
    const mockAssumptions = [
        {
            id: 1,
            assumption_description: 'Mock desc',
            reason: 'Mock reason',
            assumption_taken_by: 'Mock user',
            remark: 'Mock remark'
        }
    ]

    const mockNewAssumption = {
        assumption_description: '',
        reason: '',
        assumption_taken_by: '',
        remark: ''
    }

    it('renders list of assumptions and new assumption row correctly', () => {
        render(
            <AssumptionTab
                newAssumption={mockNewAssumption}
                setNewAssumption={vi.fn()}
                addAssumptionRow={vi.fn()}
                assumptions={mockAssumptions}
                updateAssumptionRow={vi.fn()}
                removeAssumptionRow={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('Mock desc')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Mock reason')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Mock user')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Mock remark')).toBeInTheDocument()
    })

    it('triggers setNewAssumption on input changes', async () => {
        const user = userEvent.setup()
        const setNewAssumption = vi.fn()
        render(
            <AssumptionTab
                newAssumption={mockNewAssumption}
                setNewAssumption={setNewAssumption}
                addAssumptionRow={vi.fn()}
                assumptions={[]}
                updateAssumptionRow={vi.fn()}
                removeAssumptionRow={vi.fn()}
            />
        )

        const descInput = screen.getByPlaceholderText('Assumption Description')
        await user.type(descInput, 'A')

        expect(setNewAssumption).toHaveBeenCalled()
    })

    it('triggers updateAssumptionRow on editing existing assumptions', async () => {
        const user = userEvent.setup()
        const updateAssumptionRow = vi.fn()
        render(
            <AssumptionTab
                newAssumption={mockNewAssumption}
                setNewAssumption={vi.fn()}
                addAssumptionRow={vi.fn()}
                assumptions={mockAssumptions}
                updateAssumptionRow={updateAssumptionRow}
                removeAssumptionRow={vi.fn()}
            />
        )

        const descInput = screen.getByDisplayValue('Mock desc')
        await user.type(descInput, 'B')

        expect(updateAssumptionRow).toHaveBeenCalledWith(1, 'assumption_description', 'Mock descB')
    })

    it('triggers removeAssumptionRow on click remove', async () => {
        const user = userEvent.setup()
        const removeAssumptionRow = vi.fn()
        render(
            <AssumptionTab
                newAssumption={mockNewAssumption}
                setNewAssumption={vi.fn()}
                addAssumptionRow={vi.fn()}
                assumptions={mockAssumptions}
                updateAssumptionRow={vi.fn()}
                removeAssumptionRow={removeAssumptionRow}
            />
        )

        const removeBtn = screen.getByTitle('Remove assumption')
        await user.click(removeBtn)

        expect(removeAssumptionRow).toHaveBeenCalledWith(1)
    })
})
