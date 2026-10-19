export default function AccountLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8" aria-busy="true">
      <div className="h-7 w-36 animate-pulse rounded-md bg-gray-200" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl bg-white p-6 shadow-sm"
          >
            <div className="h-5 w-40 rounded bg-gray-200" />
            <div className="mt-3 h-4 w-3/4 rounded bg-gray-200" />
            <div className="mt-2 h-4 w-1/2 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading your account</span>
    </div>
  );
}
