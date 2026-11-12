<p align="center">
  <img src="assets/logo/lulossh-icon.png" alt="LuloSSH logo" width="128" height="128">
</p>

<h1 align="center">LuloSSH</h1>

<p align="center"><strong>English</strong> · <a href="README.es.md">Español</a></p>

An SSH client for Android (iOS later), built for real terminal work from your
phone: securely stored keys, end-to-end encrypted sync across devices, and a
custom terminal key bar with a dedicated layer for AI coding CLIs
(Claude Code and similar).

> Status: early alpha. Works daily on Android. Download the signed APK from
> [Releases](https://github.com/Citters-Technologies/lulossh/releases/latest).

## Why LuloSSH exists

For years, JuiceSSH was our everyday tool for managing servers from a phone.
We were sad to see the project discontinued: we miss it, especially its
terminal keyboard, which made working in a shell on a touchscreen genuinely
comfortable.

LuloSSH is our attempt to bring that experience back, this time as free
software so it can't disappear, and adapted to how we work today: more and
more alongside AI assistants in the terminal.

> LuloSSH is an independent project. It is not affiliated with, associated
> with, or endorsed by JuiceSSH or Sonelli Ltd. It contains no JuiceSSH code.

## Planned features

- SSH with password or key authentication (ed25519, RSA, ECDSA).
- Private keys encrypted with the Android Keystore (Keychain on iOS),
  unlocked with biometrics or the device PIN.
- Host and key sync through an end-to-end encrypted file (Google Drive
  `appDataFolder`); the master password never leaves the device.
- Full terminal emulation (xterm.js) and a layered, editable key bar.
- "AI" layer: Esc Esc, Shift+Tab, Ctrl+C/D/R, `/`, `@`, `#`, quick replies.

## Architecture

| Layer | Technology |
| --- | --- |
| UI and logic | React Native + TypeScript |
| SSH | Native module: Kotlin + sshj (Android); Swift (iOS, planned) |
| Terminal | xterm.js in a WebView |
| Keys | Android Keystore / iOS Keychain |
| Sync | Encrypted file (AES-GCM, Argon2-derived key) |

The native module contract lives in `src/native/SshModule.ts`; each platform
implements it separately.

## Development

Requirements: Node 22+, JDK 17 and the Android SDK. See the
[React Native environment setup guide](https://reactnative.dev/docs/set-up-your-development-environment).

```sh
npm install
npm test
npm run android
```

## License

Copyright (C) 2026 Citters Technologies SLU

LuloSSH is distributed under the **GNU Affero General Public License v3.0**
(see [LICENSE](LICENSE)). You may use, modify and redistribute it, but any
modified version, including one offered as a network service, must be
released under the same license, keeping the copyright notices.

### Commercial license

If you want to embed LuloSSH in a proprietary or closed-source product
without the AGPL obligations, a commercial license is available.
Contact: hola@citters.com

### Contributing

To be able to offer the commercial license, external contributions require
accepting a Contributor License Agreement (CLA) that allows the project
owners to relicense contributed code. See [CONTRIBUTING.md](CONTRIBUTING.md).
