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
import type { ChatSettings, MessageTone, Theme } from '@/contexts/AppContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useBuzz } from '@/hooks/useBuzz';
import { useChatSettings } from '@/hooks/useChatSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useDMRelayInfo, usePublishInboxRelays } from '@/hooks/useDMRelays';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePushStatus } from '@/hooks/usePushSync';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { APP_BUILT_AT, APP_VERSION, applyUpdate, checkForUpdate } from '@/lib/appUpdate';
import { nowSeconds } from '@/lib/dm/nip17';
import { DEFAULT_INBOX_RELAYS, MAX_INBOX_RELAYS, uniqueRelays } from '@/lib/dm/relays';
import { displayName, shortNpub } from '@/lib/format';
import { normalizeRelayUrl } from '@/lib/sanitize';
import { requestNotificationPermission, sendTestPush } from '@/lib/push/client';
import { MESSAGE_TONE_NAMES, playMessageSound } from '@/lib/sounds';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  if (!user) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-muted/30">
      <header className="app-bar gap-2 border-b bg-background/90 px-2 backdrop-blur-md md:px-6">
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

/** Numbers that explain how the app fits this screen (useful when reporting a layout problem). */
function screenInfo(): { short: boolean; text: string } {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = `${Math.round(parseFloat(style.paddingTop))}/${Math.round(parseFloat(style.paddingBottom))}`;
  probe.remove();
  return {
    short: document.documentElement.hasAttribute('data-short-viewport'),
    text: `Screen ${window.screen.width}×${window.screen.height} · app area ${window.innerWidth}×${window.innerHeight} · insets ${insets}`,
  };
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [fillScreen, setFillScreen] = useSetting('fillScreen');
  const [screen] = useState(screenInfo);
  return (
    <Section title="Appearance">
      <div className="flex flex-col gap-3 px-4 py-4">
        <span className="font-medium">Theme</span>
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(value) => value && setTheme(value as Theme)}
          variant="outline"
          aria-label="Theme"
          className="w-full"
        >
          <ToggleGroupItem value="light" aria-label="Light" className="flex-1 gap-1.5 px-3">
            <Sun className="size-4" /> Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark" className="flex-1 gap-1.5 px-3">
            <Moon className="size-4" /> Dark
          </ToggleGroupItem>
          <ToggleGroupItem value="system" aria-label="System" className="flex-1 gap-1.5 px-3">
            <Monitor className="size-4" /> Auto
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {(screen.short || fillScreen) && (
        <div className="border-t">
          <SettingSwitch
            label="Fill the whole screen"
            description="Removes the empty strip at the bottom. Turn it off if the message box gets hidden."
            checked={fillScreen}
            onCheckedChange={setFillScreen}
          />
        </div>
      )}
    </Section>
  );
}

function BuzzSection() {
  const { triggerBuzz } = useBuzz();
  const [buzzSound, setBuzzSound] = useSetting('buzzSound');
  const [buzzShake, setBuzzShake] = useSetting('buzzShake');
  const [vibrate, setVibrate] = useSetting('vibrate');

  return (
    <Section title="Buzz">
      <div className="flex items-center gap-4 border-b bg-amber-50 px-4 py-4 dark:bg-amber-400/10">
        <BeeMark className="size-12 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">Test your buzz</span>
          <span className="text-muted-foreground">Try it on yourself.</span>
        </p>
        <Button className="rounded-full" onClick={() => triggerBuzz({})}>
          Buzz me
        </Button>
      </div>
      <SettingSwitch label="Buzz sound" checked={buzzSound} onCheckedChange={setBuzzSound} />
      <SettingSwitch label="Shake the screen" checked={buzzShake} onCheckedChange={setBuzzShake} />
      <SettingSwitch label="Vibrate" description="On supported phones" checked={vibrate} onCheckedChange={setVibrate} />
    </Section>
  );
}

/** Title with its description underneath, taking the room left of a row's button. */
function SettingInline({ label, description }: { label: string; description: string }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block font-medium">{label}</span>
      <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
    </div>
  );
}

