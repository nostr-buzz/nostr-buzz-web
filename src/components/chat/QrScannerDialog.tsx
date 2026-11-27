import {
  CameraOff,
  Check,
  Copy,
  Flashlight,
  FlashlightOff,
  ImageUp,
  Loader2,
  MessageCircle,
  ScanLine,
  Share2,
  SwitchCamera,
} from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type ChangeEvent, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UserAvatar } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { conversationIdFromParticipants, conversationRoute } from '@/lib/dm/conversation';
import { displayName, shortNpub } from '@/lib/format';
import { hapticTick } from '@/lib/haptics';
import { decodeQr, parseScannedCode } from '@/lib/qr';
import { cn } from '@/lib/utils';

type Tab = 'scan' | 'code';

interface QrScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which side to show first. */
  initialTab?: Tab;
}

/** Scan someone's code to chat with them, or show your own. */
export function QrScannerDialog({ open, onOpenChange, initialTab = 'scan' }: QrScannerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {open && <Panel initialTab={initialTab} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Panel({ initialTab, onDone }: { initialTab: Tab; onDone: () => void }) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [found, setFound] = useState<string>();

  /** Returns false when the code is not something nostr.buzz understands. */
  const onText = (text: string): boolean => {
    const code = parseScannedCode(text);
    if (!code) return false;
    hapticTick();
    if (code.type === 'invite') {
      navigate(code.path);
      onDone();
    } else {
      setFound(code.pubkey);
    }
    return true;
  };

  const openChat = (pubkey: string) => {
    if (!user) return;
    navigate(conversationRoute(conversationIdFromParticipants([pubkey], user.pubkey)));
    onDone();
  };

  return (
    <>
      <DialogHeader className="border-b px-5 pt-5 pb-4 text-left">
        <DialogTitle className="font-display text-xl">{tab === 'scan' ? 'Scan to chat' : 'My code'}</DialogTitle>
        <DialogDescription>
          {tab === 'scan' ? 'Point the camera at a Nostr code.' : 'Others scan this to chat with you.'}
        </DialogDescription>
        <div role="tablist" aria-label="QR code" className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
          {(['scan', 'code'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value);
                setFound(undefined);
              }}
              className={cn(
                'rounded-full py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                tab === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'scan' ? 'Scan' : 'My code'}
            </button>
          ))}
        </div>
      </DialogHeader>

      {tab === 'code' ? (
        <MyCode />
      ) : found ? (
        <Found pubkey={found} isMe={found === user?.pubkey} onChat={() => openChat(found)} onRescan={() => setFound(undefined)} />
      ) : (
        <Camera onText={onText} />
      )}
    </>
  );
}

/* ---------------------------------- camera --------------------------------- */

type CameraStatus = 'starting' | 'live' | 'blocked' | 'missing';

