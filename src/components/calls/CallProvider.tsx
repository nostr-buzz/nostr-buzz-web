import { ChevronDown, Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { UserAvatar } from '@/components/chat/UserAvatar';
import { CallContext, type CallContextValue, type CallPhase } from '@/contexts/CallContext';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { type CallEvent, type CallOffer, type CallSignal, onCallEvent, RING_SECONDS } from '@/lib/calls/protocol';
import { displayName } from '@/lib/format';
import { PUSH_SERVER } from '@/lib/push/client';
import { startRinging } from '@/lib/sounds';
import { cn } from '@/lib/utils';

/** Public STUN servers: enough when at least one side has an ordinary home or office network. */
const STUN_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
/** Don't wait longer than this for network candidates before sending the offer or answer. */
const ICE_WAIT_MS = 3000;
/** How long a dropped call keeps trying to reconnect. */
const RECONNECT_MS = 30_000;
/** How long setting up the media path may take after the call was accepted. */
const CONNECT_MS = 30_000;

interface Session {
  callId: string;
  peer: string;
  video: boolean;
  incoming: boolean;
  /** The caller's connection description (incoming calls). */
  offerSdp?: string;
  /** When the two sides connected (ms). */
  connectedAt?: number;
  /** Why the call ended, shown briefly. */
  ended?: string;
}

let iceCache: { servers: RTCIceServer[]; at: number } | undefined;

/** STUN plus, when the push server offers it, a TURN relay for restrictive networks. */
async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < 10 * 60 * 1000) return iceCache.servers;
  let servers = STUN_SERVERS;
  if (PUSH_SERVER) {
    try {
      const response = await fetch(`${PUSH_SERVER}/ice`, { signal: AbortSignal.timeout(2500) });
      const data = (await response.json()) as { iceServers?: RTCIceServer[] };
      if (response.ok && Array.isArray(data.iceServers) && data.iceServers.length > 0) servers = data.iceServers;
    } catch {
      // No relay available: STUN only.
    }
  }
  iceCache = { servers, at: Date.now() };
  return servers;
}

