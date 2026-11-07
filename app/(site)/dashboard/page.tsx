import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getCollections } from '@/lib/db';
import { listMenus } from '@/lib/menus';
import { getStore } from '@/lib/storage';
import { DeleteMenuButton, ReplacePdfForm, UploadMenuForm } from '../../_components/forms';
import { requireUser } from '../../_lib/session';
import { publicBaseUrl } from '../../_lib/url';

export const metadata: Metadata = { title: 'My menus' };

export default async function DashboardPage() {
  const user = await requireUser();
  const menus = await listMenus({ collections: await getCollections(), store: getStore() }, user._id);
  const base = publicBaseUrl(await headers());

  return (
    <>
      <h1>My menus</h1>
      <UploadMenuForm />
      {menus.length === 0 ? (
        <p>You haven&apos;t added any menus yet.</p>
      ) : (
        <ul className="menus">
          {menus.map((menu) => {
            const id = menu._id.toString();
            return (
              <li key={id} className="card menu">
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG from our own route; no optimisation needed */}
                <img className="qr" src={`/m/${menu.slug}/qr`} alt={`QR code for ${menu.name}`} width={120} height={120} />
                <div>
                  <h2>{menu.name}</h2>
                  <p>
                    <a href={`/m/${menu.slug}`}>{`${base}/m/${menu.slug}`}</a>
                  </p>
                  <p className="actions">
                    <a className="button" href={`/m/${menu.slug}/qr?download=1`}>Download QR code</a>
                  </p>
                  <ReplacePdfForm menuId={id} />
                  <DeleteMenuButton menuId={id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
