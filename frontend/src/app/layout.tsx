import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import Nav from '@/components/Nav';
import AuthGuard from '@/components/AuthGuard';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Schedule Optimiser',
  description: 'Tennis schedule optimiser',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-gray-50">
        <Nav />
        <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-10 text-base">
          <AuthGuard>{children}</AuthGuard>
        </main>
      </body>
    </html>
  );
}
