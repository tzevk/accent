'use client';

import React from 'react';
import Navbar from '@/components/Navbar';

export default function NewLeadPage() {
	return (
		<div className="h-screen bg-gray-50">
			<Navbar />
			<div className="p-8">
				<h1 className="text-xl font-semibold">New Lead</h1>
				<p className="text-sm text-gray-600">Placeholder page — implement form as needed.</p>
			</div>
		</div>
	);
}
