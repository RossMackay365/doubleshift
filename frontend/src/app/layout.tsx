import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DoubleShift: Training Scheduler',
  description: 'Training session scheduler',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-gray-50">
        {/* Suspense is required for pages that read ?file= from the URL (useSearchParams) in a static build. */}
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
