# Team Suite

Mail on your team's own domain, shared calendars with public booking pages, video meetings and shared file storage, in one private app for your organization.

Inspired by https://workspace.google.com

Built with [oss.new](https://oss.new) for [EveryApp](https://github.com/every-app/every-app).

## Features

- Get a personal address on your domain and read, send, reply, forward, label, star, archive, trash and search mail.
- Keep calendars, share them at free/busy, details or edit level, invite teammates and see their answers.
- Publish booking pages where people outside the team pick a free time and cancel with their own link.
- Start a video meeting with camera, microphone, screen share, chat and host controls.
- Upload, organize, preview and share files and folders with teammates as viewers or editors.
- Ask AI to draft or rewrite a message, or summarize a conversation, when an AI provider is connected.

Left out: document, spreadsheet and slide editors, team chat, meeting recording and other premium meeting extras, enterprise security tools, native and offline apps, add-ons and billing, and accounts and sign-in, which your Gateway handles.

## Setup

```sh
pnpm install
pnpm dev          # run locally
pnpm test         # unit tests
pnpm run deploy   # deploy behind your Gateway
```

After the first deploy, `pnpm everyapp configure team-suite` asks for:

- `MAIL_DOMAIN` (setting): the domain members' addresses are created on. Route its mail to the app with `everyapp email set --inbound '*@<domain>' --enable-email-routing`, and allow sending from it with `everyapp email set --sender '*@<domain>'`.
- `STORAGE_QUOTA_MB` (setting, default 10240): each member's file storage limit.
- `ICE_SERVERS` (optional secret): a JSON list of STUN/TURN servers for meetings between networks that block direct connections.

Mail to outside addresses, invitations and booking confirmations need the Gateway's email sender. AI help needs an AI provider on the Gateway (`everyapp provider add openrouter`).

## Limitations

- Without `ICE_SERVERS`, calls connect only when the browsers can reach each other directly.
- Calls are peer-to-peer and hold up to 8 people.
- Sharing works with members who have opened the app at least once.
- Mail between members is delivered inside the app; mail outside the team needs the Gateway's sender and domain verification. Real delivery and third-party AI were not exercised by the local checks.
