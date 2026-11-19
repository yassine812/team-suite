import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic, MicOff, MonitorUp, PhoneOff, Send, Video, VideoOff } from "lucide-react";
import { AppShell } from "@/client/components/AppShell";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { CopyButton } from "@/client/components/CopyButton";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getRoom } from "@/serverFunctions/meet";

export const Route = createFileRoute("/meet/$code")({
  ssr: false,
  loader: ({ params }) => getRoom({ data: { code: params.code } }),
  component: RoomPage,
});

interface Peer {
  id: string;
  email: string;
  creator: boolean;
  muted: boolean;
  cameraOff: boolean;
}

function RoomPage() {
  const room = Route.useLoaderData();
  const { code } = Route.useParams();
  const [joined, setJoined] = useState(false);
  if (!room)
    return (
      <AppShell>
        <EmptyState kind="error" title="Meeting not found" />
      </AppShell>
    );
  return (
    <AppShell wide>
      <PageHeader
        backLink={<BackLink to="/meet">Meetings</BackLink>}
        title={room.title}
        description={
          <span className="flex items-center gap-1">
            <span data-testid="meeting-link">{room.link}</span>
            <CopyButton value={room.link} successMessage="Link copied" label="Copy link" />
          </span>
        }
      />
      {room.ended ? (
        <div data-testid="call-ended">
          <EmptyState title="This meeting has ended" action={<Button variant="outline" render={<Link to="/meet" />} nativeButton={false}>Back to Meetings</Button>} />
        </div>
      ) : joined ? (
        <Call code={code} isCreator={room.isCreator} iceServers={room.iceServers} />
      ) : (
        <div className="flex justify-center py-10">
          <Button size="lg" onClick={() => setJoined(true)}>
            <Video />
            Join
          </Button>
        </div>
      )}
    </AppShell>
  );
}

