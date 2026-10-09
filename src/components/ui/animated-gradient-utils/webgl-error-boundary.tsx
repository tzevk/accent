'use client';

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface WebGLErrorBoundaryProps {
	children: ReactNode;
	fallback: ReactNode;
}

interface WebGLErrorBoundaryState {
	hasError: boolean;
}

export class WebGLErrorBoundary extends Component<
	WebGLErrorBoundaryProps,
	WebGLErrorBoundaryState
> {
	state: WebGLErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): WebGLErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error('AnimatedGradient: WebGL render failed', error, errorInfo);
	}

	render() {
		return this.state.hasError ? this.props.fallback : this.props.children;
	}
}

export function WebGLFallback({ className }: { className?: string }) {
	return (
		<div
			aria-hidden="true"
			className={cn('absolute inset-0 overflow-hidden', className)}
			style={{
				background:
					'linear-gradient(135deg, #5F146D 0%, #7A2B91 50%, #5F146D 100%)',
			}}
		/>
	);
}
