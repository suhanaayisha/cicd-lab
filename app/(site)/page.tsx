import Link from 'next/link';
import { getCurrentUser } from '../_lib/session';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <section className="hero">
      <h1>Turn your PDF menu into a QR code</h1>
      <p>
        Upload your menu PDF and get a mobile-friendly menu page and a printable QR code for your tables.
        Update the PDF any time: the QR code stays the same.
      </p>
      <p>
        {user ? (
          <Link className="button" href="/dashboard">Go to my menus</Link>
        ) : (
          <Link className="button" href="/signup">Create a free account</Link>
        )}
      </p>
    </section>
  );
}
