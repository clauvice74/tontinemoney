import { Card, CardContent, CardDescription, CardHeader } from '@tontine/ui';
import type { ReactNode } from 'react';

/** Mise en page centrée des écrans d'authentification. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10 sm:py-16">
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