function NotificationsSection() {
  const { toast } = useToast();
  const [notifications, setNotifications] = useSetting('notifications');
  const [previews, setPreviews] = useSetting('notificationPreviews');
  const [pushEnabled, setPushEnabled] = useSetting('pushNotifications');
  const [systemSound, setSystemSound] = useSetting('notificationSound');
  const [messageSound, setMessageSound] = useSetting('messageSound');
  const [tone, setTone] = useSetting('messageTone');
  const { user } = useCurrentUser();
  const push = usePushStatus();
  const [testing, setTesting] = useState(false);
  const on = notifications && push.supported && push.permission === 'granted';

  const toggle = async (value: boolean) => {
    if (!value) {
      setNotifications(false);
      return;
    }
    const permission = await requestNotificationPermission();
    if (permission === 'granted') setNotifications(true);
    else toast({ title: 'Notifications are blocked', description: 'Allow them for this site in your browser settings.', variant: 'destructive' });
  };

  const test = async () => {
    setTesting(true);
    try {
      await sendTestPush();
      toast({ title: 'Test sent' });
    } catch (error) {
      toast({ title: 'Test failed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const status = push.needsInstall
    ? 'Add nostr.buzz to your Home Screen first (Share, then Add to Home Screen).'
    : !push.supported
      ? 'Not supported in this browser.'
      : push.permission === 'denied'
        ? 'Blocked. Allow notifications in your browser settings.'
        : 'Messages and buzzes';

  const pushStatus = !push.serverConfigured
    ? 'Not available in this build'
    : !on || !pushEnabled
      ? 'Get messages when nostr.buzz is closed'
      : push.delivery === 'push'
        ? 'On. This device is registered.'
        : push.delivery === 'error'
          ? 'Push server unreachable. Trying again later.'
          : 'Connecting…';

  return (
    <Section title="Notifications">
      <SettingSwitch
        label="Notifications"
        description={status}
        checked={on}
        onCheckedChange={(value) => void toggle(value)}
        disabled={!push.supported || push.permission === 'denied'}
      />
      <SettingSwitch
        label="Push when the app is closed"
        description={pushStatus}
        checked={on && pushEnabled && push.serverConfigured}
        onCheckedChange={setPushEnabled}
        disabled={!on || !push.serverConfigured}
      />
      <SettingSwitch
        label="Show message preview"
        description={user?.method === 'nsec' ? 'Name and text in the notification' : 'This login keeps closed-app alerts generic'}
        checked={previews}
        onCheckedChange={setPreviews}
        disabled={!on}
      />
      <SettingSwitch
        label="Notification sound"
        description="Your device's sound. Off shows them silently."
        checked={systemSound}
        onCheckedChange={setSystemSound}
        disabled={!on}
      />
      <SettingSwitch
        label="In-app sound"
        description="For new messages while nostr.buzz is open"
        checked={messageSound}
        onCheckedChange={setMessageSound}
      />
      <div className="flex flex-col gap-3 border-b px-4 py-3.5">
        <span className={cn('font-medium', !messageSound && 'text-muted-foreground')}>Tone</span>
        <ToggleGroup
          type="single"
          value={tone}
          onValueChange={(value) => {
            if (!value) return;
            setTone(value as MessageTone);
            playMessageSound(value as MessageTone);
          }}
          variant="outline"
          aria-label="In-app sound tone"
          className="w-full"
          disabled={!messageSound}
        >
          {MESSAGE_TONE_NAMES.map((name) => (
            <ToggleGroupItem key={name} value={name} className="flex-1 px-3 capitalize">
              {name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <SettingInline label="Test" description="Send yourself a notification" />
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => void test()} disabled={!on || testing}>
          {testing ? <Loader2 className="animate-spin" /> : null} Send test
        </Button>
      </div>
    </Section>
  );
}

function PrivacySection() {
  const [enterToSend, setEnterToSend] = useSetting('enterToSend');
  const [strangers, setStrangers] = useSetting('buzzFromStrangers');
  const [legacy, setLegacy] = useSetting('legacyDMs');
  const [receipts, setReceipts] = useSetting('readReceipts');

  return (
    <Section title="Chats & privacy">
      <SettingSwitch label="Enter to send" description="Shift + Enter for a new line" checked={enterToSend} onCheckedChange={setEnterToSend} />
      <SettingSwitch
        label="Read receipts"
        description="Show others two ticks when you read their messages"
        checked={receipts}
        onCheckedChange={setReceipts}
      />
      <SettingSwitch
        label="Buzzes from strangers"
        description="From people you don't follow"
        checked={strangers}
        onCheckedChange={setStrangers}
      />
      <SettingSwitch
        label="Legacy direct messages"
        description="Older NIP-04 messages"
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
      description="Where you receive messages. Use 1 to 3 relays."
    >
      {info.isLoading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your inbox…
        </div>
      ) : (
        <>
          {current.length === 0 && draft === null && (
            <p className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
              No inbox published yet.
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
    <Section title="Network relays" description="For your profile and public data.">
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
        <SettingInline label="Clear message cache" description="Reload messages from relays" />
        <Button variant="outline" className="shrink-0" onClick={() => setConfirm(true)}>
          <Trash2 /> Clear
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <SettingInline label="Log out" description="Back up your key first" />
        <Button variant="destructive" className="shrink-0" onClick={() => setConfirmLogout(true)}>
          <LogOut /> Log out
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the local cache?</AlertDialogTitle>
            <AlertDialogDescription>
              Messages will reload from relays.
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
              Back up your secret key (nsec) first.
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
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const built = new Date(APP_BUILT_AT);
  const [display] = useState(screenInfo);

  const check = async () => {
    setChecking(true);
    const available = await checkForUpdate();
    setChecking(false);
    if (available) applyUpdate();
    else toast({ title: "You're up to date" });
  };

  return (
    <Section title="About">
      <div className="flex items-center gap-4 border-b px-4 py-5">
        <BeeMark className="size-14" />
        <div>
          <Wordmark className="text-xl" />
          <p className="text-sm text-muted-foreground">
            Private chats on Nostr.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <SettingInline
          label="Version"
          description={`${APP_VERSION.split('-')[0]}${Number.isNaN(built.getTime()) ? '' : ` · ${built.toLocaleDateString()}`}`}
        />
        <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => void check()} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : null} Check now
        </Button>
      </div>
      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{display.text}</p>
    </Section>
  );
}
