import type { ComponentType } from 'react';

interface StatsCardProps {
	label: string;
	value: string | number;
	tone: 'purple' | 'amber' | 'sky' | 'rose' | 'green' | 'slate' | 'violet';
	icon?: ComponentType<{ className?: string }>;
	hint?: string;
}

declare const StatsCard: React.FC<StatsCardProps>;
export default StatsCard;
