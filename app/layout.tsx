import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Australian Bicycle LTS Lab',
  description: 'An experimental, transparent Bicycle Level of Traffic Stress map for Victoria and New South Wales.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

