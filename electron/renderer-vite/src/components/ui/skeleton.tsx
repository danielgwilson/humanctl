// Vendored from shadcn/ui (registry: new-york, stage 2b), a dependency of
// Sidebar's SidebarMenuSkeleton. Only import path needed rewriting; `@/lib/utils`
// already matches this repo's alias.
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-ink-4/20', className)} {...props} />;
}

export { Skeleton };
