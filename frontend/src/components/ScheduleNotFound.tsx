import Link from 'next/link';

export default function ScheduleNotFound({ message }: { message?: string }) {
  return (
    <main className="py-16 text-center">
      <p className="text-lg text-gray-600">
        {message ?? 'This schedule could not be found. It may have been moved or deleted.'}
      </p>
      <Link href="/" className="mt-4 inline-block font-medium text-blue-600 hover:text-blue-700">
        Back to home
      </Link>
    </main>
  );
}
