import type { Metadata } from 'next';
import GoogleWorkshopMap from '@/app/components/GoogleWorkshopMap';
export const metadata:Metadata={title:'Google workshop trial | AusBUG'};
export default function Page(){return <GoogleWorkshopMap/>;}
