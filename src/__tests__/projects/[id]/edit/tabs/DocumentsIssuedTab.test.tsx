import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DocumentsIssuedTab from '@/app/projects/[id]/edit/tabs/DocumentsIssuedTab'

describe('DocumentsIssuedTab', () => {
    const mockNewDoc = {
        document_name: '',
        issued_for: '',
        document_number: '',
        revision_number: '',
        issue_date: '',
        remarks: '',
    }

    const mockDocsIssued = [
        {
            id: 1,
            document_name: 'Drawing Issued A',
            issued_for: 'Construction',
            document_number: 'DRW-ISS-001',
            revision_number: '1',
            issue_date: '2026-05-25',
            remarks: 'Issued'
        }
    ]

    it('renders issued documents and inputs correctly', () => {
        render(
            <DocumentsIssuedTab
                newIssuedDoc={mockNewDoc}
                setNewIssuedDoc={vi.fn()}
                canEditProjectContent={true}
                projectActivityDocumentNameOptions={['Drawing Issued A']}
                addIssuedDocument={vi.fn()}
                documentsIssued={mockDocsIssued}
                updateIssuedDocument={vi.fn()}
                removeIssuedDocument={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('Drawing Issued A')).toBeInTheDocument()
        expect(screen.getByDisplayValue('DRW-ISS-001')).toBeInTheDocument()
    })

    it('calls removeIssuedDocument when delete button is clicked', async () => {
        const user = userEvent.setup()
        const removeIssuedDocument = vi.fn()
        render(
            <DocumentsIssuedTab
                newIssuedDoc={mockNewDoc}
                setNewIssuedDoc={vi.fn()}
                canEditProjectContent={true}
                projectActivityDocumentNameOptions={[]}
                addIssuedDocument={vi.fn()}
                documentsIssued={mockDocsIssued}
                updateIssuedDocument={vi.fn()}
                removeIssuedDocument={removeIssuedDocument}
            />
        )

        const deleteBtn = screen.getByTitle('Remove document')
        await user.click(deleteBtn)

        expect(removeIssuedDocument).toHaveBeenCalledWith(1)
    })
})
