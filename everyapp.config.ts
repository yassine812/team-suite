import { defineEveryApp } from "@every-app/sdk";

export default defineEveryApp({
  id: "team-suite",
  name: "Team Suite",
  description:
    "Team mail on your own domain, shared calendars with booking pages, video meetings and shared file storage.",
  access: "everyone",
  resources: {
    d1: ["DB"],
    r2: ["files"],
    durableObjects: [{ name: "ROOMS", className: "MeetingRoom" }],
  },
  public: [
    { path: "/b/:slug" },
    { path: "/b/:slug/slots" },
    { path: "/b/:slug/book", methods: ["POST"] },
    { path: "/b/cancel/:token", methods: ["GET", "POST"] },
  ],
  publicAssets: ["/assets/**", "/icon.svg"],
  capabilities: {
    email: {
      access: "write",
      why: "Sends members' mail to addresses outside the team, calendar invitations and booking confirmations.",
    },
  },
  email: { inbound: true },
  providers: [
    {
      id: "openrouter",
      why: "Drafts, rewrites and summarizes mail when a member asks.",
      docs: "https://openrouter.ai/keys",
    },
  ],
  settings: [
    {
      name: "MAIL_DOMAIN",
      type: "text",
      why: "Members' addresses are created on this domain.",
      how: "The domain whose mail Email Routing delivers to this app, such as team.example.com.",
    },
    {
      name: "STORAGE_QUOTA_MB",
      type: "number",
      default: "10240",
      why: "Each member's file storage limit, in megabytes.",
    },
  ],
  features: {
    ai: {
      name: "AI writing help",
      why: "Drafts, rewrites and summarizes mail.",
      providers: ["openrouter"],
    },
    relay: {
      name: "Meeting relay",
      why: "Connects calls between networks that block direct connections.",
      secrets: [
        {
          name: "ICE_SERVERS",
          how: "A JSON list of STUN/TURN servers with urls, username and credential, from your TURN provider.",
        },
      ],
    },
  },
});
