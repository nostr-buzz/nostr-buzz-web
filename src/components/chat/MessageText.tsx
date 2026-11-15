import { nip19 } from 'nostr-tools';
import { type ReactNode, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { AuthorName } from '@/components/chat/UserAvatar';
import { sanitizeUrl } from '@/lib/sanitize';
import { cn } from '@/lib/utils';

type Part =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; safe?: string; image: boolean }
  | { type: 'mention'; value: string; pubkey: string };

const TOKEN = /(https?:\/\/[^\s<>"']+|nostr:(?:npub1|nprofile1)[0-9a-z]+)/gi;
const IMAGE_URL = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]\S*)?$/i;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/;

function tokenize(content: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of content.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    let token = match[0];
    let trailing = '';
    const punctuation = token.match(TRAILING_PUNCTUATION);
    if (punctuation && token.startsWith('http')) {
      trailing = punctuation[0];
      token = token.slice(0, -trailing.length);
    }
    if (index > last) parts.push({ type: 'text', value: content.slice(last, index) });

    if (token.startsWith('nostr:')) {
      try {
        const decoded = nip19.decode(token.slice(6));
        if (decoded.type === 'npub') parts.push({ type: 'mention', value: token, pubkey: decoded.data });
        else if (decoded.type === 'nprofile') parts.push({ type: 'mention', value: token, pubkey: decoded.data.pubkey });
        else parts.push({ type: 'text', value: token });
      } catch {
        parts.push({ type: 'text', value: token });
      }
    } else {
      const safe = sanitizeUrl(token);
      parts.push({ type: 'url', value: token, safe, image: !!safe && IMAGE_URL.test(token) });
    }

    if (trailing) parts.push({ type: 'text', value: trailing });
    last = index + match[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) });
  return parts;
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

interface MessageTextProps {
  content: string;
  className?: string;
  /** Show inline previews for image links. */
  previews?: boolean;
}

/** Renders message text with safe links, inline images and @mentions. Never injects HTML. */
export function MessageText({ content, className, previews = true }: MessageTextProps) {
  const parts = useMemo(() => tokenize(content), [content]);
  const images = previews
    ? parts.filter((part): part is Extract<Part, { type: 'url' }> => part.type === 'url' && part.image).slice(0, 4)
    : [];
  const onlyImages =
    images.length > 0 && parts.every((part) => (part.type === 'url' && part.image) || (part.type === 'text' && !part.value.trim()));

  const nodes: ReactNode[] = parts.map((part, index) => {
    if (part.type === 'text') return part.value;
    if (part.type === 'mention') {
      return (
        <Link
          key={index}
          to={`/${nip19.npubEncode(part.pubkey)}`}
          className="font-semibold underline decoration-1 underline-offset-2 hover:opacity-80"
        >
          @<AuthorName pubkey={part.pubkey} />
        </Link>
      );
    }
    if (!part.safe) return part.value;
    return (
      <a
        key={index}
        href={part.safe}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-medium underline decoration-1 underline-offset-2 [overflow-wrap:anywhere] hover:opacity-80"
      >
        {prettyUrl(part.value)}
      </a>
    );
  });

  return (
    <div className={cn('min-w-0', className)}>
      {!onlyImages && (
        <p dir="auto" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {nodes}
        </p>
      )}
      {images.length > 0 && (
        <div className={cn('grid gap-1', !onlyImages && 'mt-1.5', images.length > 1 && 'grid-cols-2')}>
          {images.map((image, index) => (
            <a key={index} href={image.safe} target="_blank" rel="noopener noreferrer nofollow" className="block overflow-hidden rounded-lg">
              <img
                src={image.safe}
                alt=""
                loading="lazy"
                className="max-h-80 w-full bg-black/5 object-cover transition-transform hover:scale-[1.02] motion-reduce:hover:scale-100"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