function Camera({ onText }: { onText: (text: string) => boolean }) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<MediaStreamTrack | undefined>(undefined);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [canFlip, setCanFlip] = useState(false);
  const [torch, setTorch] = useState<'none' | 'off' | 'on'>('none');
  const [unknown, setUnknown] = useState(false);

  const report = useEffectEvent((text: string): boolean => {
    if (onText(text)) return true;
    setUnknown(true);
    window.setTimeout(() => setUnknown(false), 2500);
    return false;
  });

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let lastUnknown = '';

    const scan = async () => {
      if (stopped) return;
      if (!document.hidden && video.readyState >= 2) {
        try {
          const text = await decodeQr(video, canvas);
          if (stopped) return;
          if (text && text !== lastUnknown) {
            if (report(text)) return;
            lastUnknown = text;
          }
        } catch {
          // A frame that can't be read is just skipped.
        }
      }
      timer = window.setTimeout(() => void scan(), 150);
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('missing');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (error) {
        const blocked = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        if (!stopped) setStatus(blocked ? 'blocked' : 'missing');
        return;
      }
      if (stopped) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (stopped) return;

      const [track] = stream.getVideoTracks();
      trackRef.current = track;
      const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorch(capabilities?.torch ? 'off' : 'none');
      setStatus('live');
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!stopped) setCanFlip(devices.filter((device) => device.kind === 'videoinput').length > 1);
        })
        .catch(() => undefined);
      void scan();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
      video.srcObject = null;
      trackRef.current = undefined;
    };
  }, [facing]);

  const flip = () => {
    setStatus('starting');
    setTorch('none');
    setFacing((current) => (current === 'environment' ? 'user' : 'environment'));
  };

  const toggleTorch = () => {
    const next = torch === 'on' ? 'off' : 'on';
    const constraint = { torch: next === 'on' } as MediaTrackConstraintSet;
    trackRef.current
      ?.applyConstraints({ advanced: [constraint] })
      .then(() => setTorch(next))
      .catch(() => setTorch('none'));
  };

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const text = await decodeQr(bitmap, document.createElement('canvas'), true);
      bitmap.close();
      if (!text) toast({ title: 'No QR code found', description: 'Try a sharper photo.', variant: 'destructive' });
      else if (!onText(text)) toast({ title: 'Not a Nostr code', variant: 'destructive' });
    } catch {
      toast({ title: 'Could not read that photo', variant: 'destructive' });
    }
  };

  const unavailable = status === 'blocked' || status === 'missing';

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-label="Camera preview"
        className={cn('size-full object-cover', facing === 'user' && '-scale-x-100', unavailable && 'hidden')}
      />
      <canvas ref={canvasRef} hidden />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void onPhoto(event)} />

      {unavailable ? (
        <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-white/10">
            <CameraOff className="size-7" />
          </span>
          <p className="font-display text-lg font-bold">{status === 'blocked' ? 'Camera is blocked' : 'No camera found'}</p>
          <p className="max-w-xs text-sm text-white/70">
            {status === 'blocked' ? 'Allow camera access in your browser settings, or use a photo of the code.' : 'Use a photo of the code instead.'}
          </p>
          <Button className="mt-2 rounded-full" onClick={() => fileRef.current?.click()}>
            <ImageUp /> Choose photo
          </Button>
        </div>
      ) : (
        <>
          {/* Viewfinder: everything outside the square is dimmed. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 pb-16">
            <div className="relative aspect-square w-[min(70%,18rem)] rounded-3xl shadow-[0_0_0_100vmax_rgb(0_0_0/0.55)]">
              <span className="absolute top-0 left-0 size-10 rounded-tl-3xl border-t-4 border-l-4 border-amber-400" />
              <span className="absolute top-0 right-0 size-10 rounded-tr-3xl border-t-4 border-r-4 border-amber-400" />
              <span className="absolute bottom-0 left-0 size-10 rounded-bl-3xl border-b-4 border-l-4 border-amber-400" />
              <span className="absolute right-0 bottom-0 size-10 rounded-br-3xl border-r-4 border-b-4 border-amber-400" />
              {status === 'live' && <span className="qr-scan-line absolute inset-x-5 h-0.5 rounded-full bg-amber-400 shadow-[0_0_12px_2px_rgb(251_191_36/0.7)]" />}
              {status === 'starting' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-amber-400" aria-label="Starting camera" />
                </span>
              )}
            </div>
            <p role="status" className={cn('relative rounded-full px-4 py-1.5 text-sm font-medium', unknown ? 'bg-destructive text-white' : 'bg-black/50')}>
              {unknown ? 'Not a Nostr code' : 'Hold the code inside the frame'}
            </p>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <CameraButton label="Scan from a photo" onClick={() => fileRef.current?.click()}>
              <ImageUp className="size-5" />
            </CameraButton>
            {torch !== 'none' && (
              <CameraButton label={torch === 'on' ? 'Turn flashlight off' : 'Turn flashlight on'} active={torch === 'on'} onClick={toggleTorch}>
                {torch === 'on' ? <Flashlight className="size-5" /> : <FlashlightOff className="size-5" />}
              </CameraButton>
            )}
            {canFlip && (
              <CameraButton label="Switch camera" onClick={flip}>
                <SwitchCamera className="size-5" />
              </CameraButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CameraButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex size-12 items-center justify-center rounded-full backdrop-blur-md transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none motion-reduce:transition-none',
        active ? 'bg-amber-400 text-stone-950' : 'bg-white/15 text-white hover:bg-white/25',
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- result --------------------------------- */

function Found({ pubkey, isMe, onChat, onRescan }: { pubkey: string; isMe: boolean; onChat: () => void; onRescan: () => void }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-6 py-8 text-center">
      <div className="relative">
        <UserAvatar pubkey={pubkey} className="size-28 text-4xl" />
        <span className="absolute -right-1 -bottom-1 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
          <Check className="size-5" />
        </span>
      </div>
      <h3 className="mt-4 max-w-full truncate font-display text-2xl font-bold" dir="auto">
        {displayName(pubkey, metadata)}
      </h3>
      <p className="max-w-full truncate text-sm text-muted-foreground">{isMe ? 'This is your code' : metadata?.nip05 || shortNpub(pubkey)}</p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <Button className="h-12 rounded-xl text-base" onClick={onChat} autoFocus>
          <MessageCircle /> {isMe ? 'Saved messages' : 'Message'}
        </Button>
        <Button variant="ghost" className="h-11 rounded-xl" onClick={onRescan}>
          <ScanLine /> Scan another
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- my code --------------------------------- */

function MyCode() {
  const { user, metadata } = useCurrentUser();
  const { toast } = useToast();
  if (!user) return null;

  const npub = nip19.npubEncode(user.pubkey);
  const name = displayName(user.pubkey, metadata);
  const link = `${window.location.origin}/${npub}`;
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      toast({ title: 'npub copied' });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center">
      <div className="relative rounded-3xl bg-white p-4 pt-10 shadow-sm ring-1 ring-black/5">
        <UserAvatar pubkey={user.pubkey} className="absolute -top-8 left-1/2 size-16 -translate-x-1/2 text-xl ring-4 ring-white" />
        <QRCodeCanvas value={`nostr:${npub}`} size={220} />
        <p className="mt-2 max-w-[220px] truncate font-display text-lg font-bold text-stone-950" dir="auto">
          {name}
        </p>
      </div>
      <p className="mt-4 font-mono text-xs text-muted-foreground">{shortNpub(user.pubkey)}</p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="rounded-full" onClick={() => void copy()}>
          <Copy /> Copy npub
        </Button>
        {canShare && (
          <Button variant="outline" className="rounded-full" onClick={() => void navigator.share({ title: name, url: link }).catch(() => undefined)}>
            <Share2 /> Share
          </Button>
        )}
      </div>
    </div>
  );
}
