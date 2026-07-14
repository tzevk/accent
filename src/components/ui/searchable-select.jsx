'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export default function SearchableSelect({
	options = [],
	value = '',
	onChange,
	placeholder = 'Select...',
	className = '',
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
				onClick={() => setIsOpen(!isOpen)}
				className="w-full px-1 py-1 bg-transparent text-sm text-left flex items-center justify-between gap-1 cursor-default"
			>
				<span
					className={
						value ? 'text-gray-900 truncate' : 'text-gray-400 truncate'
					}
				>
					{selectedLabel || placeholder}
				</span>
				<svg
					className={`h-3 w-3 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
						className="bg-white border border-gray-300 rounded-md shadow-lg max-h-60 flex flex-col overflow-hidden"
					>
						<div className="p-1.5 border-b border-gray-200">
							<input
								ref={inputRef}
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search..."
								className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
							/>
						</div>
						<div className="overflow-y-auto flex-1">
							{filteredOptions.length === 0 ? (
								<div className="px-3 py-2 text-sm text-gray-500">
									No results
								</div>
							) : (
								filteredOptions.map((opt) => (
									<button
										key={opt.id ?? opt.value}
										type="button"
										onClick={() => handleSelect(opt.value)}
										className={`w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 transition-colors ${
											opt.value === value
												? 'bg-purple-100 text-purple-700 font-medium'
												: 'text-gray-900'
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
