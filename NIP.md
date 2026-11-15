# nostr.buzz protocol notes

nostr.buzz does **not** define any new event kinds. It is a standard [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
private messenger, with one small, backwards-compatible convention for the *BUZZ* feature.

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
