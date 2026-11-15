import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2 } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';

import { UserAvatar } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { sanitizeUrl } from '@/lib/sanitize';

const FIELDS = ['name', 'display_name', 'about', 'picture', 'banner', 'website', 'nip05', 'lud16'] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

export function EditProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open && <ProfileForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const { user, metadata, event } = useCurrentUser();
  const { mutateAsync: publish, isPending } = useNostrPublish();
  const upload = useUploadFile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<Form>(() => {
    const initial = {} as Form;
    for (const field of FIELDS) {
      const value = metadata?.[field];
      initial[field] = typeof value === 'string' ? value : '';
    }
    return initial;
  });

  if (!user) return null;

  const set = (field: Field) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const onPickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const [[, url]] = await upload.mutateAsync(file);
      setForm((current) => ({ ...current, picture: url }));
    } catch (error) {
      toast({ title: 'Upload failed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };

  const save = async () => {
    // Keep any fields other apps added to the profile.
    let base: Record<string, unknown> = {};
    try {
      const parsed: unknown = event ? JSON.parse(event.content) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      base = {};
    }
    const next: Record<string, unknown> = { ...base };
    for (const field of FIELDS) {
      const value = form[field].trim();
      if (value) next[field] = value;
      else delete next[field];
    }

    try {
      const published = await publish({ kind: 0, content: JSON.stringify(next) });
      queryClient.setQueryData(['nostr', 'author', user.pubkey], { event: published, metadata: next });
      await queryClient.invalidateQueries({ queryKey: ['nostr', 'logins'] });
      toast({ title: 'Profile updated' });
      onDone();
    } catch (error) {
      toast({ title: 'Could not save profile', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };

  const preview = sanitizeUrl(form.picture);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-xl">Edit profile</DialogTitle>
        <DialogDescription>Your profile is public and shared across every Nostr app.</DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-4">
        <div className="relative">
          {preview ? (
            <img src={preview} alt="" className="size-20 rounded-full object-cover" />
          ) : (
            <UserAvatar pubkey={user.pubkey} className="size-20 text-2xl" />
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Upload profile photo"
            className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-background"
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPickAvatar(e)} />
        </div>
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" value={form.name} onChange={set('name')} dir="auto" maxLength={64} />
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="profile-display">Display name</Label>
          <Input id="profile-display" value={form.display_name} onChange={set('display_name')} dir="auto" maxLength={64} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-about">About</Label>
          <Textarea id="profile-about" value={form.about} onChange={set('about')} dir="auto" rows={3} maxLength={500} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-picture">Picture URL</Label>
          <Input id="profile-picture" value={form.picture} onChange={set('picture')} placeholder="https://…" inputMode="url" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-banner">Banner URL</Label>
          <Input id="profile-banner" value={form.banner} onChange={set('banner')} placeholder="https://…" inputMode="url" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="profile-nip05">NIP-05</Label>
            <Input id="profile-nip05" value={form.nip05} onChange={set('nip05')} placeholder="you@domain.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-lud16">Lightning address</Label>
            <Input id="profile-lud16" value={form.lud16} onChange={set('lud16')} placeholder="you@wallet.com" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-website">Website</Label>
          <Input id="profile-website" value={form.website} onChange={set('website')} placeholder="https://…" inputMode="url" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={isPending || upload.isPending}>
          {isPending && <Loader2 className="animate-spin" />} Save profile
        </Button>
      </DialogFooter>
    </>
  );
}
