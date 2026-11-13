import Nav from '@/components/Nav';
import ScheduleProvider from '@/components/ScheduleProvider';

// Shared by the pages of an open schedule (/data, /run and /settings). The route group
// folder "(schedule)" doesn't appear in URLs.
//
// The header stays at the top and only the page below it scrolls, so the scrollbar starts
// under the header. The page always keeps room for the scrollbar (scrollbar-gutter), so
// switching between a page that scrolls and one that doesn't never shifts it sideways; Nav
// keeps the same room, so the header lines up with the page.
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
