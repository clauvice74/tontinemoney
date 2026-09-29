'use client';

import { Alert, Button, Checkbox } from '@tontine/ui';
import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

/**
 * Affichage UNIQUE des 10 codes de récupération : ils ne sont conservés qu'en mémoire du
 * composant et disparaissent après confirmation explicite de sauvegarde.
 */
export function RecoveryCodes({
  codes,
  onAcknowledged,
}: {
  codes: string[];
  onAcknowledged: () => void;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([`${t('security.fileHeader')}\n\n${text}\n`], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tontinemoney-codes-recuperation.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Alert variant="warning" title={t('security.saveNow')}>
        {t('security.saveNowBody')}
      </Alert>
      <ol
        className="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-4 font-mono text-sm"
        aria-label={t('security.recoveryTitle')}
      >
        {codes.map((c) => (
          <li key={c} className="tracking-wider">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Copy aria-hidden="true" /> {copied ? t('security.copied') : t('security.copy')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden="true" /> {t('security.download')}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('security.savedCheck')}
      </label>
      <Button type="button" variant="secondary" disabled={!saved} onClick={onAcknowledged}>
        {t('security.finish')}
      </Button>
    </div>
  );
}
