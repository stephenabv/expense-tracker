import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        The page you were looking for does not exist.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
