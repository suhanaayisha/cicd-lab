import Link from 'next/link';
import type { ReactNode } from 'react';
import { logOutAction } from '../actions';
import { getCurrentUser } from '../_lib/session';

// Pages with the site header. The public menu pages (app/m) are deliberately left without it.
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">MenuQR</Link>
        <nav>
          {user ? (
            <>
              <Link href="/dashboard">My menus</Link>
              <form action={logOutAction} className="inline">
                <button type="submit" className="link">Log out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link className="button" href="/signup">Sign up</Link>
            </>
          )}
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
