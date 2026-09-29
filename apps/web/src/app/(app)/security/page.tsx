'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  OtpInput,
  toast,
} from '@tontine/ui';
import { MonitorSmartphone, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { RecoveryCodes } from '@/components/security/recovery-codes';
import { api } from '@/lib/api';
import type {
  ListResponse,
  MfaEnableSms,
  MfaEnableTotp,
  MfaStatus,
  SessionView,
} from '@/lib/api/types';
import { loadCurrentUser } from '@/lib/auth/session';
import { formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useCurrentUser } from '@/lib/queries';

type Setup =
  | { step: 'idle' }
  | { step: 'verify'; type: 'TOTP'; totp: MfaEnableTotp }
  | { step: 'verify'; type: 'SMS' }
  | { step: 'codes'; codes: string[] };

function MfaCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const status = useQuery({ queryKey: ['mfa'], queryFn: () => api.get<MfaStatus>('/auth/mfa') });
  const [setup, setSetup] = useState<Setup>({ step: 'idle' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenCode, setRegenCode] = useState('');

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['mfa'] });
    await loadCurrentUser().catch(() => undefined);
  };

  const enable = useMutation({
    mutationFn: (type: 'TOTP' | 'SMS') =>
      api.post<MfaEnableTotp | MfaEnableSms>('/auth/mfa/enable', { type }),
    onSuccess: (res, type) => {
      setError(null);
      setCode('');
      if (type === 'TOTP') setSetup({ step: 'verify', type: 'TOTP', totp: res as MfaEnableTotp });
      else setSetup({ step: 'verify', type: 'SMS' });
    },
    onError: (e) => setError(formatError(e)),
  });

  const verify = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; recoveryCodes: string[] }>('/auth/mfa/verify', {
        code: code.trim(),
      }),
    onSuccess: async (res) => {
      setError(null);
      setSetup({ step: 'codes', codes: res.recoveryCodes });
      await refresh();
    },
    onError: (e) => setError(formatError(e)),
  });

  const sendSms = useMutation({
    mutationFn: () => api.post('/auth/mfa/sms-code'),
    onSuccess: () => toast.success(t('security.smsCodeSent')),
    onError: (e) => toast.error(t('security.sendFailed'), formatError(e)),
  });

  if (setup.step === 'codes') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('security.recoveryTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryCodes
            codes={setup.codes}
            onAcknowledged={() => {
              setSetup({ step: 'idle' });
              toast.success(t('security.mfaActive'));
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-info" aria-hidden="true" /> {t('security.mfaTitle')}
        </CardTitle>
        <CardDescription>{t('security.mfaDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive" title={error} /> : null}
        <QueryState query={status}>
          {(s) => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {t('security.state')}
                {s.enabled ? (
                  <Badge variant="success">
                    {s.type === 'SMS' ? t('security.enabledSms') : t('security.enabledApp')}
                  </Badge>
                ) : (
                  <Badge variant="muted">{t('security.disabled')}</Badge>
                )}
                {s.enabled ? (
                  <span className="text-muted-foreground">
                    · {t('security.codesLeft', { count: s.recoveryCodesLeft })}
                  </span>
                ) : null}
              </div>
              {s.required && !s.enabled ? (
                <Alert variant="warning" title={t('security.requiredTitle')}>
                  {t('security.requiredBody')}
                </Alert>
              ) : null}
              {s.required && s.enabled && user && !user.mfa.usedThisSession ? (
                <Alert variant="info" title={t('security.reloginTitle')}>
                  {t('security.reloginBody')}
                </Alert>
              ) : null}
              {s.mustRegenerate ? (
                <Alert variant="warning" title={t('security.exhaustedTitle')}>
                  {t('security.exhaustedBody')}
                </Alert>
              ) : null}

              {!s.enabled && setup.step === 'idle' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => enable.mutate('TOTP')}
                    loading={enable.isPending && enable.variables === 'TOTP'}
                  >
                    {t('security.useApp')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => enable.mutate('SMS')}
                    loading={enable.isPending && enable.variables === 'SMS'}
                  >
                    {t('security.useSms')}
                  </Button>
                </div>
              ) : null}

              {setup.step === 'verify' ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!/^\d{6}$/.test(code.trim())) {
                      setError(t('security.codeIncomplete'));
                      return;
                    }
                    verify.mutate();
                  }}
                >
                  {setup.type === 'TOTP' ? (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <Image
                        src={setup.totp.qrCodeUrl}
                        alt={t('security.qrAlt')}
                        width={176}
                        height={176}
                        unoptimized
                        className="rounded-lg border bg-white p-2"
                      />
                      <div className="space-y-2 text-sm">
                        <p>{t('security.scan')}</p>
                        <p>
                          {t('security.manualKey')}{' '}
                          <code className="break-all rounded bg-muted px-1 py-0.5 font-mono">
                            {setup.totp.secret}
                          </code>
                        </p>
                        <p>{t('security.enterCode')}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm">{t('security.smsSent')}</p>
                  )}
                  <FormField id="mfa-verify-code" label={t('security.code')} required>
                    <OtpInput value={code} onValueChange={setCode} />
                  </FormField>
                  <div className="flex gap-2">
                    <Button type="submit" variant="secondary" loading={verify.isPending}>
                      {t('security.confirm')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSetup({ step: 'idle' })}
                    >
                      {t('security.cancel')}
                    </Button>
                  </div>
                </form>
              ) : null}

              {s.enabled ? (
                <div className="flex flex-wrap gap-2">
                  {s.type === 'SMS' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => sendSms.mutate()}
                      loading={sendSms.isPending}
                    >
                      {t('security.sendSms')}
                    </Button>
                  ) : null}
                  <RegenerateDialog
                    code={regenCode}
                    setCode={setRegenCode}
                    onCodes={(codes) => setSetup({ step: 'codes', codes })}
                  />
                  <ActionDialog
                    trigger={t('security.disable')}
                    triggerVariant="destructive"
                    title={t('security.disableTitle')}
                    description={t('security.disableBody')}
                    confirmLabel={t('security.disable')}
                    confirmVariant="destructive"
                    successMessage={t('security.disabledDone')}
                    onConfirm={async () => {
                      await api.post('/auth/mfa/disable', {
                        password: disablePassword,
                        code: disableCode.trim(),
                      });
                      setDisablePassword('');
                      setDisableCode('');
                      await refresh();
                    }}
                  >
                    <FormField id="mfa-disable-password" label={t('security.password')} required>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                      />
                    </FormField>
                    <FormField id="mfa-disable-code" label={t('security.mfaOrRecovery')} required>
                      <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
                    </FormField>
                  </ActionDialog>
                </div>
              ) : null}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function RegenerateDialog({
  code,
  setCode,
  onCodes,
}: {
  code: string;
  setCode: (c: string) => void;
  onCodes: (codes: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <ActionDialog
      trigger={t('security.regenerate')}
      title={t('security.regenerateTitle')}
      description={t('security.regenerateBody')}
      confirmLabel={t('security.generate')}
      onConfirm={async () => {
        const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
          code: code.trim(),
        });
        setCode('');
        onCodes(res.recoveryCodes);
      }}
    >
      <FormField id="mfa-regen-code" label={t('security.mfaCode')} required>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </FormField>
    </ActionDialog>
  );
}

