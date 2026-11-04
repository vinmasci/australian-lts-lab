import type { Metadata } from 'next';
import LtsMap from '@/app/components/LtsMap';
export const metadata: Metadata={title:'Workshop map | AusBUG'};
export default function WorkshopPage(){return <LtsMap workshopMode />;}
