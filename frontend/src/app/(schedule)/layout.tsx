import Nav from '@/components/Nav';
import ScheduleProvider from '@/components/ScheduleProvider';

// Shared by the pages of an open schedule (/data and /run). The route group folder
// "(schedule)" doesn't appear in URLs.
export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScheduleProvider>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-10 text-base">
        {children}
      </main>
    </ScheduleProvider>
  );
}
