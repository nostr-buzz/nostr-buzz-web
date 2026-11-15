import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { BUZZ_EVENT, BuzzContext, type BuzzContextValue, type BuzzEffectOptions } from '@/contexts/BuzzContext';
import { useAuthor } from '@/hooks/useAuthor';
import { useChatSettings } from '@/hooks/useChatSettings';
import { conversationRoute } from '@/lib/dm/conversation';
import { displayName } from '@/lib/format';
import { BUZZ_VIBRATION, playBuzzSound, primeAudio, vibrate } from '@/lib/sounds';

interface Toast extends BuzzEffectOptions {
  key: number;
}

/**
 * Owns the "BUZZ!!!" experience: shakes everything rendered inside it, plays the
 * buzz sound, vibrates phones and shows a tappable toast. If a buzz arrives while
 * the tab is hidden, the shake is replayed when the user comes back (within 60s).
 */
export function BuzzProvider({ children }: { children: ReactNode }) {
  const { settings } = useChatSettings();
  const shellRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  const pendingRef = useRef<{ options: BuzzEffectOptions; at: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  });

  const shake = useCallback((outgoing: boolean) => {
    const element = shellRef.current;
    if (!element || !settingsRef.current.buzzShake) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const className = outgoing ? 'buzz-shake-soft' : 'buzz-shake';
    element.classList.remove('buzz-shake', 'buzz-shake-soft');
    // Force a reflow so back-to-back buzzes restart the animation.
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), 1000);
  }, []);

  const triggerBuzz = useCallback(
    (options: BuzzEffectOptions) => {
      const current = settingsRef.current;
      if (current.buzzSound) playBuzzSound();
      // Let any animated 3D bees on screen join in.
      window.dispatchEvent(new Event(BUZZ_EVENT));

      if (options.outgoing) {
        shake(true);
        return;
      }

      if (current.vibrate) vibrate(BUZZ_VIBRATION);
      if (document.visibilityState === 'hidden') {
        pendingRef.current = { options, at: Date.now() };
      } else {
        shake(false);
      }
      setToast({ ...options, key: Date.now() });
    },
    [shake],
  );

  // Replay a buzz that arrived while the tab was in the background.
  useEffect(() => {
    const onVisibility = () => {
      const pending = pendingRef.current;
      if (document.visibilityState !== 'visible' || !pending) return;
      pendingRef.current = null;
      if (Date.now() - pending.at < 60_000) {
        shake(false);
        setToast({ ...pending.options, key: Date.now() });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [shake]);

  // Browsers only allow audio after a gesture: unlock it on the first interaction.
  useEffect(() => {
    const unlock = () => primeAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo<BuzzContextValue>(() => ({ triggerBuzz }), [triggerBuzz]);

  return (
    <BuzzContext.Provider value={value}>
      <div ref={shellRef} className="buzz-shell">
        {children}
      </div>
      {toast && <BuzzToast key={toast.key} toast={toast} onClose={() => setToast(null)} />}
    </BuzzContext.Provider>
  );
}

function BuzzToast({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const navigate = useNavigate();
  const author = useAuthor(toast.from);
  const name = toast.from ? displayName(toast.from, author.data?.metadata) : 'Someone';

  return (
    <>
      <div className="buzz-flash pointer-events-none fixed inset-0 z-[90]" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          role="status"
          aria-live="assertive"
          onClick={() => {
            if (toast.conversationId) navigate(conversationRoute(toast.conversationId));
            onClose();
          }}
          className="buzz-toast-in pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border border-amber-300/70 bg-amber-300 px-4 py-3 text-left text-stone-950 shadow-xl shadow-amber-500/30 outline-none focus-visible:ring-4 focus-visible:ring-stone-950/40"
        >
          <img src="/bee.png" alt="" className="bee-wiggle size-12 shrink-0 drop-shadow" />
          <span className="min-w-0">
            <span className="block font-display text-xl font-extrabold tracking-tight">BUZZ!!!</span>
            <span className="block truncate text-sm font-medium">{name} buzzed you · tap to open</span>
          </span>
        </button>
      </div>
    </>
  );
}
