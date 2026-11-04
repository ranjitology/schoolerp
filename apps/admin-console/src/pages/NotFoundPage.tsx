import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@schoolerp/ui';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg">
        <EmptyState
          title="Page not found"
          description="This console page does not exist. Return to the platform overview."
          action={
            <Link to="/">
              <Button>Back to overview</Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}
