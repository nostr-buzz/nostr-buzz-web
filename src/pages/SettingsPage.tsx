import { ArrowLeft, Copy, Loader2, LogOut, Monitor, Moon, Pencil, Plus, Sun, Trash2, X } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type ReactNode, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { BeeMark, Wordmark } from '@/components/brand/Brand';
import { EditProfileDialog } from '@/components/chat/EditProfileDialog';
import { UserAvatar } from '@/components/chat/UserAvatar';
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ChatSettings, Theme } from '@/contexts/AppContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useBuzz } from '@/hooks/useBuzz';
import { useChatSettings } from '@/hooks/useChatSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useDMRelayInfo, usePublishInboxRelays } from '@/hooks/useDMRelays';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { nowSeconds } from '@/lib/dm/nip17';
import { DEFAULT_INBOX_RELAYS, MAX_INBOX_RELAYS, uniqueRelays } from '@/lib/dm/relays';
import { displayName, shortNpub } from '@/lib/format';
import { normalizeRelayUrl } from '@/lib/sanitize';
import { playMessageSound } from '@/lib/sounds';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  if (!user) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-muted/30">
      <header className="flex items-center gap-2 border-b bg-background/90 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md md:px-6">
        <Button variant="ghost" size="icon" className="rounded-full md:hidden" aria-label="Back to chats" onClick={() => navigate('/')}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="px-2 py-1.5 font-display text-xl font-bold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 pb-20">
          <ProfileCard />
          <AppearanceSection />
          <BuzzSection />
          <NotificationsSection />
          <PrivacySection />
          <InboxRelaysSection />
          <NetworkRelaysSection />
          <StorageSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- building blocks ------------------------------ */

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h2 className="font-display text-sm font-bold tracking-wide text-muted-foreground uppercase">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">{children}</div>
    </section>
  );
}

function SettingSwitch({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 border-b px-4 py-3.5 last:border-b-0">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

function useSetting<K extends keyof ChatSettings>(key: K) {
  const { settings, updateSettings } = useChatSettings();
  return [settings[key], (value: ChatSettings[K]) => updateSettings({ [key]: value } as Partial<ChatSettings>)] as const;
}

/* ---------------------------------- sections ---------------------------------- */

function ProfileCard() {
  const { user, metadata } = useCurrentUser();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  if (!user) return null;
  const npub = nip19.npubEncode(user.pubkey);

  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm">
      <UserAvatar pubkey={user.pubkey} className="size-16 text-2xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold" dir="auto">
          {displayName(user.pubkey, metadata)}
        </p>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard.writeText(npub).then(
              () => toast({ title: 'npub copied' }),
              () => toast({ title: 'Could not copy', variant: 'destructive' }),
            )
          }
          className="mt-0.5 inline-flex max-w-full items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
        >
          <span className="truncate font-mono">{shortNpub(user.pubkey)}</span>
          <Copy className="size-3.5 shrink-0" />
        </button>
      </div>
      <Button variant="outline" className="rounded-full" onClick={() => setEditOpen(true)}>
        <Pencil /> <span className="hidden sm:inline">Edit</span>
      </Button>
      <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <Section title="Appearance">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium">Theme</span>
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(value) => value && setTheme(value as Theme)}
          variant="outline"
          aria-label="Theme"
        >
          <ToggleGroupItem value="light" aria-label="Light" className="gap-1.5 px-3">
            <Sun className="size-4" /> Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark" className="gap-1.5 px-3">
            <Moon className="size-4" /> Dark
          </ToggleGroupItem>
          <ToggleGroupItem value="system" aria-label="System" className="gap-1.5 px-3">
            <Monitor className="size-4" /> Auto
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </Section>
  );
}

function BuzzSection() {
  const { triggerBuzz } = useBuzz();
  const [buzzSound, setBuzzSound] = useSetting('buzzSound');
  const [buzzShake, setBuzzShake] = useSetting('buzzShake');
  const [vibrate, setVibrate] = useSetting('vibrate');
  const [messageSound, setMessageSound] = useSetting('messageSound');

  return (
    <Section title="Buzz & sounds">
      <div className="flex items-center gap-4 border-b bg-amber-50 px-4 py-4 dark:bg-amber-400/10">
        <BeeMark className="size-12 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">Test your buzz</span>
          <span className="text-muted-foreground">See and hear exactly what happens when someone buzzes you.</span>
        </p>
        <Button className="rounded-full" onClick={() => triggerBuzz({})}>
          Buzz me
        </Button>
      </div>
      <SettingSwitch label="Buzz sound" description="Play the classic buzz sound." checked={buzzSound} onCheckedChange={setBuzzSound} />
      <SettingSwitch label="Shake the screen" description="The whole app shakes when you're buzzed." checked={buzzShake} onCheckedChange={setBuzzShake} />
      <SettingSwitch label="Vibrate" description="On phones that support it." checked={vibrate} onCheckedChange={setVibrate} />
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0">
          <SettingInline label="Message sound" description="A soft pop for new messages in other chats." />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={playMessageSound}>
            Preview
          </Button>
          <Switch checked={messageSound} onCheckedChange={setMessageSound} aria-label="Message sound" />
        </div>
      </div>
    </Section>
  );
}

