import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getCollections } from '@/lib/db';
import { findMenuBySlug, versionedPdfPath } from '@/lib/menus';
import { getStore } from '@/lib/storage';
import { MenuViewer } from '../../_components/MenuViewer';

type Props = { params: Promise<{ slug: string }> };

async function loadMenu(slug: string) {
  await connection(); // Always render at request time: menus change when owners upload a new PDF.
  return findMenuBySlug({ collections: await getCollections(), store: getStore() }, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const menu = await loadMenu((await params).slug);
  return { title: { absolute: menu ? menu.name : 'Menu not found' } };
}

export default async function MenuPage({ params }: Props) {
  const menu = await loadMenu((await params).slug);
  if (!menu) notFound();

  const pdfUrl = versionedPdfPath(menu);
  return (
    <main className="menu-page">
      <h1 className="menu-title">{menu.name}</h1>
      <MenuViewer pdfUrl={pdfUrl} />
      <noscript>
        <p><a href={pdfUrl}>Open the menu PDF</a></p>
      </noscript>
    </main>
  );
}
