import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import RiskTab from '@/app/projects/[id]/edit/tabs/RiskTab'

describe('RiskTab', () => {
    const mockForm = {
        major_risks: 'High temperature environment',
        mitigation_plans: 'Use insulated pipes',
        change_orders: 'CO-001 approved',
        claims_disputes: 'None'
    }

    it('renders risk details correctly', () => {
        render(
            <RiskTab
                form={mockForm}
                handleChange={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('High temperature environment')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Use insulated pipes')).toBeInTheDocument()
        expect(screen.getByDisplayValue('CO-001 approved')).toBeInTheDocument()
        expect(screen.getByDisplayValue('None')).toBeInTheDocument()
    })

    it('calls handleChange when fields change', async () => {
        const user = userEvent.setup()
        const handleChange = vi.fn()

        render(
            <RiskTab
                form={mockForm}
                handleChange={handleChange}
            />
        )

        const input = screen.getByDisplayValue('High temperature environment')
        await user.type(input, ' - updated')

        expect(handleChange).toHaveBeenCalled()
    })
})
