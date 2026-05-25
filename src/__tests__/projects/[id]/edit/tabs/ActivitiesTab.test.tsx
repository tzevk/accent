import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ActivitiesTab from '@/app/projects/[id]/edit/tabs/ActivitiesTab'

describe('ActivitiesTab', () => {
    const mockFunctions = [
        {
            id: 1,
            function_name: 'Piping',
            activities: [
                {
                    id: 101,
                    activity_name: 'Modeling',
                    subActivities: [
                        { id: 201, name: 'ISO Drawings' },
                        { id: 202, name: 'GA Drawings' }
                    ]
                }
            ]
        }
    ]

    const mockProjectActivities = [
        { id: 101, type: 'activity', name: 'Modeling', description: 'Initial modeling desc' }
    ]

    it('renders functions and activities correctly', () => {
        render(
            <ActivitiesTab
                functions={mockFunctions}
                projectActivities={mockProjectActivities}
                setProjectActivities={vi.fn()}
                toggleProjectActivity={vi.fn()}
            />
        )

        expect(screen.getByText('Piping')).toBeInTheDocument()
        expect(screen.getAllByText('Modeling')[0]).toBeInTheDocument()
        expect(screen.getByDisplayValue('Initial modeling desc')).toBeInTheDocument()
    })

    it('shows empty message when functions are empty', () => {
        render(
            <ActivitiesTab
                functions={[]}
                projectActivities={[]}
                setProjectActivities={vi.fn()}
                toggleProjectActivity={vi.fn()}
            />
        )

        expect(screen.getByText(/No disciplines\/functions found/)).toBeInTheDocument()
    })

    it('triggers toggleProjectActivity when checkbox is clicked', async () => {
        const user = userEvent.setup()
        const toggleProjectActivity = vi.fn()
        render(
            <ActivitiesTab
                functions={mockFunctions}
                projectActivities={mockProjectActivities}
                setProjectActivities={vi.fn()}
                toggleProjectActivity={toggleProjectActivity}
            />
        )

        const checkbox = screen.getByRole('checkbox', { name: 'Modeling' })
        await user.click(checkbox)

        expect(toggleProjectActivity).toHaveBeenCalledWith(101, 'activity')
    })
})
