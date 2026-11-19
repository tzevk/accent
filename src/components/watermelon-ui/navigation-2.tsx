'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { LogOut, Menu, Moon } from 'lucide-react';
import toast from 'react-hot-toast';
import {
	BanknotesIcon,
	CalendarDaysIcon,
	ChartBarIcon,
	ClipboardDocumentListIcon,
	ShieldCheckIcon,
	TicketIcon,
} from '@heroicons/react/24/outline';
import accentMark from '@/../public/accent-mark.png';
import { logout } from '@/lib/logout';
import { cn } from '@/lib/cn';
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import { Button } from '@/components/ui/button';
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion';
import NotificationsBell from '@/components/NotificationsBell';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type NavItem = {
	name: string;
	href: string;
	icon: IconComponent;
};

type AdminGroup = {
	key: string;
	name: string;
	icon: IconComponent;
	items: NavItem[];
};

type Navigation2Props = {
	navigation: NavItem[];
	reportsMenuItems: NavItem[];
	showReportsMenu: boolean;
	adminMenuGroups: AdminGroup[];
	showAdminMenu: boolean;
	mobilePageItems: NavItem[];
	showBroadAdminControls: boolean;
};

const desktopLinkClass = (active: boolean) =>
	cn(
		'rounded-xl bg-transparent px-3 py-1.5 text-sm font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
		active && 'bg-accent font-semibold text-accent-foreground'
	);

const desktopTriggerClass = (active: boolean) =>
	cn(
		'h-auto rounded-xl bg-transparent px-3 py-1.5 text-sm font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground',
		active && 'bg-accent font-semibold text-accent-foreground'
	);

const submenuLinkClass = (active: boolean) =>
	cn(
		'flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm leading-snug text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
		active && 'bg-accent font-medium text-accent-foreground'
	);

const mobileLinkClass = (active: boolean) =>
	cn(
		'flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors',
		active
			? 'bg-accent font-semibold text-accent-foreground'
			: 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
	);

const mobileSubmenuLinkClass = (active: boolean) =>
	cn(
		'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
		active
			? 'bg-accent font-medium text-accent-foreground'
			: 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
	);

const mobileAccordionTriggerClass = (active: boolean) =>
	cn(
		'my-0.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground/80 transition-colors hover:no-underline hover:text-accent-foreground',
		active && 'bg-accent font-semibold text-accent-foreground'
	);

function pathMatches(pathname: string, href: string) {
	const path = href.split('?')[0];
	return pathname === path || pathname.startsWith(`${path}/`);
}

function DarkModeButton() {
	// Dark mode is deliberately inert until the app ships a dark palette.
	return (
		<Button
			variant="ghost"
			size="icon"
			className="shrink-0 rounded-xl"
			disabled
			aria-label="Dark mode (coming soon)"
			title="Dark mode — coming soon"
		>
			<Moon className="size-5" aria-hidden="true" />
		</Button>
	);
}

