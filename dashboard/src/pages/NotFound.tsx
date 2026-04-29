import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <section className="glass-card w-full max-w-lg p-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-3 text-muted-foreground">
          The route you requested does not exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
        >
          Back to home
        </Link>
      </section>
    </main>
  );
}
