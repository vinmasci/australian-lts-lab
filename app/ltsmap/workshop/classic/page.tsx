import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LtsMap from '@/app/components/LtsMap';
import { WORKSHOP_ENABLED, hiddenWorkshopUrl, type WorkshopQuery } from '@/lib/workshop-availability';
export const metadata: Metadata={title:'Classic workshop map | AusBUG'};
export default async function Page({searchParams}:{searchParams:Promise<WorkshopQuery>}){
  if(!WORKSHOP_ENABLED)redirect(hiddenWorkshopUrl(await searchParams));
  return <LtsMap workshopMode />;
}
