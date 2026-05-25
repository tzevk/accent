import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ConstructionTab from '@/app/projects/[id]/edit/tabs/ConstructionTab'

const baseForm = {
    mobilization_date: '',
    site_readiness: '',
    construction_progress: '',
}

describe('ConstructionTab', () => {
    it('renders all form controls with correct initial values', () => {
        const form = {
            mobilization_date: '2026-05-25',
            site_readiness: 'Ready',
            construction_progress: 'Initial progress info',
        }
        const { container } = render(<ConstructionTab form={form} handleChange={vi.fn()} />)

        // Mobilization Date
        const dateInput = container.querySelector('input[name="mobilization_date"]')
        expect(dateInput).toBeInTheDocument()
        expect(dateInput).toHaveValue('2026-05-25')

        // Site Readiness
        const select = container.querySelector('select[name="site_readiness"]')
        expect(select).toBeInTheDocument()
        expect(select).toHaveValue('Ready')

        // Construction Progress
        const textarea = container.querySelector('textarea[name="construction_progress"]')
        expect(textarea).toBeInTheDocument()
        expect(textarea).toHaveValue('Initial progress info')
    })

    it('calls handleChange when mobilization date changes', async () => {
        const handleChange = vi.fn()
        const { container } = render(<ConstructionTab form={baseForm} handleChange={handleChange} />)

        const dateInput = container.querySelector('input[name="mobilization_date"]')!
        fireEvent.change(dateInput, { target: { value: '2026-06-01' } })

        expect(handleChange).toHaveBeenCalled()
    })

    it('calls handleChange when site readiness select changes', async () => {
        const user = userEvent.setup()
        const handleChange = vi.fn()
        const { container } = render(<ConstructionTab form={baseForm} handleChange={handleChange} />)

        const select = container.querySelector('select[name="site_readiness"]')!
        await user.selectOptions(select, 'Not Ready')

        expect(handleChange).toHaveBeenCalled()
    })

    it('calls handleChange when construction progress changes', async () => {
        const user = userEvent.setup()
        const handleChange = vi.fn()
        const { container } = render(<ConstructionTab form={baseForm} handleChange={handleChange} />)

        const textarea = container.querySelector('textarea[name="construction_progress"]')!
        await user.type(textarea, 'Some progress updates')

        expect(handleChange).toHaveBeenCalled()
    })
})
