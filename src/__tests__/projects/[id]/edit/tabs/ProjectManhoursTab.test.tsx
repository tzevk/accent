import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ProjectManhoursTab from '@/app/projects/[id]/edit/tabs/ProjectManhoursTab'

describe('ProjectManhoursTab', () => {
    const mockProjectManhours = [
        {
            id: 1,
            employee_id: 101,
            employee_name: 'John Doe',
            salary_type: 'monthly',
            rate_company: 500,
            rate_accent: 600,
            monthly_hours: { jan: 10, feb: 20 },
        }
    ]

    const mockEmployees = [
        { id: 101, name: 'John Doe', salary_type: 'monthly', rate: 500 }
    ]

    it('renders project manhours correctly', () => {
        render(
            <ProjectManhoursTab
                projectManhours={mockProjectManhours}
                setProjectManhours={vi.fn()}
                employeesLoading={false}
                employeesWithRates={mockEmployees}
                fetchAttendanceHours={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument()
        expect(screen.getByDisplayValue('500')).toBeInTheDocument()
        expect(screen.getByDisplayValue('600')).toBeInTheDocument()
        expect(screen.getByDisplayValue('10')).toBeInTheDocument()
        expect(screen.getByDisplayValue('20')).toBeInTheDocument()
    })

    it('calls setProjectManhours when Add Row button is clicked', async () => {
        const user = userEvent.setup()
        const setProjectManhours = vi.fn()

        render(
            <ProjectManhoursTab
                projectManhours={[]}
                setProjectManhours={setProjectManhours}
                employeesLoading={false}
                employeesWithRates={mockEmployees}
                fetchAttendanceHours={vi.fn()}
            />
        )

        const addButton = screen.getByRole('button', { name: /Add Row/i })
        await user.click(addButton)

        expect(setProjectManhours).toHaveBeenCalled()
    })

    it('calls setProjectManhours when rate company is changed', async () => {
        const user = userEvent.setup()
        const setProjectManhours = vi.fn()

        render(
            <ProjectManhoursTab
                projectManhours={mockProjectManhours}
                setProjectManhours={setProjectManhours}
                employeesLoading={false}
                employeesWithRates={mockEmployees}
                fetchAttendanceHours={vi.fn()}
            />
        )

        const companyRateInput = screen.getByDisplayValue('500')
        await user.clear(companyRateInput)
        await user.type(companyRateInput, '550')

        expect(setProjectManhours).toHaveBeenCalled()
    })

    it('calls setProjectManhours when Remove employee button is clicked', async () => {
        const user = userEvent.setup()
        const setProjectManhours = vi.fn()

        render(
            <ProjectManhoursTab
                projectManhours={mockProjectManhours}
                setProjectManhours={setProjectManhours}
                employeesLoading={false}
                employeesWithRates={mockEmployees}
                fetchAttendanceHours={vi.fn()}
            />
        )

        const removeButton = screen.getByTitle('Remove employee')
        await user.click(removeButton)

        expect(setProjectManhours).toHaveBeenCalled()
    })
})
