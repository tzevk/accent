import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import QueryLogTab from '@/app/projects/[id]/edit/tabs/QueryLogTab'

describe('QueryLogTab', () => {
    const mockNewQuery = {
        query_description: 'Clarify piping route',
        query_issued_date: '2026-05-25',
        reply_from_client: 'Route approved',
        reply_received_date: '2026-05-26',
        query_updated_by: 'Alice',
        query_resolved: 'Yes',
        remark: 'No issues'
    }

    const mockQueryLog = [
        {
            id: 1,
            query_description: 'Clarify cabling layout',
            query_issued_date: '2026-05-24',
            reply_from_client: 'Pending info',
            reply_received_date: '',
            query_updated_by: 'Bob',
            query_resolved: 'Pending',
            remark: 'Awaiting client response'
        }
    ]

    it('renders query log correctly', () => {
        const ref = createRef<HTMLInputElement>()
        render(
            <QueryLogTab
                newQueryDescRef={ref}
                newQuery={mockNewQuery}
                setNewQuery={vi.fn()}
                addQueryRow={vi.fn()}
                queryLog={mockQueryLog}
                updateQueryRow={vi.fn()}
                removeQueryRow={vi.fn()}
            />
        )

        expect(screen.getByDisplayValue('Clarify piping route')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Clarify cabling layout')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Route approved')).toBeInTheDocument()
    })

    it('calls addQueryRow when Add is clicked', async () => {
        const user = userEvent.setup()
        const addQueryRow = vi.fn()
        const ref = createRef<HTMLInputElement>()

        render(
            <QueryLogTab
                newQueryDescRef={ref}
                newQuery={mockNewQuery}
                setNewQuery={vi.fn()}
                addQueryRow={addQueryRow}
                queryLog={[]}
                updateQueryRow={vi.fn()}
                removeQueryRow={vi.fn()}
            />
        )

        const addButton = screen.getByRole('button', { name: /Add/i })
        await user.click(addButton)

        expect(addQueryRow).toHaveBeenCalled()
    })

    it('calls removeQueryRow when remove button is clicked', async () => {
        const user = userEvent.setup()
        const removeQueryRow = vi.fn()
        const ref = createRef<HTMLInputElement>()

        render(
            <QueryLogTab
                newQueryDescRef={ref}
                newQuery={mockNewQuery}
                setNewQuery={vi.fn()}
                addQueryRow={vi.fn()}
                queryLog={mockQueryLog}
                updateQueryRow={vi.fn()}
                removeQueryRow={removeQueryRow}
            />
        )

        const removeButton = screen.getByTitle('Remove query')
        await user.click(removeButton)

        expect(removeQueryRow).toHaveBeenCalledWith(1)
    })
})