function SettingInline({ label, description }: { label: string; description: string }) {
  return (
    <>
      <span className="block font-medium">{label}</span>
      <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
    </>
  );
}

function NotificationsSection() {
  const { toast } = useToast();
  const [notifications, setNotifications] = useSetting('notifications');
  const [previews, setPreviews] = useSetting('notificationPreviews');
  const supported = typeof Notification !== 'undefined';

  const toggle = async (value: boolean) => {
    if (!value) {
      setNotifications(false);
      return;
    }
    if (!supported) {
      toast({ title: 'Not supported', description: 'This browser cannot show notifications.', variant: 'destructive' });
      return;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') setNotifications(true);
    else toast({ title: 'Permission denied', description: 'Allow notifications for this site in your browser settings.', variant: 'destructive' });
  };

  return (
    <Section title="Notifications" description="Shown while nostr.buzz is open in a background tab.">
      <SettingSwitch
        label="Desktop notifications"
        description={supported ? 'Get notified about new messages and buzzes.' : 'Not supported in this browser.'}
        checked={notifications && supported}
        onCheckedChange={(value) => void toggle(value)}
        disabled={!supported}
      />
      <SettingSwitch
        label="Show message preview"
        description="Include the message text in notifications."
        checked={previews}
        onCheckedChange={setPreviews}
        disabled={!notifications}
      />
    </Section>
  );
}

function PrivacySection() {
  const [enterToSend, setEnterToSend] = useSetting('enterToSend');
  const [strangers, setStrangers] = useSetting('buzzFromStrangers');
  const [legacy, setLegacy] = useSetting('legacyDMs');

  return (
    <Section title="Chats & privacy">
      <SettingSwitch label="Enter to send" description="Use Shift + Enter for a new line (keyboard only)." checked={enterToSend} onCheckedChange={setEnterToSend} />
      <SettingSwitch
        label="Buzzes from strangers"
        description="Let people you don't follow shake your screen."
        checked={strangers}
        onCheckedChange={setStrangers}
      />
      <SettingSwitch
        label="Legacy direct messages"
        description="Also load older NIP-04 messages, and reply with NIP-04 to people who haven't upgraded."
        checked={legacy}
        onCheckedChange={setLegacy}
      />
    </Section>
  );
}

function RelayEditor({
  relays,
  onChange,
  max,
  renderExtra,
}: {
  relays: string[];
  onChange: (relays: string[]) => void;
  max?: number;
  renderExtra?: (url: string) => ReactNode;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();
  const inputId = useId();

  const add = () => {
    const value = input.trim();
    const normalized = normalizeRelayUrl(value.startsWith('ws') ? value : `wss://${value}`);
    if (!normalized) {
      setError('Enter a valid wss:// relay address.');
      return;
    }
    if (relays.includes(normalized)) {
      setError('That relay is already in the list.');
      return;
    }
    if (max && relays.length >= max) {
      setError(`Keep this list to ${max} relays or fewer.`);
      return;
    }
    onChange([...relays, normalized]);
    setInput('');
    setError(undefined);
  };

  return (
    <div>
      <ul>
        {relays.map((url) => (
          <li key={url} className="flex items-center gap-3 border-b px-4 py-2.5">
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{url.replace(/^wss:\/\//, '').replace(/\/$/, '')}</span>
            {renderExtra?.(url)}
            <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`Remove ${url}`} onClick={() => onChange(relays.filter((r) => r !== url))}>
              <X />
            </Button>
          </li>
        ))}
        {relays.length === 0 && <li className="border-b px-4 py-3 text-sm text-muted-foreground">No relays yet.</li>}
      </ul>
      <div className="flex gap-2 px-4 py-3">
        <label htmlFor={inputId} className="sr-only">
          Relay address
        </label>
        <Input
          id={inputId}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="wss://relay.example.com"
          aria-invalid={!!error}
          className="font-mono text-sm"
        />
        <Button variant="outline" onClick={add} aria-label="Add relay">
          <Plus />
        </Button>
      </div>
      {error && <p className="px-4 pb-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function InboxRelaysSection() {
  const { user } = useCurrentUser();
  const info = useDMRelayInfo(user?.pubkey);
  const publish = usePublishInboxRelays();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);

  const current = info.data?.inbox ?? [];
  const relays = draft ?? current;
  const dirty = draft !== null && draft.join('|') !== current.join('|');

  const save = () => {
    publish.mutate(relays, {
      onSuccess: () => {
        setDraft(null);
        toast({ title: 'Inbox relays published' });
      },
      onError: (error) => toast({ title: 'Could not publish', description: error.message, variant: 'destructive' }),
    });
  };

  return (
    <Section
      title="Private message inbox"
      description="Relays where others deliver your encrypted messages (NIP-17, kind 10050). Keep it to 1–3 relays."
    >
      {info.isLoading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your inbox…
        </div>
      ) : (
        <>
          {current.length === 0 && draft === null && (
            <p className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
              You haven't published an inbox yet, so other apps may not know where to send your messages.
            </p>
          )}
          <RelayEditor relays={relays} onChange={setDraft} max={MAX_INBOX_RELAYS} />
          <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
            <Button variant="ghost" onClick={() => setDraft(DEFAULT_INBOX_RELAYS)}>
              Use recommended
            </Button>
            <Button onClick={save} disabled={publish.isPending || relays.length === 0 || (!dirty && current.length > 0)}>
              {publish.isPending && <Loader2 className="animate-spin" />} {current.length === 0 && !dirty ? 'Publish' : 'Save'}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

function NetworkRelaysSection() {
  const { config, updateConfig } = useAppContext();
  const { mutateAsync: publish, isPending } = useNostrPublish();
  const { toast } = useToast();
  const [draft, setDraft] = useState<{ url: string; read: boolean; write: boolean }[] | null>(null);
  const relays = draft ?? config.relayMetadata.relays;

  const setUrls = (urls: string[]) => {
    setDraft(urls.map((url) => relays.find((r) => normalizeRelayUrl(r.url) === url) ?? { url, read: true, write: true }));
  };
  const toggle = (url: string, key: 'read' | 'write') =>
    setDraft(relays.map((relay) => (normalizeRelayUrl(relay.url) === url ? { ...relay, [key]: !relay[key] } : relay)));

  const save = async () => {
    if (!draft) return;
    const cleaned = draft.filter((relay) => relay.read || relay.write);
    try {
      await publish({
        kind: 10002,
        content: '',
        tags: cleaned.map((relay) =>
          relay.read && relay.write ? ['r', relay.url] : ['r', relay.url, relay.read ? 'read' : 'write'],
        ),
      });
      updateConfig((current) => ({ ...current, relayMetadata: { relays: cleaned, updatedAt: nowSeconds() } }));
      setDraft(null);
      toast({ title: 'Relays saved' });
    } catch (error) {
      toast({ title: 'Could not save relays', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    }
  };

  return (
    <Section title="Network relays" description="Where your profile and public data live (NIP-65).">
      <RelayEditor
        relays={uniqueRelays(relays.map((relay) => relay.url))}
        onChange={setUrls}
        renderExtra={(url) => {
          const relay = relays.find((r) => normalizeRelayUrl(r.url) === url);
          if (!relay) return null;
          return (
            <span className="flex gap-1">
              {(['read', 'write'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={relay[key]}
                  onClick={() => toggle(url, key)}
                  className={
                    relay[key]
                      ? 'rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground'
                      : 'rounded-full border px-2 py-0.5 text-xs text-muted-foreground'
                  }
                >
                  {key}
                </button>
              ))}
            </span>
          );
        }}
      />
      {draft && (
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isPending}>
            {isPending && <Loader2 className="animate-spin" />} Save & publish
          </Button>
        </div>
      )}
    </Section>
  );
}

function StorageSection() {
  const { clearLocalCache } = useDM();
  const [confirm, setConfirm] = useState(false);
  const { logout } = useLoginActions();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);

  return (
    <Section title="Account & storage">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3.5">
        <SettingInline label="Clear message cache" description="Remove decrypted messages saved on this device and reload them." />
        <Button variant="outline" onClick={() => setConfirm(true)}>
          <Trash2 /> Clear
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <SettingInline label="Log out" description="Make sure your secret key is backed up first." />
        <Button variant="destructive" onClick={() => setConfirmLogout(true)}>
          <LogOut /> Log out
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the local cache?</AlertDialogTitle>
            <AlertDialogDescription>
              Your messages stay on relays. nostr.buzz will download and decrypt them again, which may ask your signer
              for permission.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clearLocalCache()}>Clear cache</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out of nostr.buzz?</AlertDialogTitle>
            <AlertDialogDescription>
              If you logged in with a secret key (nsec), make sure it's backed up — you'll need it to get back into
              your chats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                void logout();
                navigate('/');
              }}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title="About">
      <div className="flex items-center gap-4 px-4 py-5">
        <BeeMark className="size-14" />
        <div>
          <Wordmark className="text-xl" />
          <p className="text-sm text-muted-foreground">
            Private messaging on Nostr with NIP-17 gift wraps, NIP-44 encryption and encrypted Blossom file uploads.
          </p>
        </div>
      </div>
    </Section>
  );
}