export function Navigation2({
	navigation,
	reportsMenuItems,
	showReportsMenu,
	adminMenuGroups,
	showAdminMenu,
	mobilePageItems,
	showBroadAdminControls,
}: Navigation2Props) {
	const pathname = usePathname() || '';
	const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null);
	const mobileOpen = mobileOpenPath === pathname;
	const [mobileTasksOpen, setMobileTasksOpen] = useState(false);
	const reportsActive = pathname.startsWith('/reports');
	const adminActive = pathname.startsWith('/admin');

	useEffect(() => {
		try {
			if (localStorage.getItem('todoPanelOpen') === 'true')
				// localStorage is unavailable during SSR; restore after mount.
				// eslint-disable-next-line react-hooks/set-state-in-effect
				setMobileTasksOpen(true);
		} catch {}
	}, []);

	useEffect(() => {
		const desktop = window.matchMedia('(min-width: 64rem)');
		const handleDesktop = (event: MediaQueryListEvent) => {
			if (event.matches) setMobileOpenPath(null);
		};
		desktop.addEventListener('change', handleDesktop);
		return () => desktop.removeEventListener('change', handleDesktop);
	}, []);

	const closeMobile = () => setMobileOpenPath(null);

	const handleToggleTasks = () => {
		const next = !mobileTasksOpen;
		setMobileTasksOpen(next);
		try {
			localStorage.setItem('todoPanelOpen', String(next));
		} catch {}
		window.dispatchEvent(
			new CustomEvent('toggleTodoPanel', { detail: { open: next } })
		);
	};

	const handleSignOut = async () => {
		closeMobile();
		const outcome = await logout();
		if (outcome.status === 'failed') {
			toast.error(`Could not sign out: ${outcome.message}`);
		}
	};

	return (
		<header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-border bg-white print:hidden">
			<div className="flex h-full items-center justify-between gap-6 px-6 md:ps-0">
				<div className="flex min-w-0 items-center gap-6">
					<Link
						href="/dashboard"
						className="flex shrink-0 items-center gap-2 md:gap-1"
						aria-label="Accent dashboard"
					>
						<span className="flex items-center justify-center md:w-(--sidebar-width-icon)">
							<Image
								src={accentMark}
								alt=""
								width={144}
								height={128}
								className="h-8 w-auto -translate-y-1 object-contain"
								priority
							/>
						</span>
						<span className="text-lg font-bold tracking-tight text-foreground lg:hidden">
							Accent
						</span>
					</Link>

					<div className="hidden lg:block">
						<NavigationMenu
							aria-label="Primary"
							align="center"
							className="max-w-max flex-none"
							sideOffset={24}
						>
							<NavigationMenuList className="gap-1">
								{navigation.map((item) => {
									const active = pathMatches(pathname, item.href);
									return (
										<NavigationMenuItem key={item.href}>
											<NavigationMenuLink
												render={<Link href={item.href} />}
												aria-current={active ? 'page' : undefined}
												className={desktopLinkClass(active)}
											>
												{item.name}
											</NavigationMenuLink>
										</NavigationMenuItem>
									);
								})}

								{showReportsMenu && (
									<NavigationMenuItem value="reports">
										<NavigationMenuTrigger
											aria-current={reportsActive ? 'true' : undefined}
											className={desktopTriggerClass(reportsActive)}
										>
											Reports
										</NavigationMenuTrigger>
										<NavigationMenuContent className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
											<div className="max-h-[calc(100dvh-6rem)] overflow-y-auto p-3">
												<p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-primary/80">
													Reports
												</p>
												<div className="flex flex-col">
													{reportsMenuItems.map((item) => {
														const active = pathMatches(pathname, item.href);
														const Icon = item.icon;
														return (
															<NavigationMenuLink
																key={item.href}
																render={<Link href={item.href} />}
																aria-current={active ? 'page' : undefined}
																className={submenuLinkClass(active)}
															>
																<Icon
																	className="mt-0.5 size-4 shrink-0 text-primary/70"
																	aria-hidden="true"
																/>
																{item.name}
															</NavigationMenuLink>
														);
													})}
												</div>
											</div>
										</NavigationMenuContent>
									</NavigationMenuItem>
								)}

								{showAdminMenu && (
									<NavigationMenuItem value="admin">
										<NavigationMenuTrigger
											aria-current={adminActive ? 'true' : undefined}
											className={desktopTriggerClass(adminActive)}
										>
											Admin
										</NavigationMenuTrigger>
										<NavigationMenuContent className="w-[860px] max-w-[calc(100vw-2rem)] p-0">
											<div className="max-h-[calc(100dvh-6rem)] overflow-y-auto p-6">
												<p className="pb-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary/80">
													Admin
												</p>
												<div className="grid grid-cols-3 gap-x-8 gap-y-5">
													{adminMenuGroups.map((group) => {
														const GroupIcon = group.icon;
														return (
															<div key={group.key} className="min-w-0">
																<div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-primary/80">
																	<GroupIcon
																		className="size-3.5 shrink-0"
																		aria-hidden="true"
																	/>
																	<span className="truncate">{group.name}</span>
																</div>
																<div className="flex flex-col">
																	{group.items.map((item) => {
																		const active = pathMatches(
																			pathname,
																			item.href
																		);
																		const ItemIcon = item.icon;
																		return (
																			<NavigationMenuLink
																				key={`${group.key}-${item.href}`}
																				render={<Link href={item.href} />}
																				aria-current={
																					active ? 'page' : undefined
																				}
																				className={cn(
																					submenuLinkClass(active),
																					'-mx-2 px-2'
																				)}
																			>
																				<ItemIcon
																					className="mt-0.5 size-4 shrink-0 text-primary/60"
																					aria-hidden="true"
																				/>
																				{item.name}
																			</NavigationMenuLink>
																		);
																	})}
																</div>
															</div>
														);
													})}
												</div>
											</div>
										</NavigationMenuContent>
									</NavigationMenuItem>
								)}
							</NavigationMenuList>
						</NavigationMenu>
					</div>
				</div>

				<div className="flex items-center gap-1">
					<DarkModeButton />
					<NotificationsBell />

					<Sheet
						open={mobileOpen}
						onOpenChange={(open) => setMobileOpenPath(open ? pathname : null)}
					>
						<SheetTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									className="shrink-0 rounded-xl lg:hidden"
								/>
							}
						>
							<Menu className="size-5" aria-hidden="true" />
							<span className="sr-only">Open navigation menu</span>
						</SheetTrigger>

						<SheetContent
							side="right"
							className="flex flex-col gap-6 overflow-y-auto border-border bg-white p-6 text-foreground data-[side=right]:w-[min(340px,85vw)] sm:data-[side=right]:w-[380px]"
						>
							<SheetTitle className="sr-only">Primary navigation</SheetTitle>

							<div className="flex items-center gap-2 pr-10">
								<Link
									href="/dashboard"
									onClick={closeMobile}
									className="flex items-center gap-2"
									aria-label="Accent dashboard"
								>
									<Image
										src={accentMark}
										alt=""
										width={144}
										height={128}
										className="h-9 w-auto object-contain"
									/>
									<span className="text-lg font-bold tracking-tight text-foreground">
										Accent
									</span>
								</Link>
							</div>

							<nav aria-label="Primary" className="flex flex-col gap-0.5">
								{navigation.map((item) => {
									const active = pathMatches(pathname, item.href);
									const Icon = item.icon;
									return (
										<Link
											key={item.href}
											href={item.href}
											onClick={closeMobile}
											aria-current={active ? 'page' : undefined}
											className={mobileLinkClass(active)}
										>
											<Icon
												className="size-5 shrink-0 text-primary/70"
												aria-hidden="true"
											/>
											{item.name}
										</Link>
									);
								})}
							</nav>

							{showReportsMenu && (
								<Accordion
									className="w-full"
									defaultValue={reportsActive ? ['reports'] : []}
								>
									<AccordionItem value="reports" className="border-none">
										<AccordionTrigger
											aria-current={reportsActive ? 'true' : undefined}
											className={mobileAccordionTriggerClass(reportsActive)}
										>
											<span className="flex items-center gap-3">
												<ChartBarIcon
													className="size-5 shrink-0 text-primary/70"
													aria-hidden="true"
												/>
												Reports
											</span>
										</AccordionTrigger>
										<AccordionContent className="[&_a]:no-underline">
											<div className="flex flex-col gap-0.5">
												{reportsMenuItems.map((item) => {
													const active = pathMatches(pathname, item.href);
													const Icon = item.icon;
													return (
														<Link
															key={item.href}
															href={item.href}
															onClick={closeMobile}
															aria-current={active ? 'page' : undefined}
															className={mobileSubmenuLinkClass(active)}
														>
															<Icon
																className="size-4 shrink-0 text-primary/70"
																aria-hidden="true"
															/>
															{item.name}
														</Link>
													);
												})}
											</div>
										</AccordionContent>
									</AccordionItem>
								</Accordion>
							)}

							{showAdminMenu && (
								<Accordion
									className="w-full"
									defaultValue={adminActive ? ['admin'] : []}
								>
									<AccordionItem value="admin" className="border-none">
										<AccordionTrigger
											aria-current={adminActive ? 'true' : undefined}
											className={mobileAccordionTriggerClass(adminActive)}
										>
											<span className="flex items-center gap-3">
												<ShieldCheckIcon
													className="size-5 shrink-0 text-primary/70"
													aria-hidden="true"
												/>
												Admin
											</span>
										</AccordionTrigger>
										<AccordionContent className="[&_a]:no-underline">
											{adminMenuGroups.map((group) => {
												const GroupIcon = group.icon;
												return (
													<div key={group.key} className="mt-3 first:mt-0">
														<p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-primary/80">
															<GroupIcon
																className="size-3.5 shrink-0"
																aria-hidden="true"
															/>
															{group.name}
														</p>
														<div className="flex flex-col gap-0.5">
															{group.items.map((item) => {
																const active = pathMatches(pathname, item.href);
																const ItemIcon = item.icon;
																return (
																	<Link
																		key={`${group.key}-${item.href}`}
																		href={item.href}
																		onClick={closeMobile}
																		aria-current={active ? 'page' : undefined}
																		className={mobileSubmenuLinkClass(active)}
																	>
																		<ItemIcon
																			className="size-4 shrink-0 text-primary/60"
																			aria-hidden="true"
																		/>
																		{item.name}
																	</Link>
																);
															})}
														</div>
													</div>
												);
											})}
										</AccordionContent>
									</AccordionItem>
								</Accordion>
							)}

							<div className="flex flex-col gap-0.5">
								<p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.08em] text-primary/80">
									Pages
								</p>
								{mobilePageItems.map((item) => {
									const active = pathMatches(pathname, item.href);
									const Icon = item.icon;
									return (
										<Link
											key={item.href}
											href={item.href}
											onClick={closeMobile}
											aria-current={active ? 'page' : undefined}
											className={mobileLinkClass(active)}
										>
											<Icon
												className="size-5 shrink-0 text-primary/70"
												aria-hidden="true"
											/>
											{item.name}
										</Link>
									);
								})}
								<button
									type="button"
									onClick={() => {
										handleToggleTasks();
										closeMobile();
									}}
									className={cn(
										mobileLinkClass(mobileTasksOpen),
										'w-full text-left'
									)}
								>
									<ClipboardDocumentListIcon
										className="size-5 shrink-0 text-primary/70"
										aria-hidden="true"
									/>
									Tasks
								</button>
								{showBroadAdminControls && (
									<>
										<Link
											href="/masters/holidays"
											onClick={closeMobile}
											aria-current={
												pathname.startsWith('/masters/holidays')
													? 'page'
													: undefined
											}
											className={mobileLinkClass(
												pathname.startsWith('/masters/holidays')
											)}
										>
											<CalendarDaysIcon
												className="size-5 shrink-0 text-primary/70"
												aria-hidden="true"
											/>
											Holiday Master
										</Link>
										<Link
											href="/masters/accounts/account-heads"
											onClick={closeMobile}
											aria-current={
												pathname.startsWith('/masters/accounts')
													? 'page'
													: undefined
											}
											className={mobileLinkClass(
												pathname.startsWith('/masters/accounts')
											)}
										>
											<BanknotesIcon
												className="size-5 shrink-0 text-primary/70"
												aria-hidden="true"
											/>
											Account Head Master
										</Link>
										<Link
											href="/admin/tickets"
											onClick={closeMobile}
											aria-current={
												pathname === '/admin/tickets' ? 'page' : undefined
											}
											className={mobileLinkClass(pathname === '/admin/tickets')}
										>
											<TicketIcon
												className="size-5 shrink-0 text-primary/70"
												aria-hidden="true"
											/>
											Manage Tickets
										</Link>
									</>
								)}
							</div>

							<div className="mt-auto flex flex-col gap-1 border-t border-border pt-4">
								<button
									type="button"
									onClick={handleSignOut}
									className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
								>
									<LogOut className="size-5 shrink-0" aria-hidden="true" />
									Sign Out
								</button>
							</div>
						</SheetContent>
					</Sheet>
				</div>
			</div>
		</header>
	);
}
