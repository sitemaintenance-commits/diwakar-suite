import { useNavigate } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <EmptyState
      className="min-h-[60vh]"
      icon={<FileQuestion className="size-6" />}
      title="Page not found"
      description="The page you’re looking for doesn’t exist or has moved."
      action={<Button onClick={() => navigate('/')}>Back to dashboard</Button>}
    />
  );
}
