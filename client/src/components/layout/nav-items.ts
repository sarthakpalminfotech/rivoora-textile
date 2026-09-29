import { ClipboardList, Factory, Layers, Palette, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/materials', label: 'Materials', icon: Layers },
  { to: '/designs', label: 'Designs', icon: Palette },
  { to: '/machines', label: 'Machines', icon: Factory },
];
