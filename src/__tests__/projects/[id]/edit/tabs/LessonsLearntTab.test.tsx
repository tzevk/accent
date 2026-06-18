import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import LessonsLearntTab from '@/app/projects/[id]/edit/tabs/LessonsLearntTab';

describe('LessonsLearntTab', () => {
	const mockNewLesson = {
		what_was_new: '',
		difficulty_faced: '',
		what_you_learn: '',
		areas_of_improvement: '',
		remark: '',
	};

	const mockLessons = [
		{
			id: 1,
			what_was_new: 'Mock lesson',
			difficulty_faced: 'Diff info',
			what_you_learn: 'Learned info',
			areas_of_improvement: 'Scoping info',
			remark: 'Ok',
		},
	];

	it('renders lessons list and new lesson row correctly', () => {
		render(
			<LessonsLearntTab
				newLesson={mockNewLesson}
				setNewLesson={vi.fn()}
				addLessonRow={vi.fn()}
				lessonsLearnt={mockLessons}
				updateLessonRow={vi.fn()}
				removeLessonRow={vi.fn()}
			/>
		);

		expect(screen.getByDisplayValue('Mock lesson')).toBeInTheDocument();
		expect(screen.getByDisplayValue('Diff info')).toBeInTheDocument();
	});

	it('calls removeLessonRow when delete button is clicked', async () => {
		const user = userEvent.setup();
		const removeLessonRow = vi.fn();
		render(
			<LessonsLearntTab
				newLesson={mockNewLesson}
				setNewLesson={vi.fn()}
				addLessonRow={vi.fn()}
				lessonsLearnt={mockLessons}
				updateLessonRow={vi.fn()}
				removeLessonRow={removeLessonRow}
			/>
		);

		const deleteBtn = screen.getByTitle('Remove lesson');
		await user.click(deleteBtn);

		expect(removeLessonRow).toHaveBeenCalledWith(1);
	});
});
