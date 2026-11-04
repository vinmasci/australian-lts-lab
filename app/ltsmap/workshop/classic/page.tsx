import type { Metadata } from 'next';
import LtsMap from '@/app/components/LtsMap';
export const metadata: Metadata={title:'Classic workshop map | AusBUG'};
export default function ClassicWorkshopPage(){return <LtsMap workshopMode />;}
