import {
  BarChart3,
  BellRing,
  Boxes,
  Calculator,
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  Settings as SettingsIcon,
  ShieldCheck,
  TrendingUp,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureId, Permissions } from '../../shared/features';

export interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  /** Server-enforced feature permission; null means always visible. */
  feature: FeatureId | null;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    shortLabel: 'Overview',
    icon: LayoutDashboard,
    description: 'What needs attention today',
    feature: 'dashboard' as FeatureId,
  },
  {
    to: '/inventory',
    label: 'Inventory',
    shortLabel: 'Inventory',
    icon: Boxes,
    description: 'Products, stock and expiry dates',
    feature: 'inventory' as FeatureId,
  },
  {
    to: '/suppliers',
    label: 'Suppliers',
    shortLabel: 'Suppliers',
    icon: Truck,
    description: 'Contacts, lead times and product links',
    feature: 'suppliers' as FeatureId,
  },
  {
    to: '/demand',
    label: 'Demand Analytics',
    shortLabel: 'Demand',
    icon: TrendingUp,
    description: 'Best sellers, slow movers and stock cover',
    feature: 'demand_analytics' as FeatureId,
  },
  {
    to: '/actions',
    label: 'Action Center',
    shortLabel: 'Actions',
    icon: BellRing,
    description: 'Prioritized tasks and next steps',
    feature: 'action_center' as FeatureId,
  },
  {
    to: '/expiry',
    label: 'Expiry Monitor',
    shortLabel: 'Expiry',
    icon: CalendarClock,
    description: 'Shelf-life risk by date',
    feature: 'expiry_monitor' as FeatureId,
  },
  {
    to: '/reorder',
    label: 'Reorder Planner',
    shortLabel: 'Reorder',
    icon: ClipboardList,
    description: 'Replenishment suggestions',
    feature: 'reorder_planner' as FeatureId,
  },
  {
    to: '/reports',
    label: 'Reports & Impact',
    shortLabel: 'Reports',
    icon: BarChart3,
    description: 'Distribution and acceptance tests',
    feature: 'reports' as FeatureId,
  },
  {
    to: '/calculator',
    label: 'Business Calculator',
    shortLabel: 'Calculator',
    icon: Calculator,
    description: 'Margins, markdowns, GST and break-even',
    feature: 'business_calculator' as FeatureId,
  },
  {
    to: '/settings',
    label: 'Settings',
    shortLabel: 'Settings',
    icon: SettingsIcon,
    description: 'Shop profile, rules and data',
    feature: null,
  },
  {
    to: '/security',
    label: 'Account & security',
    shortLabel: 'Security',
    icon: ShieldCheck,
    description: 'Password, sessions and account',
    feature: null,
  },
];

/** Nav items the signed-in account is permitted to use. */
export function permittedNavItems(permissions: Permissions): NavItem[] {
  return NAV_ITEMS.filter((item) => item.feature === null || permissions[item.feature]);
}

const SHORT_MOBILE = ['/', '/inventory', '/actions', '/reorder', '/expiry'];

/** Compact bottom-bar items, permission filtered. */
export function mobileNavItems(permissions: Permissions): NavItem[] {
  return permittedNavItems(permissions).filter((item) => SHORT_MOBILE.includes(item.to));
}

const EXTRA_META: Record<string, { title: string; description: string }> = {
  '/security': { title: 'Account & security', description: 'Password, sessions and account' },
  '/settings': { title: 'Settings', description: 'Shop profile, rules and data' },
};

export function pageMeta(pathname: string): { title: string; description: string } {
  if (EXTRA_META[pathname]) return EXTRA_META[pathname];
  const match =
    NAV_ITEMS.find((item) => item.to === pathname) ??
    NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to));
  return {
    title: match?.label ?? 'Overview',
    description: match?.description ?? 'Smart retail inventory assistant',
  };
}
