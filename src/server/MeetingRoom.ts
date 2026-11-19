import { DurableObject } from "cloudflare:workers";
import { endRoom } from "./meet";

export const MAX_PARTICIPANTS = 8;

interface Peer {
  id: string;
  userId: string;
  email: string;
  creator: boolean;
  muted: boolean;
  cameraOff: boolean;
  socket: WebSocket;
}

/** One meeting room: relays WebRTC signalling and chat between the people in it. */
export class MeetingRoom extends DurableObject<Env> {
  private peers = new Map<string, Peer>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.pathname.split("/")[2]!;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    if (await this.ctx.storage.get<boolean>("ended")) {
      server.send(JSON.stringify({ type: "ended" }));
      server.close(1000, "ended");
      return new Response(null, { status: 101, webSocket: client });
    }
    if (this.peers.size >= MAX_PARTICIPANTS) {
      server.send(JSON.stringify({ type: "full", max: MAX_PARTICIPANTS }));
      server.close(1000, "full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const peer: Peer = {
      id: crypto.randomUUID(),
      userId: url.searchParams.get("uid") ?? "",
      email: url.searchParams.get("email") ?? "",
      creator: url.searchParams.get("creator") === "1",
      muted: false,
      cameraOff: false,
      socket: server,
    };
    this.peers.set(peer.id, peer);
    server.send(JSON.stringify({ type: "welcome", id: peer.id, creator: peer.creator }));
    this.broadcastPeers();
    server.addEventListener("message", (event) => {
      void this.onMessage(peer, code, typeof event.data === "string" ? event.data : "");
    });
    const leave = () => {
      if (this.peers.get(peer.id) === peer) {
        this.peers.delete(peer.id);
        this.broadcastPeers();
      }
    };
    server.addEventListener("close", leave);
    server.addEventListener("error", leave);
    return new Response(null, { status: 101, webSocket: client });
  }

  private list() {
    return [...this.peers.values()].map(({ id, email, creator, muted, cameraOff }) => ({ id, email, creator, muted, cameraOff }));
  }

  private broadcastPeers() {
    const payload = JSON.stringify({ type: "peers", peers: this.list() });
    for (const p of this.peers.values()) this.safeSend(p.socket, payload);
  }

  private safeSend(socket: WebSocket, data: string) {
    try {
      socket.send(data);
    } catch {
      // A socket that closed mid-send leaves on its close event.
    }
  }

  private async onMessage(peer: Peer, code: string, data: string) {
    let msg: { type?: string; to?: string; data?: unknown; text?: string; id?: string; muted?: boolean; cameraOff?: boolean };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "signal": {
        const target = msg.to ? this.peers.get(msg.to) : undefined;
        if (target) this.safeSend(target.socket, JSON.stringify({ type: "signal", from: peer.id, data: msg.data }));
        break;
      }
      case "chat": {
        const text = String(msg.text ?? "").slice(0, 2000).trim();
        if (!text) return;
        const payload = JSON.stringify({ type: "chat", from: peer.email, text, at: new Date().toISOString() });
        for (const p of this.peers.values()) this.safeSend(p.socket, payload);
        break;
      }
      case "state":
        peer.muted = !!msg.muted;
        peer.cameraOff = !!msg.cameraOff;
        this.broadcastPeers();
        break;
      case "remove": {
        if (!peer.creator) return;
        const target = msg.id ? this.peers.get(msg.id) : undefined;
        if (!target || target.id === peer.id) return;
        this.peers.delete(target.id);
        this.safeSend(target.socket, JSON.stringify({ type: "removed" }));
        target.socket.close(1000, "removed");
        this.broadcastPeers();
        break;
      }
      case "end": {
        if (!peer.creator) return;
        await this.ctx.storage.put("ended", true);
        await endRoom(code);
        for (const p of this.peers.values()) {
          this.safeSend(p.socket, JSON.stringify({ type: "ended" }));
          p.socket.close(1000, "ended");
        }
        this.peers.clear();
        break;
      }
    }
  }
}
