import { type ReactNode, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/lib/utils';

const CATEGORIES: { id: string; label: string; icon: string; emojis: string[] }[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis:
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 👻 👽 🤖 💩'.split(' '),
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👍',
    emojis:
      '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 🫶 ✍️ 💅 🤳 👀 🧠 🫡 🙈 🙉 🙊'.split(' '),
  },
  {
    id: 'hearts',
    label: 'Hearts & sparkle',
    icon: '❤️',
    emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 🔥 ✨ ⭐ 🌟 💫 💯 💥 💢 💤 🎉 🎊'.split(' '),
  },
  {
    id: 'nature',
    label: 'Bees & nature',
    icon: '🐝',
    emojis:
      '🐝 🍯 🌻 🌼 🌸 🌺 🌹 🌷 🦋 🐞 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦄 🐢 🐍 🐙 🐬 🐳 🌈 ☀️ 🌙 ⚡ ❄️ 🌊 🌵 🍀'.split(' '),
  },
  {
    id: 'food',
    label: 'Food & drink',
    icon: '🍕',
    emojis:
      '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🌶️ 🌽 🥕 🍞 🧀 🍳 🍔 🍟 🍕 🌭 🌮 🍣 🍜 🍰 🎂 🍩 🍪 🍫 🍬 🍭 ☕ 🍵 🧋 🍺 🍷 🥂'.split(' '),
  },
  {
    id: 'activity',
    label: 'Activity & objects',
    icon: '⚽',
    emojis:
      '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🎮 🎲 🧩 🎯 🎸 🎹 🎤 🎧 🎬 🎨 🏆 🥇 🎁 🎈 🚀 ✈️ 🚗 🏠 ⏰ 💡 📱 💻 📷 💰 💸 🔑 🔒 📚 ✏️ 🗓️'.split(' '),
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '✅',
    emojis: '✅ ❌ ❓ ❗ ⚠️ 🚫 💬 💭 🔔 🔕 📌 📎 🔗 ➕ ➖ ✔️ ☑️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🆗 🆕 🆒 ♻️ 🏁'.split(' '),
  },
];

const MAX_RECENT = 24;

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

export function EmojiPicker({ onSelect, children, align = 'start' }: EmojiPickerProps) {
  const [recent, setRecent] = useLocalStorage<string[]>('nostr-buzz:recent-emoji', []);
  const [active, setActive] = useState(recent.length > 0 ? 'recent' : 'smileys');
  const categories = recent.length > 0 ? [{ id: 'recent', label: 'Recently used', icon: '🕘', emojis: recent }, ...CATEGORIES] : CATEGORIES;
  const current = categories.find((category) => category.id === active) ?? categories[0];

  const pick = (emoji: string) => {
    setRecent((previous) => [emoji, ...previous.filter((item) => item !== emoji)].slice(0, MAX_RECENT));
    onSelect(emoji);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} side="top" className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <div role="tablist" aria-label="Emoji categories" className="flex gap-0.5 overflow-x-auto border-b p-1.5 scrollbar-thin">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={category.id === current.id}
              aria-label={category.label}
              title={category.label}
              onClick={() => setActive(category.id)}
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                category.id === current.id && 'bg-accent',
              )}
            >
              {category.icon}
            </button>
          ))}
        </div>
        <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">{current.label}</p>
        <div role="tabpanel" className="grid max-h-60 grid-cols-8 gap-0.5 overflow-y-auto p-2 scrollbar-thin">
          {current.emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => pick(emoji)}
              aria-label={emoji}
              className="flex aspect-square items-center justify-center rounded-lg text-2xl transition-transform hover:scale-110 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:hover:scale-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
