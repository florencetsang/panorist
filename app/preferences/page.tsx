import PreferencesForm from './form.tsx';
import { getUserIdFrom } from '../../lib/shared/user-id.ts';

export const metadata = { title: 'Preferences' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // TODO(auth): real auth replaces this query-param read (see lib/shared/user-id.ts).
  const userId = getUserIdFrom(await searchParams);
  return <PreferencesForm userId={userId} />;
}
