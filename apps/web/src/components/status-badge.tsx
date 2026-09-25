import { Badge } from '@tontine/ui';
import { label, statusVariant } from '@/lib/labels';

export function StatusBadge({
  status,
  labels,
  className,
}: {
  status: string | null | undefined;
  labels: Record<string, string>;
  className?: string;
}) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={statusVariant(status)} className={className}>
      {label(labels, status)}
    </Badge>
  );
}