function Call({ code, isCreator, iceServers }: { code: string; isCreator: boolean; iceServers: RTCIceServer[] }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [chat, setChat] = useState<{ from: string; text: string; at: string }[]>([]);
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [noMedia, setNoMedia] = useState(false);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const ws = useRef<WebSocket | null>(null);
  const local = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const conns = useRef(new Map<string, RTCPeerConnection>());
  const localVideo = useRef<HTMLVideoElement>(null);
  const self = useRef<string | null>(null);

  useEffect(() => {
    let closed = false;
    const send = (data: unknown) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(data));

    function connection(peerId: string) {
      let pc = conns.current.get(peerId);
      if (pc) return pc;
      pc = new RTCPeerConnection({ iceServers });
      conns.current.set(peerId, pc);
      for (const track of local.current?.getTracks() ?? []) pc.addTrack(track, local.current!);
      pc.onicecandidate = (e) => e.candidate && send({ type: "signal", to: peerId, data: { candidate: e.candidate } });
      pc.ontrack = (e) => setStreams((s) => ({ ...s, [peerId]: e.streams[0]! }));
      pc.onnegotiationneeded = async () => {
        if (!self.current || self.current > peerId) return;
        await pc!.setLocalDescription(await pc!.createOffer());
        send({ type: "signal", to: peerId, data: { description: pc!.localDescription } });
      };
      return pc;
    }

    async function start() {
      try {
        local.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (localVideo.current) localVideo.current.srcObject = local.current;
      } catch {
        setNoMedia(true);
      }
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${location.host}/meet/${code}/socket`);
      ws.current = socket;
      socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "welcome") {
          self.current = msg.id;
          setSelfId(msg.id);
        } else if (msg.type === "peers") {
          const list = msg.peers as Peer[];
          setPeers(list);
          for (const p of list) if (p.id !== self.current) {
            const pc = connection(p.id);
            // The peer with the lower id offers, once.
            if (self.current! < p.id && !pc.localDescription && pc.signalingState === "stable") {
              if (!local.current) pc.addTransceiver("video", { direction: "recvonly" });
              await pc.setLocalDescription(await pc.createOffer());
              send({ type: "signal", to: p.id, data: { description: pc.localDescription } });
            }
          }
          for (const id of [...conns.current.keys()]) if (!list.some((p) => p.id === id)) {
            conns.current.get(id)?.close();
            conns.current.delete(id);
            setStreams((s) => { const n = { ...s }; delete n[id]; return n; });
          }
        } else if (msg.type === "signal") {
          const pc = connection(msg.from);
          if (msg.data.description) {
            await pc.setRemoteDescription(msg.data.description);
            if (msg.data.description.type === "offer") {
              await pc.setLocalDescription(await pc.createAnswer());
              send({ type: "signal", to: msg.from, data: { description: pc.localDescription } });
            }
          } else if (msg.data.candidate) {
            await pc.addIceCandidate(msg.data.candidate).catch(() => undefined);
          }
        } else if (msg.type === "chat") {
          setChat((c) => [...c, { from: msg.from, text: msg.text, at: msg.at }]);
        } else if (msg.type === "removed") {
          setEnded("You were removed from this meeting.");
        } else if (msg.type === "ended") {
          setEnded("This meeting has ended.");
        } else if (msg.type === "full") {
          setEnded(`This meeting is full (${msg.max} people).`);
        }
      };
    }
    void start();
    return () => {
      closed = true;
      ws.current?.close();
      for (const pc of conns.current.values()) pc.close();
      conns.current.clear();
      for (const t of [...(local.current?.getTracks() ?? []), ...(screen.current?.getTracks() ?? [])]) t.stop();
    };
  }, [code]);

  useEffect(() => {
    if (!ended) return;
    ws.current?.close();
    for (const pc of conns.current.values()) pc.close();
    for (const t of local.current?.getTracks() ?? []) t.stop();
  }, [ended]);

  function sendState(next: { muted: boolean; cameraOff: boolean }) {
    ws.current?.send(JSON.stringify({ type: "state", ...next }));
  }

  async function shareScreen() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screen.current = display;
      const track = display.getVideoTracks()[0]!;
      for (const pc of conns.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(track);
        else pc.addTrack(track, display);
      }
      if (localVideo.current) localVideo.current.srcObject = display;
      track.onended = async () => {
        const cam = local.current?.getVideoTracks()[0] ?? null;
        for (const pc of conns.current.values()) {
          const sender = pc.getSenders().find((s) => s.track === track);
          if (sender) await sender.replaceTrack(cam);
        }
        if (localVideo.current) localVideo.current.srcObject = local.current;
      };
    } catch {
      // Picking nothing to share is not an error.
    }
  }

  if (ended)
    return (
      <div data-testid="call-ended">
        <EmptyState title={ended} action={<Button variant="outline" render={<Link to="/meet" />} nativeButton={false}>Back to Meetings</Button>} />
      </div>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Tile label="You" muted={muted} cameraOff={cameraOff || noMedia}>
            <video ref={localVideo} autoPlay playsInline muted className="size-full object-cover" />
          </Tile>
          {peers.filter((p) => p.id !== selfId).map((p) => (
            <Tile key={p.id} label={p.email} muted={p.muted} cameraOff={p.cameraOff}>
              <RemoteVideo stream={streams[p.id]} />
            </Tile>
          ))}
        </div>
        {noMedia ? <p className="text-sm text-muted-foreground">No camera or microphone found. Others can still see your chat.</p> : null}
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant={muted ? "destructive" : "outline"}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              const next = !muted;
              for (const t of local.current?.getAudioTracks() ?? []) t.enabled = !next;
              setMuted(next);
              sendState({ muted: next, cameraOff });
            }}
          >
            {muted ? <MicOff /> : <Mic />}
          </Button>
          <Button
            variant={cameraOff ? "destructive" : "outline"}
            aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
            onClick={() => {
              const next = !cameraOff;
              for (const t of local.current?.getVideoTracks() ?? []) t.enabled = !next;
              setCameraOff(next);
              sendState({ muted, cameraOff: next });
            }}
          >
            {cameraOff ? <VideoOff /> : <Video />}
          </Button>
          <Button variant="outline" aria-label="Share screen" onClick={shareScreen}>
            <MonitorUp />
          </Button>
          <Button variant="outline" aria-label="Leave" onClick={() => setEnded("You left the meeting.")}>
            <PhoneOff />
          </Button>
          {isCreator ? (
            <Button variant="destructive" onClick={() => ws.current?.send(JSON.stringify({ type: "end" }))}>
              End for everyone
            </Button>
          ) : null}
        </div>
      </div>
      <aside className="grid content-start gap-4">
        <section className="space-y-2">
          <h2 className="text-sm font-medium">People ({peers.length})</h2>
          <ul className="grid gap-1 text-sm">
            {peers.map((p) => (
              <li key={p.id} data-testid="participant" className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {p.email}
                  {p.id === selfId ? " (you)" : ""}
                </span>
                {p.muted ? <MicOff className="size-3.5 text-muted-foreground" aria-label="Muted" /> : null}
                {isCreator && p.id !== selfId ? (
                  <Button variant="ghost" size="xs" aria-label={`Remove ${p.email}`} onClick={() => ws.current?.send(JSON.stringify({ type: "remove", id: p.id }))}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Chat</h2>
          <ul className="grid max-h-64 gap-1.5 overflow-y-auto text-sm">
            {chat.map((c, i) => (
              <li key={i} data-testid="chat-message">
                <span className="text-xs text-muted-foreground">{c.from}</span>
                <p className="break-words">{c.text}</p>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!message.trim()) return;
              ws.current?.send(JSON.stringify({ type: "chat", text: message }));
              setMessage("");
            }}
          >
            <Input aria-label="Message" data-testid="chat-input" value={message} onChange={(e) => setMessage(e.target.value)} />
            <Button type="submit" size="icon" aria-label="Send message">
              <Send />
            </Button>
          </form>
        </section>
      </aside>
    </div>
  );
}

function Tile({ label, muted, cameraOff, children }: { label: string; muted: boolean; cameraOff: boolean; children: React.ReactNode }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted">
      <div className={cameraOff ? "invisible size-full" : "size-full"}>{children}</div>
      {cameraOff ? <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{label}</div> : null}
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-xs">
        {muted ? <MicOff className="size-3" aria-hidden /> : null}
        {label}
      </span>
    </div>
  );
}

function RemoteVideo({ stream }: { stream?: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="size-full object-cover" />;
}
