import { Check, Paperclip, Pencil, Reply, SendHorizontal, Smile, X } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { BuzzButton } from '@/components/chat/BuzzButton';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { AuthorName } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { useChatSettings } from '@/hooks/useChatSettings';
import { useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { messagePreview } from '@/lib/dm/conversation';
import type { ChatMessage, Conversation } from '@/lib/dm/types';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const draftKey = (id: string) => `nostr-buzz:draft:${id}`;

function loadDraft(id: string): string {
  try {
    return localStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(id: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(draftKey(id), value);
    else localStorage.removeItem(draftKey(id));
  } catch {
    // Drafts are a convenience.
  }
}

interface ComposerProps {
  conversation: Conversation;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  /** Group name to attach until the room has one. */
  subject?: string;
}

/**
 * Message input. Remount it (via `key`) when the conversation or edited message
 * changes so the initial text is picked up without effects.
 */
export function Composer({ conversation, replyTo, editing, onCancelReply, onCancelEdit, subject }: ComposerProps) {
  const { sendText, sendFile, editMessage, canEncrypt: signerCanEncrypt } = useDM();
  const removed = !!conversation.group?.removed;
  const mutedHere = !!conversation.group?.isMuted;
  const canEncrypt = signerCanEncrypt && !removed && !mutedHere;
  const { settings } = useChatSettings();
  const { toast } = useToast();
  const [text, setText] = useState(() => editing?.content ?? loadDraft(conversation.id));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow the textarea with its content.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (replyTo || editing) textareaRef.current?.focus();
  }, [replyTo, editing]);

  const update = (value: string) => {
    setText(value);
    if (!editing) saveDraft(conversation.id, value);
  };

  const fail = (title: string) => (error: unknown) =>
    toast({ title, description: error instanceof Error ? error.message : undefined, variant: 'destructive' });

  const submit = () => {
    const value = text.trim();
    if (!value || !canEncrypt) return;
    setText('');

    if (editing) {
      onCancelEdit();
      editMessage(editing, value).catch(fail('Edit failed'));
      return;
    }

    saveDraft(conversation.id, '');
    const reply = replyTo ?? undefined;
    onCancelReply();
    sendText(conversation.id, value, { replyTo: reply, subject }).catch(fail('Message failed'));
    textareaRef.current?.focus();
  };

  const sendFiles = (files: File[]) => {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast({ title: 'File too large', description: `${file.name} is over 100 MB.`, variant: 'destructive' });
        continue;
      }
      sendFile(conversation.id, file, { replyTo: replyTo ?? undefined, subject }).catch(fail('Upload failed'));
    }
    if (replyTo) onCancelReply();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (editing) {
        setText('');
        onCancelEdit();
      } else if (replyTo) onCancelReply();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (settings.enterToSend && !coarse) {
      event.preventDefault();
      submit();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      sendFiles(files);
    }
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    update(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const context = editing ?? replyTo;
  const hasText = text.trim().length > 0;

  return (
    <div className="border-t bg-background/90 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md md:px-4">
      <div className="mx-auto max-w-4xl">
        {context && (
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-muted/70 py-1.5 pr-1.5 pl-3">
            {editing ? <Pencil className="size-4 shrink-0 text-amber-600 dark:text-amber-400" /> : <Reply className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
            <div className="min-w-0 flex-1 border-l-2 border-amber-500 pl-2">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {editing ? 'Edit message' : <>Reply to <AuthorName pubkey={context.pubkey} /></>}
              </p>
              <p className="truncate text-sm text-muted-foreground" dir="auto">
                {messagePreview(context)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label={editing ? 'Cancel edit' : 'Cancel reply'}
              onClick={() => {
                if (editing) {
                  setText('');
                  onCancelEdit();
                } else onCancelReply();
              }}
            >
              <X />
            </Button>
          </div>
        )}

        <div className="flex items-end gap-1 md:gap-1.5">
          <EmojiPicker onSelect={insertEmoji}>
            <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full text-muted-foreground" aria-label="Insert emoji" disabled={!canEncrypt}>
              <Smile className="size-6" />
            </Button>
          </EmojiPicker>

          <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-3xl border bg-card px-4 py-2 shadow-sm transition-shadow focus-within:border-foreground/25">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(event) => update(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              dir="auto"
              disabled={!canEncrypt}
              placeholder={
                canEncrypt
                  ? 'Message'
                  : removed
                    ? "You're not a member"
                    : mutedHere
                      ? "You can't send messages here"
                      : 'Encryption not supported'
              }
              aria-label="Message"
              className="max-h-[200px] w-full resize-none bg-transparent text-base leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
          </div>

          {!editing && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 rounded-full text-muted-foreground"
                aria-label="Attach photo or file"
                disabled={!canEncrypt}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-6" />
              </Button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                tabIndex={-1}
                onChange={(event) => {
                  sendFiles([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
            </>
          )}

          {hasText || editing || conversation.isSelf || !canEncrypt ? (
            <Button
              size="icon"
              className={cn('size-11 shrink-0 rounded-full transition-transform active:scale-95', !hasText && 'opacity-60')}
              aria-label={editing ? 'Save changes' : 'Send message'}
              disabled={!hasText || !canEncrypt}
              onClick={submit}
            >
              {editing ? <Check className="size-5" /> : <SendHorizontal className="size-5" />}
            </Button>
          ) : (
            <BuzzButton conversationId={conversation.id} variant="icon" className="size-11 bg-primary text-primary-foreground hover:bg-primary/90" />
          )}
        </div>
      </div>
    </div>
  );
}
