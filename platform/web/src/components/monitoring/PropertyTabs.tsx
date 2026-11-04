'use client';
import { usePathname } from 'next/navigation';
import { Tabs } from '../ui';

export function PropertyTabs({ base }: { base: string }) {
  const path = usePathname();
  const items = [
    { key: 'live', label: 'Live', href: base },
    { key: 'history', label: 'History & insights', href: `${base}/history` },
    { key: 'zones', label: 'Security zones', href: `${base}/zones` },
    { key: 'devices', label: 'Devices', href: `${base}/devices` },
  ];
  const active = items.slice(1).find((i) => path.startsWith(i.href))?.key ?? (path.startsWith(`${base}/rooms`) ? 'live' : 'live');
  return <Tabs items={items} active={active} />;
}
