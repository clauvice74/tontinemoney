'use client';

import { Alert, Button, cn } from '@tontine/ui';
import { Camera, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SelfieResult {
  blob: Blob;
  livenessToken: string;
}

export interface SelfieCaptureProps {
  /** Ouvre une session de liveness (`POST /kyc/liveness`) et renvoie son jeton. */
  startLiveness: () => Promise<string>;
  onCapture: (result: SelfieResult) => void;
  /** Appelé quand l'utilisateur recommence la capture. */
  onReset?: () => void;
  disabled?: boolean;
}

type Phase = 'idle' | 'starting' | 'live' | 'captured' | 'error';

interface DetectedFace {
  boundingBox: DOMRectReadOnly;
}
interface FaceDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedFace[]>;
}
type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

/** API expérimentale (Chrome) : utilisée pour la capture automatique si disponible. */
function getFaceDetector(): FaceDetectorLike | null {
  const ctor = (globalThis as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
  if (!ctor) return null;
  try {
    return new ctor({ fastMode: true, maxDetectedFaces: 1 });
  } catch {
    return null;
  }
}

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Accès à la caméra refusé. Autorisez la caméra dans les paramètres de votre navigateur, puis réessayez.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Aucune caméra frontale détectée sur cet appareil.';
  }
  if (name === 'NotReadableError') {
    return 'La caméra est utilisée par une autre application.';
  }
  return 'Impossible de démarrer la capture. Réessayez.';
}

/**
 * Selfie KYC (US-3.1) **exclusivement via la caméra** : aucun sélecteur de fichier.
 * Cadrage guidé (ovale), capture automatique si le visage est détecté et centré (FaceDetector),
 * sinon bouton de capture. La session de liveness est ouverte au démarrage de la caméra.
 */
export function SelfieCapture({ startLiveness, onCapture, onReset, disabled }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState('Placez votre visage dans l’ovale, bien éclairé, sans lunettes.');
  const [faceAligned, setFaceAligned] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const token = tokenRef.current;
    if (!video || !token) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 960;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Capture impossible sur ce navigateur.');
      setPhase('error');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Capture impossible. Réessayez.');
          setPhase('error');
          return;
        }
        stopStream();
        setPreview(URL.createObjectURL(blob));
        setPhase('captured');
        onCapture({ blob, livenessToken: token });
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture, stopStream]);

  async function start() {
    setError(null);
    setPhase('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Votre navigateur ne permet pas l’accès à la caméra. Utilisez un navigateur récent.');
      setPhase('error');
      return;
    }
    try {
      const [stream, token] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        }),
        startLiveness(),
      ]);
      streamRef.current = stream;
      tokenRef.current = token;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setPhase('live');
    } catch (e) {
      stopStream();
      setError(e instanceof DOMException ? cameraErrorMessage(e) : 'Impossible d’ouvrir la session de vérification. Réessayez.');
      setPhase('error');
    }
  }

  // Détection de visage (si disponible) → capture automatique quand le cadrage est bon.
  useEffect(() => {
    if (phase !== 'live') return;
    const detector = getFaceDetector();
    if (!detector) return;
    let stable = 0;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || cancelled || video.readyState < 2) return;
      try {
        const faces = await detector.detect(video);
        const face = faces[0];
        if (!face) {
          stable = 0;
          setFaceAligned(false);
          setHint('Aucun visage détecté : placez-vous face à la caméra.');
          return;
        }
        const { x, y, width } = face.boundingBox;
        const cx = (x + width / 2) / video.videoWidth;
        const cy = (y + face.boundingBox.height / 2) / video.videoHeight;
        const size = width / video.videoWidth;
        const centered = Math.abs(cx - 0.5) < 0.12 && Math.abs(cy - 0.45) < 0.15;
        const bigEnough = size > 0.25 && size < 0.7;
        if (centered && bigEnough) {
          stable += 1;
          setFaceAligned(true);
          setHint('Parfait, ne bougez plus…');
          if (stable >= 3) {
            window.clearInterval(timer);
            capture();
          }
        } else {
          stable = 0;
          setFaceAligned(false);
          setHint(!bigEnough ? (size <= 0.25 ? 'Rapprochez-vous.' : 'Éloignez-vous un peu.') : 'Centrez votre visage dans l’ovale.');
        }
      } catch {
        window.clearInterval(timer);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, capture]);

  function retake() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    tokenRef.current = null;
    setFaceAligned(false);
    onReset?.();
    void start();
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-xl border bg-muted',
          phase === 'idle' && 'grid place-items-center',
        )}
      >
        {phase === 'captured' && preview ? (
          <Image
            src={preview}
            alt="Aperçu de votre selfie"
            fill
            unoptimized
            className="object-cover [transform:scaleX(-1)]"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label="Aperçu de la caméra"
              className={cn(
                'absolute inset-0 size-full object-cover [transform:scaleX(-1)]',
                phase !== 'live' && 'invisible',
              )}
            />
            {phase === 'live' ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
                <div
                  className={cn(
                    'h-[62%] w-[62%] rounded-[50%] border-4 border-dashed shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-colors',
                    faceAligned ? 'border-success' : 'border-white/90',
                  )}
                />
              </div>
            ) : null}
            {phase === 'idle' || phase === 'starting' ? (
              <Camera className="size-10 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </>
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        {phase === 'live'
          ? hint
          : phase === 'captured'
            ? 'Selfie capturé.'
            : 'Le selfie est pris en direct avec la caméra de votre appareil.'}
      </p>

      {error ? <Alert variant="destructive" title={error} /> : null}

      <div className="flex flex-wrap justify-center gap-2">
        {phase === 'idle' || phase === 'error' || phase === 'starting' ? (
          <Button type="button" onClick={() => void start()} loading={phase === 'starting'} disabled={disabled}>
            <Camera aria-hidden="true" /> Activer la caméra
          </Button>
        ) : null}
        {phase === 'live' ? (
          <Button type="button" onClick={capture} disabled={disabled}>
            <Camera aria-hidden="true" /> Prendre le selfie
          </Button>
        ) : null}
        {phase === 'captured' ? (
          <Button type="button" variant="outline" onClick={retake} disabled={disabled}>
            <RotateCcw aria-hidden="true" /> Reprendre
          </Button>
        ) : null}
      </div>
    </div>
  );
}
