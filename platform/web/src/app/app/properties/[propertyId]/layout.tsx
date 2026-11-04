import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { PropertyTabs } from '@/components/monitoring/PropertyTabs';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatAddress } from '@/lib/format';
import type { Property } from '@/lib/types';

export default async function PropertyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ propertyId: string }> }) {
  await requireClientUser();
  const { propertyId } = await params;
  const db = await createClient();
  // RLS returns nothing for properties outside the user's tenant → 404 (no information leak).
  const { data } = await db.from('properties').select('id, name, address_line1, city, region, postal_code, country').eq('id', propertyId).maybeSingle();
  if (!data) notFound();
  const p = data as Property;
  return (
    <>
      <PageHeader title={p.name} subtitle={formatAddress(p)} breadcrumbs={[{ href: '/app', label: 'My properties' }]} />
      <PropertyTabs base={`/app/properties/${p.id}`} />
      {children}
    </>
  );
}
