'use client';

import { useSyncExternalStore, type MouseEvent } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getDarkTheme, subscribeTheme, toggleTheme } from '@/lib/theme';
import { cn } from '@/lib/cn';

type ThemeToggleProps = {
	className?: string;
};

/**
 * Light/dark switch for the app shell and sign-in. The circular reveal is
 * driven only by pointer activation: keyboard and assistive-technology clicks
 * arrive with `detail === 0` and swap themes without motion.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
	const dark = useSyncExternalStore(subscribeTheme, getDarkTheme, () => false);
	const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		if (event.detail > 0) {
			toggleTheme({ x: event.clientX, y: event.clientY });
			return;
		}
		toggleTheme();
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			aria-label={label}
			title={label}
			className={cn(
				'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-transparent text-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2',
				className
			)}
		>
			{dark ? (
				<Sun className="size-5" aria-hidden="true" />
			) : (
				<Moon className="size-5" aria-hidden="true" />
			)}
		</button>
	);
}
