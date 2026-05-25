import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import QuotationTab from '@/app/projects/[id]/edit/tabs/QuotationTab'

describe('QuotationTab', () => {
    const mockForm = {
        proposal_id: 'PROP-999'
    }

    const mockQuotationData = {
        quotation_number: 'Q-001',
        quotation_date: '2026-05-25',
        client_name: 'Google Inc',
        enquiry_number: 'ENQ-001',
        gross_amount: 10000,
        gst_percentage: 18,
        gst_amount: 1800,
        net_amount: 11800,
        amount_in_words: 'Eleven Thousand Eight Hundred Only',
        scope_of_work: 'Design services',
        scope_items: [
            {
                sr_no: 1,
                description: 'Cabling layout design',
                qty: 1,
                rate: 10000,
                amount: 10000
            }
        ]
    }

    it('renders empty message when proposal_id is missing', () => {
        render(
            <QuotationTab
                form={{}}
                canEditQuotations={true}
                quotationData={{}}
            />
        )

        expect(screen.getByText(/No proposal linked to this project/i)).toBeInTheDocument()
    })

    it('renders quotation details correctly when proposal_id exists', () => {
        render(
            <QuotationTab
                form={mockForm}
                canEditQuotations={true}
                quotationData={mockQuotationData}
            />
        )

        expect(screen.getByText('Q-001')).toBeInTheDocument()
        expect(screen.getByText('Google Inc')).toBeInTheDocument()
        expect(screen.getByText('Cabling layout design')).toBeInTheDocument()
        expect(screen.getAllByText((content) => content.includes('11,800')).length).toBeGreaterThan(0)
    })

    it('opens quotation edit page when Edit & Download Quotation is clicked', async () => {
        const user = userEvent.setup()
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

        render(
            <QuotationTab
                form={mockForm}
                canEditQuotations={true}
                quotationData={mockQuotationData}
            />
        )

        const editBtn = screen.getByRole('button', { name: /Edit & Download Quotation/i })
        await user.click(editBtn)

        expect(windowOpenSpy).toHaveBeenCalledWith(
            '/admin/quotation/PROP-999/edit?source=proposal',
            '_blank'
        )

        windowOpenSpy.mockRestore()
    })
})
