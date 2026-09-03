import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AusBUG LTS Map',
  description: 'A transparent, community-reviewed Bicycle Level of Traffic Stress map for Australia.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
