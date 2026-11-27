# nostr.buzz protocol notes

nostr.buzz is a standard [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
private messenger, with a small, backwards-compatible convention for the *BUZZ* feature and two custom
rumor kinds for calls (`1447`, `24837`) and one for read receipts (`9491`), which only ever appear inside
gift wraps.

## Messaging

| What | How |
| --- | --- |
| Chat messages | NIP-17 kind `14` rumors, sealed (kind `13`) and gift-wrapped (kind `1059`) with NIP-44 for every participant and for the sender. |
| Files & photos | NIP-17 kind `15` rumors. Files are encrypted on-device with AES-GCM before being uploaded to Blossom; `decryption-key` and `decryption-nonce` are hex encoded. |
| Reactions | NIP-25 kind `7` rumors inside the same gift wraps, `e` = target, `p` tags = the room's members. |
| Delete for everyone | Kind `5` rumors inside gift wraps (`e` = target, `k` = target kind). Only deletions by the original author are honored. |
| Edits | Delete + republish with the same `created_at` (as suggested by NIP-17). |
| Groups | NIP-17 rooms (author + `p` tags), up to 10 people, optional `subject` tag for the name. |
| Inbox relays | Kind `10050` (NIP-17). Falls back to NIP-65 read relays, then to the app defaults. |
| Legacy | NIP-04 kind `4` messages are read, and 1:1 replies use NIP-04 when the other side only speaks NIP-04. |

## Push notifications

No new event kinds. An optional push server (see [`push-server/`](push-server/README.md)) subscribes to
kind `1059` (and kind `4`) events `p`-tagged to a device's pubkeys and forwards each event unchanged
inside a Web Push message. The service worker unwraps it locally, so the server never sees keys,
senders or text. For logins without a local key (NIP-07, NIP-46) the notification only says "New message".

## Read receipts

A read receipt is a custom rumor kind `9491`, sealed and gift-wrapped (kind `1059`) to the other person
in a one-to-one chat:

```jsonc
{
  "kind": 9491,
  "pubkey": "<reader>",
  "created_at": 1731650300,
  "tags": [
    ["p", "<the other person>"],
    ["until", "1731650000"],            // read everything up to this rumor created_at
    ["alt", "Read receipt"]
  ],
  "content": ""
}
```

- The sender's messages with `created_at <= until` are shown with two ticks.
- Sent only for chats with people the user knows, never in groups, and only if the user allows it.
- Not copied to the sender's own inbox. Clients that don't know the kind ignore it.

## Voice and video calls

One-to-one calls are WebRTC connections. Only the setup travels over Nostr, sealed (kind `13`) and
gift-wrapped like any other private message. Two custom rumor kinds are used:

| Kind | Wrapped in | Purpose |
| --- | --- | --- |
| `1447` call offer | kind `1059` gift wrap | Starts a call. Stored, so it can wake a closed app through push and stays in the chat as a call record. |
| `24837` call signal | kind `21059` ephemeral gift wrap (NIP-59) | Answer, reject, hang up or busy. Only matters to apps that are open. |

```jsonc
// Call offer
{
  "kind": 1447,
  "pubkey": "<caller>",
  "created_at": 1731650000,
  "tags": [
    ["p", "<callee>"],
    ["call-id", "<uuid>"],
    ["call-type", "audio"],            // or "video"
    ["alt", "Voice call"]
  ],
  "content": "<SDP offer, with ICE candidates included>"
}

// Call signal
{
  "kind": 24837,
  "pubkey": "<sender>",
  "tags": [
    ["p", "<the other side>"],
    ["call-id", "<uuid>"],
    ["type", "answer"],                // "ringing" | "answer" | "reject" | "hangup" | "busy" | "restart" | "restart-answer"
    ["alt", "Call signal"]
  ],
  "content": "<SDP for answer, restart and restart-answer, otherwise empty>"
}
```

- Each side sends its complete session description once (no trickle ICE), so a call takes three messages.
- A call rings for 60 seconds from the offer's `created_at`. Older offers are shown as call records only.
- `ringing` tells the caller that the other device is ringing.
- `answer` and `reject` are also wrapped to the sender, so their other devices stop ringing.
- A caller who gives up before an answer also sends `hangup` in a stored kind `1059` wrap, so a closed
  app can turn its "incoming call" notification into "missed call".
- If the media path drops, the caller sends `restart` with a fresh SDP offer (ICE restart) and the callee
  replies with `restart-answer`. Clients keep trying for 30 seconds before ending the call.
- Clients only ring for people the user follows or has chatted with. Offers in groups are ignored.
- Clients that don't know these kinds ignore them: nothing is shown as text.
- Media flows directly between the two devices (DTLS-SRTP), or through a TURN relay when a direct
  path is not possible. A relay only forwards encrypted packets.

## BUZZ

A buzz is an ordinary NIP-17 **kind 14** chat message with a `t` tag of `buzz`:

```jsonc
{
  "kind": 14,
  "pubkey": "<sender>",
  "created_at": 1731650000,
  "tags": [
    ["p", "<recipient>"],
    ["t", "buzz"]
  ],
  "content": "BUZZ!!! 🐝"
}
```

- **Graceful degradation:** clients that don't know about buzzes simply show `BUZZ!!! 🐝` as text.
- **Receiving:** nostr.buzz shakes the app, plays the buzz sound and vibrates, only for buzzes that arrive live
  (rumor `created_at` within ~2 minutes), never for history, and only from people you follow or have replied to
  (unless the user opts in to buzzes from strangers).
- **Rate limit:** the sender's client enforces an 8-second cooldown per conversation.
- For conversations that fall back to NIP-04, the same `["t", "buzz"]` tag is placed on the kind `4` event.

## Groups with their own npub

nostr.buzz groups are NIP-17 chats addressed to a group key instead of a list of people.
No new event kinds are used.

| Key | Who has it | Used for |
| --- | --- | --- |
| identity key | admins | the group's permanent npub; signs the group state |
| epoch key | all members | messages are gift-wrapped to its pubkey; rotated when someone is removed |

### Group state

A kind `30078` (NIP-78) event signed by the identity key:

```jsonc
{
  "kind": 30078,
  "pubkey": "<group identity pubkey>",
  "tags": [["d", "nostr-buzz-group"], ["alt", "Encrypted nostr.buzz group info"]],
  // NIP-44, conversation key between the identity key and the current epoch key
  "content": "<encrypted {name, about?, picture?, members[], admins[], epoch, updatedAt}>"
}
```

Clients must query it with `authors: [<group pubkey>]`. If the content can't be decrypted with any epoch key
the client holds, the user was removed.

- `admins`: members allowed to edit. New admins receive the identity key in an invite. A client only treats
  a key holder as admin while they are listed here.
- Kind `5` deletions from a listed admin remove any message in the group, not only the admin's own.
- `pinned`: message (rumor) ids pinned by admins, newest first.
- `muted`: `{ <pubkey>: <unix seconds> }`. Clients hide messages from a muted member sent at or after that
  time, and disable sending for them.

### Messages

Rumors (kind `14`, `15`, `7`, `5`) carry `["p", <group pubkey>]`. They are sealed by the sender and
gift-wrapped once, to the current epoch pubkey (`["p", <epoch pubkey>]` on the kind `1059`).
Members subscribe to `{"kinds": [1059], "#p": [<epoch pubkeys>]}` on the group relays.
Messages that arrive through an epoch key after it was retired are ignored.

### Invites

Keys are delivered as a normal NIP-17 chat message (kind `14`) to each member:

```jsonc
["t", "buzz-group-invite"],
["group", "<group pubkey>"],
["group-name", "<name>"],
["group-key", "<epoch secret, hex>"],
["group-admin-key", "<identity secret, hex>"], // admins only
["relay", "wss://..."]
```

Other clients show the invite text. Admins also send themselves an invite with the admin key as a backup,
so groups come back on a new device from DM history.

### Invite links

Any member can share `https://nostr.buzz/join/<group npub>#k=<epoch secret>&n=<name>&r=<relay>`.
The key is in the URL fragment, so it is never sent to a server. Whoever opens it gets the current epoch
key and posts a kind `14` message with `["t", "buzz-group-join"]` into the group. Clients count people who
joined through the current epoch as members; admins also add them to the encrypted member list.
Admins can reset links by rotating the epoch key (current members get the new key by invite).
