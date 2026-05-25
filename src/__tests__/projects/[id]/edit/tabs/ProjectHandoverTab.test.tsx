import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ProjectHandoverTab from '@/app/projects/[id]/edit/tabs/ProjectHandoverTab'

describe('ProjectHandoverTab', () => {
    const mockNewRow = {
        output_by_accent: '',
        requirement_accomplished: '',
        remark: '',
        hand_over: ''
    }

    const mockHandover = [
        {
            id: 1,
            output_by_accent: 'accent output doc',
            requirement_accomplished: 'Y',
            remark: 'accomplished remark',
            hand_over: 'Y'
        }
    ]

    it('renders handover items correctly', () => {
        render(
            <ProjectHandoverTab
                newHandoverRow={mockNewRow}
                setNewHandoverRow={vi.fn()}
                addHandoverRow={vi.fn()}
                projectHandover={mockHandover}
                updateHandoverRow={vi.fn()}
                removeHandoverRow={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('accent output doc')).toBeInTheDocument()
        expect(screen.getByDisplayValue('accomplished remark')).toBeInTheDocument()
    })

    it('calls removeHandoverRow when remove button clicked', async () => {
        const user = userEvent.setup()
        const removeHandoverRow = vi.fn()
        render(
            <ProjectHandoverTab
                newHandoverRow={mockNewRow}
                setNewHandoverRow={vi.fn()}
                addHandoverRow={vi.fn()}
                projectHandover={mockHandover}
                updateHandoverRow={vi.fn()}
                removeHandoverRow={removeHandoverRow}
            />
        )

        const deleteBtn = screen.getByTitle('Remove item')
        await user.click(deleteBtn)

        expect(removeHandoverRow).toHaveBeenCalledWith(1)
    })
})
