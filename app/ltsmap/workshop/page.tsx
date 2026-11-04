import type { Metadata } from 'next';
import GoogleWorkshopMap from '@/app/components/GoogleWorkshopMap';
export const metadata: Metadata={title:'Workshop map | AusBUG'};
export default function WorkshopPage(){return <GoogleWorkshopMap/>;}
