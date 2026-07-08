interface PaginationProps {
	page: number;
	totalPages: number;
	total: number;
	onPageChange: (page: number) => void;
}

declare const Pagination: React.FC<PaginationProps>;
export default Pagination;
