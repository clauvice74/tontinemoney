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
  toast,
} from '@tontine/ui';
import { MonitorSmartphone, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { PageHeader } from '@/components/page-header';
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
import { formatDateTime, formatRelative } from '@/lib/format';
import { formatError } from '@/lib/forms';
import { useCurrentUser } from '@/lib/queries';

type Setup =
  | { step: 'idle' }
  | { step: 'verify'; type: 'TOTP'; totp: MfaEnableTotp }
  | { step: 'verify'; type: 'SMS' }
  | { step: 'codes'; codes: string[] };

function MfaCard() {
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
    onSuccess: () => toast.success('Code envoyé par SMS'),
    onError: (e) => toast.error('Envoi impossible', formatError(e)),
  });

  if (setup.step === 'codes') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Codes de récupération</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryCodes
            codes={setup.codes}
            onAcknowledged={() => {
              setSetup({ step: 'idle' });
              toast.success('Double authentification active');
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
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" /> Double authentification
          (MFA)
        </CardTitle>
        <CardDescription>
          Protégez votre compte avec un code à usage unique en plus du mot de passe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive" title={error} /> : null}
        <QueryState query={status}>
          {(s) => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                État :
                {s.enabled ? (
                  <Badge variant="success">
                    Activée ({s.type === 'SMS' ? 'SMS' : 'application'})
                  </Badge>
                ) : (
                  <Badge variant="muted">Désactivée</Badge>
                )}
                {s.enabled ? (
                  <span className="text-muted-foreground">
                    · {s.recoveryCodesLeft} code{s.recoveryCodesLeft > 1 ? 's' : ''} de récupération
                    restant{s.recoveryCodesLeft > 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
              {s.required && !s.enabled ? (
                <Alert variant="warning" title="MFA obligatoire pour votre rôle">
                  Activez la double authentification puis reconnectez-vous pour accéder à
                  l’administration de la plateforme.
                </Alert>
              ) : null}
              {s.required && s.enabled && user && !user.mfa.usedThisSession ? (
                <Alert variant="info" title="Reconnexion nécessaire">
                  Votre session actuelle a été ouverte sans second facteur. Déconnectez-vous puis
                  reconnectez-vous pour accéder aux écrans d’administration.
                </Alert>
              ) : null}
              {s.mustRegenerate ? (
                <Alert variant="warning" title="Codes de récupération épuisés">
                  Générez de nouveaux codes ci-dessous.
                </Alert>
              ) : null}

              {!s.enabled && setup.step === 'idle' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => enable.mutate('TOTP')}
                    loading={enable.isPending && enable.variables === 'TOTP'}
                  >
                    Application d’authentification
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => enable.mutate('SMS')}
                    loading={enable.isPending && enable.variables === 'SMS'}
                  >
                    Code par SMS
                  </Button>
                </div>
              ) : null}

              {setup.step === 'verify' ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!/^\d{6}$/.test(code.trim())) {
                      setError('Saisissez les 6 chiffres du code');
                      return;
                    }
                    verify.mutate();
                  }}
                >
                  {setup.type === 'TOTP' ? (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <Image
                        src={setup.totp.qrCodeUrl}
                        alt="QR code à scanner avec votre application d’authentification"
                        width={176}
                        height={176}
                        unoptimized
                        className="rounded-lg border bg-white p-2"
                      />
                      <div className="space-y-2 text-sm">
                        <p>
                          1. Scannez ce QR code avec votre application (Google Authenticator, Authy,
                          FreeOTP…).
                        </p>
                        <p>
                          Ou saisissez la clé manuellement :{' '}
                          <code className="break-all rounded bg-muted px-1 py-0.5 font-mono">
                            {setup.totp.secret}
                          </code>
                        </p>
                        <p>2. Saisissez le code à 6 chiffres affiché.</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm">Un code à 6 chiffres vous a été envoyé par SMS.</p>
                  )}
                  <FormField id="mfa-verify-code" label="Code de vérification" required>
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className="max-w-40"
                    />
                  </FormField>
                  <div className="flex gap-2">
                    <Button type="submit" loading={verify.isPending}>
                      Confirmer
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSetup({ step: 'idle' })}
                    >
                      Annuler
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
                      Recevoir un code SMS
                    </Button>
                  ) : null}
                  <RegenerateDialog
                    code={regenCode}
                    setCode={setRegenCode}
                    onCodes={(codes) => setSetup({ step: 'codes', codes })}
                  />
                  <ActionDialog
                    trigger="Désactiver"
                    triggerVariant="destructive"
                    title="Désactiver la double authentification"
                    description="Confirmez avec votre mot de passe et un code valide. Une alerte de sécurité vous sera envoyée."
                    confirmLabel="Désactiver"
                    confirmVariant="destructive"
                    successMessage="Double authentification désactivée"
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
                    <FormField id="mfa-disable-password" label="Mot de passe" required>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                      />
                    </FormField>
                    <FormField
                      id="mfa-disable-code"
                      label="Code MFA ou code de récupération"
                      required
                    >
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
  return (
    <ActionDialog
      trigger="Régénérer les codes de récupération"
      title="Nouveaux codes de récupération"
      description="Les anciens codes seront invalidés. Saisissez un code MFA valide."
      confirmLabel="Générer"
      onConfirm={async () => {
        const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
          code: code.trim(),
        });
        setCode('');
        onCodes(res.recoveryCodes);
      }}
    >
      <FormField id="mfa-regen-code" label="Code MFA" required>
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
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<ListResponse<SessionView>>('/auth/sessions'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-5 text-primary" aria-hidden="true" /> Sessions actives
        </CardTitle>
        <CardDescription>5 sessions simultanées au maximum.</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={sessions}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="text-sm text-muted-foreground">Aucune session active.</p>}
        >
          {(d) => (
            <ul className="divide-y">
              {d.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {s.userAgent ?? 'Appareil inconnu'}
                      {s.current ? (
                        <Badge variant="success" className="ml-2">
                          Cette session
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ouverte le {formatDateTime(s.createdAt)} · active{' '}
                      {formatRelative(s.lastUsedAt)}
                    </p>
                  </div>
                  {!s.current ? (
                    <ActionDialog
                      trigger="Révoquer"
                      title="Révoquer cette session ?"
                      description="L’appareil concerné sera déconnecté."
                      confirmVariant="destructive"
                      confirmLabel="Révoquer"
                      successMessage="Session révoquée"
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
  return (
    <div className="space-y-6">
      <PageHeader title="Sécurité" description="Double authentification et appareils connectés." />
      <MfaCard />
      <SessionsCard />
    </div>
  );
}
