import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@schoolerp/ui';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg">
        <EmptyState
          title="Page not found"
          description="The page you followed does not exist or has moved. Check the address, or head back to your dashboard."
          action={
            <Link to="/">
              <Button>Back to dashboard</Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}
