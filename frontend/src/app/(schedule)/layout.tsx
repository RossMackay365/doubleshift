import Nav from '@/components/Nav';
import ScheduleProvider from '@/components/ScheduleProvider';

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScheduleProvider>
      <div className="flex h-dvh flex-col">
        <Nav />
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <main className="mx-auto w-full max-w-7xl px-8 py-10 text-base">
            {children}
          </main>
        </div>
      </div>
    </ScheduleProvider>
  );
}
