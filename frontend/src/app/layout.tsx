import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GeistSans } from 'geist/font/sans';
import WindowControls from '@/components/WindowControls';
import './globals.css';

export const metadata: Metadata = {
  title: 'DoubleShift: Training Scheduler',
  description: 'Build a training schedule that works for your groups, your trainers and your spaces.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-gray-50">
        <Suspense>{children}</Suspense>
        <WindowControls />
      </body>
    </html>
  );
}
