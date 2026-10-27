import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { CostHelp, CostLabel } from './cost-help';
import { TooltipProvider } from '@/components/ui/tooltip';

it('opens cost explanations from the keyboard and restores focus when dismissed', async () => {
	const user = userEvent.setup();
	render(<CostHelp />);
	const trigger = screen.getByRole('button', {
		name: 'How costs are calculated',
	});
	await user.tab();
	expect(trigger).toHaveFocus();
	await user.keyboard('{Enter}');
	const explanation = await screen.findByRole('dialog', {
		name: 'How costs are calculated',
	});
	expect(explanation).toHaveAccessibleDescription(
		/confirmed costs.*salary estimates/i
	);
	expect(
		within(explanation).getByRole('button', { name: 'Close cost explanation' })
	).toHaveFocus();
	await user.tab();
	expect(
		within(explanation).getByRole('region', { name: 'Cost definitions' })
	).toHaveFocus();
	await user.keyboard('{Escape}');
	await waitFor(() =>
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	);
	expect(trigger).toHaveFocus();
});

it('describes a cost term on keyboard focus and dismisses it without moving focus', async () => {
	const user = userEvent.setup();
	render(
		<TooltipProvider delayDuration={0}>
			<CostLabel term="monthly" />
		</TooltipProvider>
	);
	const trigger = screen.getByRole('button', {
		name: 'About monthly expenditure',
	});
	await user.tab();
	const definition = await screen.findByRole('tooltip');
	expect(trigger).toHaveAttribute('aria-describedby', definition.id);
	await user.keyboard('{Escape}');
	await waitFor(() =>
		expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
	);
	expect(trigger).toHaveFocus();
});
