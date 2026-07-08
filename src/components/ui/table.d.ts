import type {
	HTMLAttributes,
	ForwardRefExoticComponent,
	RefAttributes,
	ReactNode,
} from 'react';

export declare const Table: ForwardRefExoticComponent<
	HTMLAttributes<HTMLTableElement> & RefAttributes<HTMLTableElement>
>;
export declare const TableHeader: ForwardRefExoticComponent<
	HTMLAttributes<HTMLTableSectionElement> &
		RefAttributes<HTMLTableSectionElement>
>;
export declare const TableBody: ForwardRefExoticComponent<
	HTMLAttributes<HTMLTableSectionElement> &
		RefAttributes<HTMLTableSectionElement>
>;
export declare const TableRow: ForwardRefExoticComponent<
	HTMLAttributes<HTMLTableRowElement> & RefAttributes<HTMLTableRowElement>
>;
export declare const TableHead: ForwardRefExoticComponent<
	HTMLAttributes<HTMLTableCellElement> & RefAttributes<HTMLTableCellElement>
>;
export declare const TableCell: ForwardRefExoticComponent<
	HTMLAttributes<HTMLTableCellElement> & RefAttributes<HTMLTableCellElement>
>;
export declare const TableEmpty: React.FC<{
	children?: ReactNode;
	colSpan?: number;
}>;
