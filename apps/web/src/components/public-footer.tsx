'use client';

import { useI18n } from '@/lib/i18n';

export function PublicFooter() {
  const { t } = useI18n();
  return (
    <footer className="border-t py-6 text-center text-xs text-muted-foreground">
      © {new Date().getFullYear()} TontineMoney — {t('publicSite.footer')}
    </footer>
  );
}
