import type { ReactNode } from 'react';

interface ModalProps {
	open: boolean;
	onClose: () => void;
	title?: string;
	size?: 'sm' | 'md' | 'lg' | 'xl';
	dismissible?: boolean;
	footer?: ReactNode;
	children?: ReactNode;
}

declare const Modal: React.FC<ModalProps>;
export default Modal;
