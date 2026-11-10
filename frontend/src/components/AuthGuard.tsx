'use client';
import { useSyncExternalStore, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const useIsClient = () =>
  useSyncExternalStore(() => () => {}, () => true, () => false);

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isClient = useIsClient();

  useEffect(() => {
    if (pathname === '/login') return;
    if (!sessionStorage.getItem('auth_token')) {
      router.replace('/login');
    }
  }, [pathname, router]);

  if (!isClient) return null;
  if (pathname !== '/login' && !sessionStorage.getItem('auth_token')) return null;

  return <>{children}</>;
}
