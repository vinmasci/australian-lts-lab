import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import GoogleWorkshopMap from '@/app/components/GoogleWorkshopMap';
import { WORKSHOP_ENABLED, hiddenWorkshopUrl, type WorkshopQuery } from '@/lib/workshop-availability';
export const metadata: Metadata={title:'Workshop map | AusBUG'};
export default async function Page({searchParams}:{searchParams:Promise<WorkshopQuery>}){
  if(!WORKSHOP_ENABLED)redirect(hiddenWorkshopUrl(await searchParams));
  return <GoogleWorkshopMap/>;
}
