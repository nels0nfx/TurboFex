# TurboFex store: what to do if the signing key is lost or leaked

The store list is signed with a secret key that lives only on your phone. Bots only trust a list signed by a key they know.
To be safe, the bot can know TWO keys: the main one and a spare. Set up the spare once, now, while everything is fine.

## Set up the spare key (once)
1. Make a second key in a different folder:
   `TFX_REGISTRY_KEYDIR=~/.turbofex-registry-spare node tools/registry.js keygen`
2. Back it up the same way as the first (use another passphrase if you like):
   `TFX_REGISTRY_KEYDIR=~/.turbofex-registry-spare TFX_PASSPHRASE="long secret" node tools/registry.js backup ~/registry-spare-backup.json`
   Keep this file away from the phone. Never put the spare key on the same cloud account as the main backup.
3. Show its public part: `TFX_REGISTRY_KEYDIR=~/.turbofex-registry-spare node tools/registry.js publickey`
4. Send that public key to your AI helper. It goes into `core/plugins/registry-key.json` as `"backupKeys": ["-----BEGIN PUBLIC KEY-----..."]` in the next bot release. Public keys are safe to share.

## If the main key is lost or leaked
1. Sign the store with the spare key: add `TFX_REGISTRY_KEYDIR=~/.turbofex-registry-spare` in front of the usual `registry.js` commands (for example `pull`, `verify`). Bots accept it right away, no bot update needed.
2. If the main key was LEAKED (not just lost): make a new spare key, then release a bot update where the spare becomes the main key and the leaked one is removed. Until bots update, they still trust the leaked key, so move fast and tell owners to update (`.update`).
3. Check with `node tools/registry.js verify <registry-folder>`.

## Rules
- Never put a private key (key.pem) in GitHub, a zip, or a chat.
- Only the public key text ("BEGIN PUBLIC KEY") ever goes into the bot.
