'use client';

import { useParams, useRouter } from 'next/navigation';
import { InitiativeDetail } from '@/components/initiatives';

export default function InitiativeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  return (
    <InitiativeDetail
      initiativeId={id}
      onBack={() => router.push('/initiatives')}
    />
  );
}
