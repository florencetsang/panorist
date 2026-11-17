export function ErrorAlert({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </p>
  );
}
