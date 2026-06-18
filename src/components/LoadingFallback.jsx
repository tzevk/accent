'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';

export default function LoadingFallback() {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setElapsed((prev) => prev + 1);
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	const formatTime = (seconds) => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
	};

	return (
		<div className="h-screen bg-gradient-to-br from-gray-50 to-white flex flex-col">
			<Navbar />
			<div className="flex-1 flex items-center justify-center">
				<div className="text-center">
					{/* Animated spinner */}
					<div className="relative inline-flex mb-6">
						<div className="w-16 h-16 rounded-full border-4 border-gray-200"></div>
						<div className="absolute top-0 left-0 w-16 h-16 rounded-full border-4 border-transparent border-t-violet-500 border-r-violet-500 animate-spin"></div>
						<div className="absolute inset-0 flex items-center justify-center">
							<svg
								className="w-6 h-6 text-violet-500"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
						</div>
					</div>

					{/* Loading text */}
					<div className="space-y-2">
						<p className="text-base font-medium text-gray-700">
							Loading Project
						</p>
						<p className="text-sm text-gray-400">
							Fetching project data<span className="loading-dots">...</span>
						</p>
						<p className="text-xs text-gray-400 mt-3 font-mono bg-gray-100 px-3 py-1 rounded-full inline-block">
							⏱️ {formatTime(elapsed)}
						</p>
					</div>
				</div>
			</div>

			{/* Loading animation styles */}
			<style jsx>{`
				@keyframes spin {
					to {
						transform: rotate(360deg);
					}
				}
				.animate-spin {
					animation: spin 1s linear infinite;
				}
				.loading-dots::after {
					content: '';
					animation: dots 1.5s steps(4, end) infinite;
				}
				@keyframes dots {
					0%,
					20% {
						content: '';
					}
					40% {
						content: '.';
					}
					60% {
						content: '..';
					}
					80%,
					100% {
						content: '...';
					}
				}
			`}</style>
		</div>
	);
}
