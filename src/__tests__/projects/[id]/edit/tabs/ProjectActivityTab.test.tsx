import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ProjectActivityTab from '@/app/projects/[id]/edit/tabs/ProjectActivityTab'

describe('ProjectActivityTab', () => {
    const mockProjectActivities = [
        {
            id: 1,
            type: 'activity',
            activity_name: 'Piping Design',
            activity_description: 'Design tasks',
            discipline: 'Piping',
            assigned_users: []
        }
    ]

    const mockFunctions = [
        { id: 10, function_name: 'Piping' }
    ]

    it('renders project activities correctly', () => {
        render(
            <ProjectActivityTab
                projectActivities={mockProjectActivities}
                getActivityTotalPlanned={vi.fn().mockReturnValue(20)}
                getActivityTotalActual={vi.fn().mockReturnValue(15)}
                functions={mockFunctions}
                toggleActivitySelector={vi.fn()}
                showActivitySelector={false}
                activitySelectorSearch=""
                setActivitySelectorSearch={vi.fn()}
                getSelectedCount={vi.fn().mockReturnValue(0)}
                addSelectedActivities={vi.fn()}
                selectedActivitiesForAdd={{}}
                toggleAllActivitiesInDiscipline={vi.fn()}
                toggleActivitySelection={vi.fn()}
                editingActivityId={null}
                setEditingActivityId={vi.fn()}
                updateScopeActivity={vi.fn()}
                allUsers={[]}
                userMaster={[]}
                projectTeamMembers={[]}
                updateUserManhours={vi.fn()}
                toggleUserForActivity={vi.fn()}
                openUserSelectorForActivity={null}
                setOpenUserSelectorForActivity={vi.fn()}
                isUserAssigned={vi.fn().mockReturnValue(false)}
                removeScopeActivity={vi.fn()}
            />
        )

        expect(screen.getByText('Piping Design')).toBeInTheDocument()
        expect(screen.getByText('Design tasks')).toBeInTheDocument()
    })

    it('triggers removeScopeActivity when delete icon is clicked', async () => {
        const user = userEvent.setup()
        const removeScopeActivity = vi.fn()
        render(
            <ProjectActivityTab
                projectActivities={mockProjectActivities}
                getActivityTotalPlanned={vi.fn().mockReturnValue(20)}
                getActivityTotalActual={vi.fn().mockReturnValue(15)}
                functions={mockFunctions}
                toggleActivitySelector={vi.fn()}
                showActivitySelector={false}
                activitySelectorSearch=""
                setActivitySelectorSearch={vi.fn()}
                getSelectedCount={vi.fn().mockReturnValue(0)}
                addSelectedActivities={vi.fn()}
                selectedActivitiesForAdd={{}}
                toggleAllActivitiesInDiscipline={vi.fn()}
                toggleActivitySelection={vi.fn()}
                editingActivityId={null}
                setEditingActivityId={vi.fn()}
                updateScopeActivity={vi.fn()}
                allUsers={[]}
                userMaster={[]}
                projectTeamMembers={[]}
                updateUserManhours={vi.fn()}
                toggleUserForActivity={vi.fn()}
                openUserSelectorForActivity={null}
                setOpenUserSelectorForActivity={vi.fn()}
                isUserAssigned={vi.fn().mockReturnValue(false)}
                removeScopeActivity={removeScopeActivity}
            />
        )

        const deleteBtn = screen.getByTitle('Delete activity')
        await user.click(deleteBtn)

        expect(removeScopeActivity).toHaveBeenCalledWith(1)
    })
})
