import { Reader } from '../../../../components/reader.tsx';

export const metadata = { title: 'Briefing' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Reader reportId={id} />;
}
