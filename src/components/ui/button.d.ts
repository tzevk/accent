import type {
	ButtonHTMLAttributes,
	ForwardRefExoticComponent,
	RefAttributes,
} from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'default' | 'outline' | 'ghost' | 'destructive';
	size?: 'default' | 'sm' | 'lg' | 'icon';
	loading?: boolean;
}

export declare const Button: ForwardRefExoticComponent<
	ButtonProps & RefAttributes<HTMLButtonElement>
>;