/** Resolve once the connection has collected its network candidates (or after a short wait). */
function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function mediaError(error: unknown, video: boolean): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return video ? 'Camera or microphone is blocked' : 'Microphone is blocked';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return video ? 'No camera or microphone found' : 'No microphone found';
  return 'Could not start the call';
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Owns the one call that can be in progress: the WebRTC connection, the microphone and
 * camera, ringing, and the full-screen call UI. Signaling goes through the DM engine.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  const { sendCallOffer, sendCallSignal } = useDM();
  const me = user?.pubkey;

  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  /** The other device confirmed it is ringing. */
  const [ringing, setRinging] = useState(false);
  /** The media path dropped and is being re-established. */
  const [reconnecting, setReconnecting] = useState(false);
  /** Shrunk to a bar so the user can keep using the app. */
  const [minimized, setMinimized] = useState(false);

  /** The call the async setup steps belong to; a different id means "this call is over". */
  const activeId = useRef<string | undefined>(undefined);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<{ ring?: number; close?: number; lost?: number; restart?: number }>({});
  /** Asks the caller's side to renegotiate the connection (set while a call is up). */
  const restartRef = useRef<(() => void) | undefined>(undefined);

  const supported = typeof RTCPeerConnection !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const release = useCallback(() => {
    activeId.current = undefined;
    window.clearTimeout(timers.current.ring);
    window.clearTimeout(timers.current.lost);
    timers.current.lost = undefined;
    window.clearInterval(timers.current.restart);
    restartRef.current = undefined;
    pcRef.current?.close();
    pcRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  /** Tear the call down and show why for a moment. */
  const finish = useCallback(
    (reason: string) => {
      release();
      setReconnecting(false);
      setSession((current) => (current ? { ...current, ended: reason } : current));
      setPhase('ended');
      window.clearTimeout(timers.current.close);
      timers.current.close = window.setTimeout(() => {
        setSession(null);
        setPhase('idle');
        setMuted(false);
        setCameraOff(false);
        setFacing('user');
        setRinging(false);
        setMinimized(false);
      }, 1600);
    },
    [release],
  );

  const openPeer = useCallback(
    async (callId: string, video: boolean): Promise<RTCPeerConnection | undefined> => {
      const [stream, servers] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        }),
        iceServers(),
      ]);
      if (activeId.current !== callId) {
        for (const track of stream.getTracks()) track.stop();
        return undefined;
      }
      streamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection({ iceServers: servers });
      pcRef.current = pc;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      pc.addEventListener('track', (event) => {
        if (activeId.current === callId) setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
      });
      let everConnected = false;
      pc.addEventListener('connectionstatechange', () => {
        if (activeId.current !== callId) return;
        const state = pc.connectionState;
        if (state === 'connected') {
          everConnected = true;
          window.clearTimeout(timers.current.ring);
          window.clearTimeout(timers.current.lost);
          window.clearInterval(timers.current.restart);
          timers.current.lost = undefined;
          setReconnecting(false);
          setSession((current) => (current && !current.connectedAt ? { ...current, connectedAt: Date.now() } : current));
          setPhase('active');
        } else if (state === 'failed' && !everConnected) {
          finish('Connection failed');
        } else if ((state === 'disconnected' || state === 'failed') && everConnected && !timers.current.lost) {
          // The network changed or dropped: keep the call and rebuild the media path.
          setReconnecting(true);
          timers.current.lost = window.setTimeout(() => finish('Connection lost'), RECONNECT_MS);
          window.clearInterval(timers.current.restart);
          restartRef.current?.();
          timers.current.restart = window.setInterval(() => restartRef.current?.(), 7000);
        }
      });
      return pc;
    },
    [finish],
  );

  const startCall = useCallback(
    (pubkey: string, video: boolean) => {
      if (!supported || !me || pubkey === me || activeId.current) return;
      const callId = crypto.randomUUID();
      activeId.current = callId;
      window.clearTimeout(timers.current.close);
      setSession({ callId, peer: pubkey, video, incoming: false });
      setPhase('outgoing');
      setCameraOff(false);
      setMuted(false);
      setRinging(false);
      setMinimized(false);

      void (async () => {
        try {
          const pc = await openPeer(callId, video);
          if (!pc) return;
          await pc.setLocalDescription(await pc.createOffer());
          await iceGathered(pc);
          if (activeId.current !== callId) return;
          const sent = await sendCallOffer(pubkey, callId, video, pc.localDescription?.sdp ?? '');
          if (activeId.current !== callId) return;
          if (!sent) {
            finish('Could not reach them');
            return;
          }
          // Only the caller renegotiates, so the two sides never offer at the same time.
          restartRef.current = () => {
            void (async () => {
              try {
                if (activeId.current !== callId || pcRef.current !== pc) return;
                if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
                await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
                await iceGathered(pc);
                if (activeId.current === callId) void sendCallSignal(pubkey, callId, 'restart', pc.localDescription?.sdp ?? '');
              } catch {
                // Still offline: the next attempt may get through.
              }
            })();
          };
          timers.current.ring = window.setTimeout(() => {
            void sendCallSignal(pubkey, callId, 'hangup', '', { store: true });
            finish('No answer');
          }, RING_SECONDS * 1000);
        } catch (error) {
          if (activeId.current === callId) finish(mediaError(error, video));
        }
      })();
    },
    [supported, me, openPeer, sendCallOffer, sendCallSignal, finish],
  );

  const accept = () => {
    if (!session || phase !== 'incoming' || !session.offerSdp) return;
    const { callId, peer, video, offerSdp } = session;
    window.clearTimeout(timers.current.ring);
    setPhase('connecting');
    timers.current.ring = window.setTimeout(() => finish('Could not connect'), CONNECT_MS);
    void (async () => {
      try {
        const pc = await openPeer(callId, video);
        if (!pc) return;
        await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await iceGathered(pc);
        if (activeId.current !== callId) return;
        // The copy to ourselves stops the ringing on our other devices.
        const sent = await sendCallSignal(peer, callId, 'answer', pc.localDescription?.sdp ?? '', { copySelf: true });
        if (activeId.current === callId && !sent) finish('Could not connect');
      } catch (error) {
        if (activeId.current === callId) {
          void sendCallSignal(peer, callId, 'reject');
          finish(mediaError(error, video));
        }
      }
    })();
  };

  const decline = () => {
    if (!session) return;
    void sendCallSignal(session.peer, session.callId, 'reject', '', { copySelf: true });
    finish('Declined');
  };

  const hangUp = () => {
    if (!session || phase === 'ended' || phase === 'idle') return;
    // Giving up before an answer is also stored, so a closed app shows "missed call".
    void sendCallSignal(session.peer, session.callId, 'hangup', '', { store: phase === 'outgoing' });
    finish(phase === 'outgoing' ? 'Cancelled' : 'Call ended');
  };

  const onOffer = useEffectEvent((offer: CallOffer) => {
    if (!supported || !me || offer.from === me) return;
    if (activeId.current) {
      if (activeId.current !== offer.callId) void sendCallSignal(offer.from, offer.callId, 'busy');
      return;
    }
    const remaining = (offer.createdAt + RING_SECONDS) * 1000 - Date.now();
    if (remaining <= 0) return;
    activeId.current = offer.callId;
    window.clearTimeout(timers.current.close);
    setSession({ callId: offer.callId, peer: offer.from, video: offer.video, incoming: true, offerSdp: offer.sdp });
    setPhase('incoming');
    setCameraOff(false);
    setMuted(false);
    setRinging(false);
    setMinimized(false);
    void sendCallSignal(offer.from, offer.callId, 'ringing');
    timers.current.ring = window.setTimeout(() => finish('Missed call'), remaining);
  });

  const onSignal = useEffectEvent((signal: CallSignal) => {
    if (!session || signal.callId !== session.callId || phase === 'ended' || phase === 'idle') return;
    // Our own account, on another device, picked up or declined.
    if (signal.from === me) {
      if (phase === 'incoming' && (signal.type === 'answer' || signal.type === 'reject')) {
        finish(signal.type === 'answer' ? 'Answered on another device' : 'Declined');
      }
      return;
    }
    if (signal.from !== session.peer) return;
    const pc = pcRef.current;
    if (signal.type === 'ringing') {
      if (phase === 'outgoing') setRinging(true);
    } else if (signal.type === 'answer') {
      if (phase !== 'outgoing' || !pc || !signal.sdp) return;
      window.clearTimeout(timers.current.ring);
      setPhase('connecting');
      timers.current.ring = window.setTimeout(() => finish('Could not connect'), CONNECT_MS);
      pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(() => finish('Could not connect'));
    } else if (signal.type === 'restart') {
      // The caller rebuilt its side after a network change: answer with ours.
      if (!pc || !signal.sdp || !session.incoming) return;
      const { peer, callId } = session;
      const offerSdp = signal.sdp;
      void (async () => {
        try {
          await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await iceGathered(pc);
          if (activeId.current === callId) void sendCallSignal(peer, callId, 'restart-answer', pc.localDescription?.sdp ?? '');
        } catch {
          // The caller retries with a new offer.
        }
      })();
    } else if (signal.type === 'restart-answer') {
      if (!pc || !signal.sdp || session.incoming || pc.signalingState !== 'have-local-offer') return;
      pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(() => undefined);
    } else if (signal.type === 'reject') {
      finish('Declined');
    } else if (signal.type === 'busy') {
      finish('Busy');
    } else {
      finish(phase === 'incoming' ? 'Missed call' : 'Call ended');
    }
  });

  useEffect(
    () =>
      onCallEvent((event: CallEvent) => {
        if (event.kind === 'offer') onOffer(event.offer);
        else onSignal(event.signal);
      }),
    [],
  );

  // Back online: don't wait for the next retry.
  useEffect(() => {
    const retry = () => restartRef.current?.();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  // Ring while waiting for someone to pick up.
  useEffect(() => {
    if (phase !== 'incoming' && phase !== 'outgoing') return;
    return startRinging(phase);
  }, [phase]);

  // Leaving the page ends the call for the other side too.
  const leave = useEffectEvent(() => {
    if (session && (phase === 'outgoing' || phase === 'connecting' || phase === 'active')) {
      void sendCallSignal(session.peer, session.callId, 'hangup');
    }
  });
  useEffect(() => {
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      release();
    };
  }, [release]);

  const toggleMute = () => {
    const next = !muted;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = !next;
    setMuted(next);
  };

  const toggleCamera = () => {
    const next = !cameraOff;
    for (const track of localStream?.getVideoTracks() ?? []) track.enabled = !next;
    setCameraOff(next);
  };

  const flipCamera = async () => {
    const pc = pcRef.current;
    const stream = streamRef.current;
    const next = facing === 'user' ? 'environment' : 'user';
    if (!pc || !stream) return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: next } } });
      const [track] = fresh.getVideoTracks();
      const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
      if (!track || !sender || pcRef.current !== pc) {
        for (const item of fresh.getTracks()) item.stop();
        return;
      }
      await sender.replaceTrack(track);
      for (const old of stream.getVideoTracks()) {
        stream.removeTrack(old);
        old.stop();
      }
      track.enabled = !cameraOff;
      stream.addTrack(track);
      setFacing(next);
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch {
      // This device has one camera.
    }
  };

  const value = useMemo<CallContextValue>(() => ({ supported, phase, startCall }), [supported, phase, startCall]);

  return (
    <CallContext.Provider value={value}>
      {children}
      {session && phase !== 'idle' && (
        <CallScreen
          session={session}
          phase={phase}
          localStream={localStream}
          remoteStream={remoteStream}
          muted={muted}
          cameraOff={cameraOff}
          mirrored={facing === 'user'}
          ringing={ringing}
          reconnecting={reconnecting}
          minimized={minimized}
          onMinimize={setMinimized}
          onAccept={accept}
          onDecline={decline}
          onHangUp={hangUp}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onFlipCamera={() => void flipCamera()}
        />
      )}
    </CallContext.Provider>
  );
}

