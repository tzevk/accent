import Image from 'next/image';

interface EmployeeAvatarProps {
	src?: string;
	firstName?: string;
	lastName?: string;
	size?: number;
}

export default function EmployeeAvatar({
	src,
	firstName,
	lastName,
	size = 40,
}: EmployeeAvatarProps) {
	const initials =
		`${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
	if (src) {
		return (
			<div className="relative shrink-0" style={{ width: size, height: size }}>
				<Image
					src={src}
					alt={
						`${firstName || ''} ${lastName || ''}`.trim() || 'Employee photo'
					}
					fill
					className="rounded-full object-cover"
					unoptimized
				/>
			</div>
		);
	}
	return (
		<div
			aria-hidden="true"
			className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-purple-600 font-medium text-white"
			style={{ width: size, height: size, fontSize: size * 0.4 }}
		>
			{initials}
		</div>
	);
}
