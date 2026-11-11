# LuloSSH

[English](README.md) · **Español**

Cliente SSH para Android (y más adelante iOS), pensado para trabajar en consola
desde el móvil: claves guardadas de forma segura, sincronización cifrada entre
dispositivos y una barra de teclas propia, con una capa para CLIs de IA
(Claude Code y similares).

> Estado: en desarrollo temprano. Aún no hay versión usable.

## Por qué existe LuloSSH

Durante años, JuiceSSH fue nuestra herramienta diaria para administrar
servidores desde el móvil. Nos dio mucha pena que el proyecto se
descontinuara: lo echamos de menos, sobre todo su teclado de consola, que
hacía cómodo trabajar en una terminal desde una pantalla táctil.

LuloSSH nace para recuperar esa experiencia, esta vez como software libre
para que no pueda desaparecer, y adaptada a cómo trabajamos hoy: cada vez más
con asistentes de IA en la terminal.

> LuloSSH es un proyecto independiente. No está afiliado, asociado ni
> respaldado por JuiceSSH ni por Sonelli Ltd. No contiene código de JuiceSSH.

## Características previstas

- Conexión SSH con contraseña o clave (ed25519, RSA, ECDSA).
- Claves privadas cifradas con Android Keystore (Keychain en iOS), con biometría.
- Sincronización de hosts y claves por archivo cifrado de extremo a extremo
  (Google Drive `appDataFolder`; la contraseña maestra nunca sale del dispositivo).
- Terminal completa (xterm.js) y barra de teclas editable por capas.
- Capa "IA": Esc Esc, Shift+Tab, Ctrl+C/D/R, `/`, `@`, `#`, respuestas rápidas.

## Arquitectura

| Capa | Tecnología |
| --- | --- |
| UI y lógica | React Native + TypeScript |
| SSH | Módulo nativo: Kotlin + sshj (Android); Swift (iOS, pendiente) |
| Terminal | xterm.js en WebView |
| Claves | Android Keystore / iOS Keychain |
| Sync | Archivo cifrado (AES-GCM, clave derivada con Argon2) |

El contrato del módulo nativo está en `src/native/SshModule.ts`; cada
plataforma lo implementa por separado.

## Desarrollo

Requisitos: Node 22+, JDK 17 y Android Studio (SDK). Ver la
[guía de entorno de React Native](https://reactnative.dev/docs/set-up-your-development-environment).

```sh
npm install
npm test
npm run android
```

## Licencia

Copyright (C) 2026 Citters Technologies SLU

LuloSSH se distribuye bajo la **GNU Affero General Public License v3.0**
(ver [LICENSE](LICENSE)). Puedes usarlo, modificarlo y redistribuirlo, pero
cualquier versión modificada, incluida la que se ofrezca como servicio en red,
debe publicarse bajo la misma licencia, conservando los avisos de copyright.

### Licencia comercial

Si quieres integrar LuloSSH en un producto propietario o cerrado sin las
obligaciones de la AGPL, puedes adquirir una licencia comercial.
Contacto: hola@citters.com

### Contribuciones

Para poder ofrecer la licencia comercial, las contribuciones externas
requieren aceptar un acuerdo de licencia de contribuidor (CLA) que permita
a los titulares del proyecto relicenciar el código aportado.
Ver [CONTRIBUTING.es.md](CONTRIBUTING.es.md).