/* --------------------------------- screen --------------------------------- */

interface CallScreenProps {
  session: Session;
  phase: CallPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  mirrored: boolean;
  ringing: boolean;
  reconnecting: boolean;
  minimized: boolean;
  onMinimize: (minimized: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onFlipCamera: () => void;
}

function CallScreen(props: CallScreenProps) {
  const { session, phase, localStream, remoteStream, muted, cameraOff, mirrored, ringing, reconnecting, minimized } = props;
  const author = useAuthor(session.peer);
  const name = displayName(session.peer, author.data?.metadata);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (phase !== 'active') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Keep the screen on during a call.
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    let released = false;
    navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      })
      .catch(() => undefined);
    return () => {
      released = true;
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const kind = session.video ? 'video' : 'voice';
  const status =
    phase === 'ended'
      ? (session.ended ?? 'Call ended')
      : phase === 'incoming'
        ? `Incoming ${kind} call`
        : phase === 'outgoing'
          ? ringing
            ? 'Ringing…'
            : 'Calling…'
          : phase === 'connecting'
            ? 'Connecting…'
            : reconnecting
              ? 'Reconnecting…'
              : formatDuration(now - (session.connectedAt ?? now));

  const showRemoteVideo = session.video && phase === 'active' && !!remoteStream;
  const showLocalVideo = session.video && !!localStream && !cameraOff && phase !== 'ended';

  // Shrinking the call only makes sense once it is under way; a ringing phone stays full screen.
  const canMinimize = phase === 'outgoing' || phase === 'connecting' || phase === 'active';
  const collapsed = minimized && canMinimize;

  return (
    <div
      role="dialog"
      aria-modal={!collapsed}
      aria-label={`${kind === 'video' ? 'Video' : 'Voice'} call with ${name}`}
      className={cn(
        'fixed z-[95] overflow-hidden text-white',
        collapsed
          ? 'inset-x-0 top-0 bg-emerald-700 pt-[env(safe-area-inset-top)] shadow-lg'
          : 'inset-0 flex flex-col bg-stone-950 animate-in fade-in duration-200 motion-reduce:animate-none',
      )}
    >
      {collapsed && (
        <button
          type="button"
          onClick={() => props.onMinimize(false)}
          className="flex w-full items-center justify-center gap-2 px-4 py-2 text-sm font-semibold focus-visible:bg-emerald-600 focus-visible:outline-none"
        >
          {session.video ? <Video className="size-4" /> : <Phone className="size-4" />}
          <span className="max-w-[45%] truncate" dir="auto">
            {name}
          </span>
          <span className="tabular-nums opacity-90">{status}</span>
          <span className="opacity-90">· Tap to return</span>
        </button>
      )}
      {canMinimize && !collapsed && (
        <button
          type="button"
          aria-label="Minimize call"
          onClick={() => props.onMinimize(true)}
          className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20 flex size-11 items-center justify-center rounded-full bg-white/15 backdrop-blur-md hover:bg-white/25 focus-visible:ring-4 focus-visible:ring-white/50 focus-visible:outline-none"
        >
          <ChevronDown className="size-6" />
        </button>
      )}
      {/* The remote stream always plays here: it carries the sound of voice calls too. */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        aria-label={`${name}'s video`}
        className={cn('absolute inset-0 size-full object-cover', (!showRemoteVideo || collapsed) && 'invisible')}
      />
      {!showRemoteVideo && !collapsed && <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-amber-500/25 via-stone-950 to-stone-950" />}

      {showLocalVideo && !collapsed && (
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          aria-label="Your camera"
          className={cn(
            'absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 aspect-[3/4] w-28 rounded-2xl bg-stone-800 object-cover shadow-lg ring-1 ring-white/20 sm:w-36',
            mirrored && '-scale-x-100',
          )}
        />
      )}

      <div
        className={cn(
          'relative z-[5] flex flex-1 flex-col px-6',
          // Over live video the name moves to the top left, clear of the self view.
          showRemoteVideo
            ? 'items-start pt-[max(1.25rem,env(safe-area-inset-top))] pr-36 pl-16 text-left sm:pr-44'
            : 'items-center pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] text-center',
          collapsed && 'hidden',
        )}
      >
        {!showRemoteVideo && <UserAvatar pubkey={session.peer} className={cn('size-32 text-5xl ring-4 ring-white/10', (phase === 'incoming' || phase === 'outgoing') && 'animate-pulse motion-reduce:animate-none')} />}
        <h2 className={cn('max-w-full truncate font-display font-bold drop-shadow', showRemoteVideo ? 'text-xl' : 'mt-6 text-3xl')} dir="auto">
          {name}
        </h2>
        <p role="status" aria-live="polite" className={cn('mt-1 text-white/75 drop-shadow tabular-nums', showRemoteVideo ? 'text-sm' : 'text-lg')}>
          {status}
        </p>
      </div>

      <div className={cn('relative z-[5] flex items-center justify-center gap-5 px-6 pt-6 pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))]', collapsed && 'hidden')}>
        {phase === 'incoming' ? (
          <>
            <RoundButton label="Decline" tone="danger" large onClick={props.onDecline}>
              <PhoneOff className="size-7" />
            </RoundButton>
            <RoundButton label="Accept" tone="accept" large onClick={props.onAccept}>
              {session.video ? <Video className="size-7" /> : <Phone className="size-7" />}
            </RoundButton>
          </>
        ) : phase === 'ended' ? null : (
          <>
            <RoundButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={props.onToggleMute}>
              {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
            </RoundButton>
            {session.video && (
              <>
                <RoundButton label={cameraOff ? 'Turn camera on' : 'Turn camera off'} active={cameraOff} onClick={props.onToggleCamera}>
                  {cameraOff ? <VideoOff className="size-6" /> : <Video className="size-6" />}
                </RoundButton>
                <RoundButton label="Switch camera" className="sm:hidden" onClick={props.onFlipCamera}>
                  <SwitchCamera className="size-6" />
                </RoundButton>
              </>
            )}
            <RoundButton label="Hang up" tone="danger" large onClick={props.onHangUp}>
              <PhoneOff className="size-7" />
            </RoundButton>
          </>
        )}
      </div>
    </div>
  );
}

function RoundButton({
  label,
  tone = 'neutral',
  active,
  large,
  className,
  onClick,
  children,
}: {
  label: string;
  tone?: 'neutral' | 'danger' | 'accept';
  active?: boolean;
  large?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={tone === 'neutral' ? !!active : undefined}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full shadow-lg backdrop-blur-md transition-transform active:scale-95 focus-visible:ring-4 focus-visible:ring-white/50 focus-visible:outline-none motion-reduce:transition-none',
        large ? 'size-[4.5rem]' : 'size-14',
        tone === 'danger' && 'bg-red-600 text-white hover:bg-red-500',
        tone === 'accept' && 'bg-emerald-600 text-white hover:bg-emerald-500',
        tone === 'neutral' && (active ? 'bg-white text-stone-950' : 'bg-white/15 text-white hover:bg-white/25'),
        className,
      )}
    >
      {children}
    </button>
  );
}
