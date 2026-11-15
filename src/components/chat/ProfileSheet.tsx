import { Camera, Copy, ExternalLink, Loader2, LogOut, Pencil, UserPlus, Users, X, Zap } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type ChangeEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { BuzzButton } from '@/components/chat/BuzzButton';
import { MessageText } from '@/components/chat/MessageText';
import { NewChatDialog } from '@/components/chat/NewChatDialog';
import { AuthorName, ConversationAvatar, ConversationTitle, UserAvatar } from '@/components/chat/UserAvatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { conversationIdFromParticipants, conversationRoute } from '@/lib/dm/conversation';
import type { Conversation } from '@/lib/dm/types';
import { displayName } from '@/lib/format';
import type { GroupView } from '@/lib/groups/groups';
import { sanitizeUrl } from '@/lib/sanitize';

interface ProfileSheetProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileSheet({ conversation, open, onOpenChange }: ProfileSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Don't auto-focus the first button: it would show a focus frame on open. */}
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {conversation.group ? (
          <NostrGroupInfo conversation={conversation} group={conversation.group} onClose={() => onOpenChange(false)} />
        ) : conversation.isGroup ? (
          <GroupInfo conversation={conversation} onNavigate={() => onOpenChange(false)} />
        ) : (
          <PersonInfo pubkey={conversation.participants[0]} conversation={conversation} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ChatToggles({ conversation }: { conversation: Conversation }) {
  const { isMuted, toggleMute, isPinned, togglePin } = useDM();
  return (
    <div className="divide-y rounded-xl border">
      {!conversation.isSelf && (
        <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-medium">
          Notifications
          <Switch checked={!isMuted(conversation.id)} onCheckedChange={() => toggleMute(conversation.id)} />
        </label>
      )}
      <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-medium">
        Pin chat to top
        <Switch checked={isPinned(conversation.id)} onCheckedChange={() => togglePin(conversation.id)} />
      </label>
    </div>
  );
}

function PersonInfo({ pubkey, conversation }: { pubkey: string; conversation: Conversation }) {
  const author = useAuthor(pubkey);
  const { toast } = useToast();
  const metadata = author.data?.metadata;
  const banner = sanitizeUrl(metadata?.banner);
  const website = sanitizeUrl(metadata?.website);
  const name = conversation.isSelf ? 'Saved messages' : displayName(pubkey, metadata);
  const npub = nip19.npubEncode(pubkey);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  return (
    <>
      <SheetHeader className="sr-only">
        <SheetTitle>{name}</SheetTitle>
        <SheetDescription>Profile and chat settings</SheetDescription>
      </SheetHeader>
      <div className="relative h-36 shrink-0 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600">
        {banner && <img src={banner} alt="" className="size-full object-cover" />}
      </div>
      <div className="-mt-12 px-6 pb-8">
        <UserAvatar pubkey={pubkey} className="size-24 text-3xl ring-4 ring-background" />
        <h2 className="mt-3 font-display text-2xl font-bold break-words" dir="auto">
          {conversation.isSelf ? displayName(pubkey, metadata) : name}
        </h2>
        {metadata?.nip05 && <p className="truncate text-sm text-muted-foreground">{metadata.nip05}</p>}
        {metadata?.about && <MessageText content={metadata.about} previews={false} className="mt-3 text-sm" />}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-amber-700 hover:underline dark:text-amber-400">
              <ExternalLink className="size-3.5" /> {website.replace(/^https:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {metadata?.lud16 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Zap className="size-3.5" /> {metadata.lud16}
            </span>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          {!conversation.isSelf && <BuzzButton conversationId={conversation.id} variant="large" className="flex-1" />}
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => void copy(npub, 'npub')}>
            <Copy /> Copy npub
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-4 rounded-xl border p-4">
          <QRCodeCanvas value={`nostr:${npub}`} size={112} className="shrink-0 rounded-lg bg-white p-1" />
          <p className="min-w-0 font-mono text-xs break-all text-muted-foreground">{npub}</p>
        </div>

        <div className="mt-6">
          <ChatToggles conversation={conversation} />
        </div>

        <Button variant="link" asChild className="mt-4 px-0">
          <Link to={`/${npub}`}>Open full profile</Link>
        </Button>
      </div>
    </>
  );
}

function GroupInfo({ conversation, onNavigate }: { conversation: Conversation; onNavigate: () => void }) {
  const { user } = useCurrentUser();
  const me = user?.pubkey ?? '';
  const members = [me, ...conversation.participants];

  return (
    <>
      <SheetHeader className="items-center border-b px-6 pt-10 pb-6 text-center">
        <ConversationAvatar conversation={conversation} className="size-20" />
        <SheetTitle className="mt-2 font-display text-2xl">
          <ConversationTitle conversation={conversation} />
        </SheetTitle>
        <SheetDescription>{members.length} members</SheetDescription>
        <BuzzButton conversationId={conversation.id} variant="large" className="mt-3 w-full" />
      </SheetHeader>
      <div className="space-y-6 px-6 py-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Members</h3>
          <ul className="space-y-1">
            {members.map((pubkey) => (
              <li key={pubkey}>
                <Link
                  to={conversationRoute(conversationIdFromParticipants([pubkey], me))}
                  onClick={onNavigate}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent"
                >
                  <UserAvatar pubkey={pubkey} className="size-10" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    <AuthorName pubkey={pubkey} />
                    {pubkey === me && <span className="ml-1 text-muted-foreground">(you)</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <ChatToggles conversation={conversation} />
        <p className="text-xs text-muted-foreground">Changing members starts a new group.</p>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                     nostr.buzz groups (with their own npub)                */
/* -------------------------------------------------------------------------- */

function NostrGroupInfo({ conversation, group, onClose }: { conversation: Conversation; group: GroupView; onClose: () => void }) {
  const { user } = useCurrentUser();
  const { addGroupMembers, removeGroupMember, leaveGroup } = useDM();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const me = user?.pubkey ?? '';
  const npub = nip19.npubEncode(group.id);
  const canEdit = group.isAdmin && !group.removed && group.loaded;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      toast({ title: 'Group ID copied' });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  const remove = (pubkey: string) => {
    removeGroupMember(group.id, pubkey).catch((error: unknown) =>
      toast({ title: 'Could not remove', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }),
    );
  };

  return (
    <>
      <SheetHeader className="items-center border-b px-6 pt-10 pb-6 text-center">
        <ConversationAvatar conversation={conversation} className="size-24" />
        <SheetTitle className="mt-2 font-display text-2xl break-words" dir="auto">
          {group.name}
        </SheetTitle>
        <SheetDescription>{group.members.length} members</SheetDescription>
        {group.about && (
          <p dir="auto" className="text-sm whitespace-pre-wrap">
            {group.about}
          </p>
        )}
        {!group.removed && <BuzzButton conversationId={conversation.id} variant="large" className="mt-3 w-full" />}
        {canEdit && (
          <Button variant="outline" className="mt-2 h-11 w-full rounded-xl" onClick={() => setEditOpen(true)}>
            <Pencil /> Edit group
          </Button>
        )}
      </SheetHeader>

      <div className="space-y-6 px-6 py-6">
        {group.removed && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">You're no longer in this group.</p>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Group ID</h3>
          <button
            type="button"
            onClick={() => void copyId()}
            className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">{npub}</span>
            <Copy className="size-4 shrink-0" />
          </button>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Members</h3>
            {canEdit && (
              <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setAddOpen(true)}>
                <UserPlus /> Add
              </Button>
            )}
          </div>
          <ul className="space-y-1">
            {group.members.map((pubkey) => (
              <li key={pubkey} className="flex items-center gap-1">
                <Link
                  to={conversationRoute(conversationIdFromParticipants([pubkey], me))}
                  onClick={onClose}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent"
                >
                  <UserAvatar pubkey={pubkey} className="size-10" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    <AuthorName pubkey={pubkey} />
                    {pubkey === me && <span className="ml-1 text-muted-foreground">(you)</span>}
                  </span>
                  {group.admins.includes(pubkey) && <span className="text-xs text-muted-foreground">admin</span>}
                </Link>
                {canEdit && pubkey !== me && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-muted-foreground"
                    aria-label="Remove member"
                    onClick={() => setRemoving(pubkey)}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <ChatToggles conversation={conversation} />

        <Button variant="ghost" className="w-full rounded-xl text-destructive hover:text-destructive" onClick={() => setConfirmLeave(true)}>
          <LogOut /> Leave group
        </Button>
      </div>

      {canEdit && <EditGroupDialog open={editOpen} onOpenChange={setEditOpen} group={group} />}
      {canEdit && (
        <NewChatDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          pick={{
            title: 'Add members',
            confirmLabel: 'Add',
            exclude: group.members,
            onConfirm: (pubkeys) => addGroupMembers(group.id, pubkeys),
          }}
        />
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>They won't see new messages.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => removing && remove(removing)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave group?</AlertDialogTitle>
            <AlertDialogDescription>You can be invited again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                leaveGroup(group.id);
                onClose();
                navigate('/');
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditGroupDialog({ open, onOpenChange, group }: { open: boolean; onOpenChange: (open: boolean) => void; group: GroupView }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <EditGroupForm group={group} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function EditGroupForm({ group, onDone }: { group: GroupView; onDone: () => void }) {
  const { updateGroup } = useDM();
  const upload = useUploadFile();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(group.name);
  const [about, setAbout] = useState(group.about ?? '');
  const [picture, setPicture] = useState(group.picture ?? '');
  const [saving, setSaving] = useState(false);
  const preview = sanitizeUrl(picture);

  const onPickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const [[, url]] = await upload.mutateAsync(file);
      setPicture(url);
    } catch (error) {
      toast({ title: 'Upload failed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateGroup(group.id, {
        name,
        about: about.trim() || undefined,
        picture: sanitizeUrl(picture.trim()),
      });
      toast({ title: 'Group updated' });
      onDone();
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-xl">Edit group</DialogTitle>
        <DialogDescription>Only members can see this.</DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-4">
        <div className="relative">
          {preview ? (
            <img src={preview} alt="" className="size-20 rounded-full object-cover" />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-stone-900">
              <Users className="size-9" />
            </div>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Upload group photo"
            className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void onPickPhoto(event)} />
        </div>
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="group-name">Name</Label>
          <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} dir="auto" maxLength={80} />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="group-about">Description</Label>
        <Textarea id="group-about" value={about} onChange={(event) => setAbout(event.target.value)} dir="auto" rows={3} maxLength={500} />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || upload.isPending || !name.trim()}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </>
  );
}