function SessionsCard() {
  const { t } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<ListResponse<SessionView>>('/auth/sessions'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-5 text-info" aria-hidden="true" />{' '}
          {t('security.sessionsTitle')}
        </CardTitle>
        <CardDescription>{t('security.sessionsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={sessions}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="text-sm text-muted-foreground">{t('security.sessionsEmpty')}</p>}
        >
          {(d) => (
            <ul className="divide-y">
              {d.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {s.userAgent ?? t('security.unknownDevice')}
                      {s.current ? (
                        <Badge variant="success" className="ml-2">
                          {t('security.thisSession')}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('security.openedOn', {
                        date: f.dateTime(s.createdAt),
                        relative: f.relative(s.lastUsedAt),
                      })}
                    </p>
                  </div>
                  {!s.current ? (
                    <ActionDialog
                      trigger={t('security.revoke')}
                      title={t('security.revokeTitle')}
                      description={t('security.revokeBody')}
                      confirmVariant="destructive"
                      confirmLabel={t('security.revoke')}
                      successMessage={t('security.revoked')}
                      onConfirm={async () => {
                        await api.delete(`/auth/sessions/${s.id}`);
                        await queryClient.invalidateQueries({ queryKey: ['sessions'] });
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

export default function SecurityPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('security.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('security.description')}</p>
      </div>
      <MfaCard />
      <SessionsCard />
    </div>
  );
}
