import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileIcon, Loader2, Lock } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { getTagValue } from '@/lib/dm/conversation';
import { decryptFile } from '@/lib/dm/fileCrypto';
import type { ChatMessage } from '@/lib/dm/types';
import { formatBytes } from '@/lib/format';
import { sanitizeUrl } from '@/lib/sanitize';
import { cn } from '@/lib/utils';

const MAX_AUTO_DOWNLOAD = 25 * 1024 * 1024;

/** Decrypted object URLs, kept for the whole session so scrolling never re-downloads. */
const objectUrls = new Map<string, string>();

function parseDim(value: string | undefined): { width: number; height: number } | undefined {
  const match = value?.match(/^(\d{1,5})x(\d{1,5})$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** Largest and smallest box a photo or video takes in the chat (CSS px). */
const MEDIA_MAX_WIDTH = 320;
const MEDIA_MAX_HEIGHT = 360;
const MEDIA_MIN_WIDTH = 150;
const MEDIA_MIN_HEIGHT = 110;

/**
 * The box a picture gets in the chat: scaled to fit, never tiny, never huge. Knowing it
 * up front means the bubble hugs the picture and nothing jumps when it finishes loading.
 */
function mediaBox(dim: { width: number; height: number } | undefined): { width: number; height: number } {
  if (!dim) return { width: 260, height: 195 };
  const scale = Math.min(MEDIA_MAX_WIDTH / dim.width, MEDIA_MAX_HEIGHT / dim.height);
  return {
    width: Math.round(Math.min(MEDIA_MAX_WIDTH, Math.max(MEDIA_MIN_WIDTH, dim.width * scale))),
    height: Math.round(Math.min(MEDIA_MAX_HEIGHT, Math.max(MEDIA_MIN_HEIGHT, dim.height * scale))),
  };
}

/** NIP-17 kind 15 attachment: downloads the ciphertext, decrypts it on-device and renders it. */
export function EncryptedFile({ message }: { message: ChatMessage }) {
  const mimeType = getTagValue(message, 'file-type') ?? 'application/octet-stream';
  const key = getTagValue(message, 'decryption-key');
  const nonce = getTagValue(message, 'decryption-nonce');
  const algorithm = getTagValue(message, 'encryption-algorithm');
  const size = Number(getTagValue(message, 'size') ?? 0);
  const dim = parseDim(getTagValue(message, 'dim'));
  const remoteUrl = sanitizeUrl(message.content);
  const encrypted = !!(key && nonce);
  const supported = !encrypted || !algorithm || algorithm === 'aes-gcm';

  const [manual, setManual] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  /** Real size of a picture that came without a `dim` tag, known once it has loaded. */
  const [loadedDim, setLoadedDim] = useState<{ width: number; height: number }>();
  const box = mediaBox(dim ?? loadedDim);
  const boxStyle = { width: box.width, aspectRatio: `${box.width} / ${box.height}` };
  const autoDownload = !size || size <= MAX_AUTO_DOWNLOAD;

  const query = useQuery({
    queryKey: ['dm-file', message.id],
    enabled: !message.localPreviewUrl && !!remoteUrl && encrypted && supported && (autoDownload || manual),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async ({ signal }) => {
      const cached = objectUrls.get(message.id);
      if (cached) return cached;
      if (!remoteUrl || !key || !nonce) throw new Error('Missing file details');
      const response = await fetch(remoteUrl, { signal });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const plain = await decryptFile(await response.arrayBuffer(), key, nonce);
      const objectUrl = URL.createObjectURL(new Blob([plain], { type: mimeType }));
      objectUrls.set(message.id, objectUrl);
      return objectUrl;
    },
  });

  const src = message.localPreviewUrl ?? (encrypted ? query.data : remoteUrl);
  const uploading = message.status === 'sending' && !!message.localPreviewUrl;
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');

  if (!remoteUrl && !message.localPreviewUrl) {
    return <FileNotice icon={<AlertTriangle className="size-4" />} text="Invalid file link." />;
  }
  if (!supported) {
    return <FileNotice icon={<AlertTriangle className="size-4" />} text={`Unsupported encryption (${algorithm}).`} />;
  }

  if (!src) {
    if (query.isError) {
      return (
        <div className="flex items-center gap-2 rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="flex-1">Couldn't load file.</span>
          <Button size="xs" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      );
    }
    if (!autoDownload && !manual) {
      return (
        <button
          type="button"
          onClick={() => setManual(true)}
          className="flex w-64 max-w-full items-center gap-3 rounded-lg bg-black/5 p-3 text-left text-sm transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
        >
          <Download className="size-5 shrink-0" />
          <span>
            <span className="block font-medium">Download file</span>
            <span className="block text-xs opacity-75">
              {mimeType} · {formatBytes(size)}
            </span>
          </span>
        </button>
      );
    }
    return (
      <Skeleton
        className={cn('max-w-full', isImage || isVideo ? 'rounded-xl' : 'w-64 rounded-lg')}
        style={isImage || isVideo ? boxStyle : { height: 56 }}
      />
    );
  }

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="relative block max-w-full overflow-hidden rounded-xl bg-black/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:bg-white/5"
          style={boxStyle}
          aria-label="Open photo"
        >
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (!dim && naturalWidth > 0 && naturalHeight > 0) setLoadedDim({ width: naturalWidth, height: naturalHeight });
            }}
            className={cn('size-full object-cover', uploading && 'opacity-60')}
          />
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-white drop-shadow" />
            </span>
          )}
        </button>
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="max-w-[min(64rem,calc(100vw-1rem))] gap-3 border-none bg-black/95 p-2 sm:max-w-[min(64rem,calc(100vw-2rem))] [&_[data-slot=dialog-close]]:bg-black/50 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]:hover]:bg-white/20">
            <DialogTitle className="sr-only">Photo</DialogTitle>
            <DialogDescription className="sr-only">Encrypted photo shared in this chat</DialogDescription>
            <img src={src} alt="" className="max-h-[80dvh] w-full rounded-md object-contain" />
            <div className="flex justify-end">
              <Button asChild size="sm" variant="secondary">
                <a href={src} download={`nostr-buzz-${message.id.slice(0, 8)}`}>
                  <Download /> Save
                </a>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (isVideo) {
    return <video src={src} controls playsInline preload="metadata" className="max-w-full rounded-xl bg-black object-contain" style={boxStyle} />;
  }

  if (isAudio) {
    return <audio src={src} controls preload="metadata" className="w-64 max-w-full" />;
  }

  return (
    <a
      href={src}
      download={`nostr-buzz-${message.id.slice(0, 8)}`}
      className="flex w-64 max-w-full items-center gap-3 rounded-lg bg-black/5 p-3 text-sm transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        {uploading ? <Loader2 className="size-5 animate-spin" /> : <FileIcon className="size-5" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{mimeType}</span>
        <span className="flex items-center gap-1 text-xs opacity-75">
          <Lock className="size-3" /> Encrypted{size ? ` · ${formatBytes(size)}` : ''}
        </span>
      </span>
    </a>
  );
}

function FileNotice({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">
      {icon}
      <span>{text}</span>
    </div>
  );
}
