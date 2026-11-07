import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <section className="card narrow">
        <h1>Page not found</h1>
        <p><Link href="/">Go home</Link></p>
      </section>
    </main>
  );
}
