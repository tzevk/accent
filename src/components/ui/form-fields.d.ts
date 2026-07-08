import type {
	InputHTMLAttributes,
	TextareaHTMLAttributes,
	SelectHTMLAttributes,
	HTMLProps,
	ForwardRefExoticComponent,
	RefAttributes,
	ReactNode,
} from 'react';

export declare const Input: ForwardRefExoticComponent<
	InputHTMLAttributes<HTMLInputElement> & RefAttributes<HTMLInputElement>
>;

export declare const Textarea: ForwardRefExoticComponent<
	TextareaHTMLAttributes<HTMLTextAreaElement> &
		RefAttributes<HTMLTextAreaElement>
>;

export declare const Select: ForwardRefExoticComponent<
	SelectHTMLAttributes<HTMLSelectElement> & RefAttributes<HTMLSelectElement>
>;

interface FieldGroupProps {
	label?: string;
	hint?: string;
	error?: string;
	required?: boolean;
	children?: ReactNode;
	className?: string;
}

export declare const FieldGroup: React.FC<FieldGroupProps>;

export declare const Label: ForwardRefExoticComponent<
	HTMLProps<HTMLLabelElement> & RefAttributes<HTMLLabelElement>
>;

export declare const FieldHint: ForwardRefExoticComponent<
	HTMLProps<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>
>;
