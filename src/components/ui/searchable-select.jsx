'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * @param {Object} props
 * @param {Array<{value: string|number, label: string, id?: string|number}>} props.options
 * @param {string|number} props.value
 * @param {(val: string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {string} [props.className]
 * @param {string} [props.buttonClassName]
 * @param {boolean} [props.disabled]
 * @param {string} [props.aria-label]
 */
export default function SearchableSelect({
	options = [],
	value = '',
	onChange,
	placeholder = 'Select...',
	className = '',
	buttonClassName = '',
	disabled = false,
	'aria-label': ariaLabel,
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState('');
	const triggerRef = useRef(null);
	const dropdownRef = useRef(null);
	const inputRef = useRef(null);

	const filteredOptions = search
		? options.filter((o) =>
				o.label.toLowerCase().includes(search.toLowerCase())
			)
		: options;

	const selectedLabel = options.find((o) => o.value === value)?.label;

	const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

	const updateCoords = useCallback(() => {
		if (!triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		setCoords({ top: rect.bottom + 2, left: rect.left, width: rect.width });
	}, []);

	useEffect(() => {
		if (!isOpen) return;
		updateCoords();
		const onScroll = () => updateCoords();
		const onResize = () => updateCoords();
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onResize);
		};
	}, [isOpen, updateCoords]);

	useEffect(() => {
		if (!isOpen) return;
		const handleClick = (e) => {
			if (
				triggerRef.current?.contains(e.target) ||
				dropdownRef.current?.contains(e.target)
			)
				return;
			setIsOpen(false);
		};
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [isOpen]);

	useEffect(() => {
		if (isOpen) {
			const t = setTimeout(() => inputRef.current?.focus(), 50);
			return () => clearTimeout(t);
		}
		setSearch('');
	}, [isOpen]);

	const handleSelect = useCallback(
		(val) => {
			onChange(val);
			setIsOpen(false);
		},
		[onChange]
	);

	return (
		<div ref={triggerRef} className={`relative ${className}`}>
			<button
				type="button"
				aria-label={ariaLabel}
				disabled={disabled}
				onClick={() => setIsOpen(!isOpen)}
				className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors text-left flex items-center justify-between gap-1 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-ring/50'} ${buttonClassName || ''}`}
			>
				<span
					className={
						value
							? 'text-foreground truncate'
							: 'text-muted-foreground truncate'
					}
				>
					{selectedLabel || placeholder}
				</span>
				<svg
					className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>

			{isOpen &&
				createPortal(
					<div
						ref={dropdownRef}
						style={{
							position: 'fixed',
							top: coords.top,
							left: coords.left,
							width: coords.width,
							zIndex: 9999,
						}}
						className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg max-h-60 flex flex-col overflow-hidden"
					>
						<div className="p-1.5 border-b border-border">
							<input
								ref={inputRef}
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search..."
								className="w-full px-2 py-1.5 text-sm border border-input rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
							/>
						</div>
						<div className="overflow-y-auto flex-1">
							{filteredOptions.length === 0 ? (
								<div className="px-3 py-2 text-sm text-muted-foreground">
									No results
								</div>
							) : (
								filteredOptions.map((opt) => (
									<button
										key={opt.id ?? opt.value}
										type="button"
										onClick={() => handleSelect(opt.value)}
										className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${
											opt.value === value
												? 'bg-accent text-accent-foreground font-medium'
												: 'text-foreground'
										}`}
									>
										{opt.label}
									</button>
								))
							)}
						</div>
					</div>,
					document.body
				)}
		</div>
	);
}
