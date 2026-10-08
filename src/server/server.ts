import { createServer as httpServer } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket, RawData } from "ws";
import type { Agent } from "../core/agent.ts";
import { authStatus, providerOf } from "../adapters/providers/credentials.ts";
import type { PermissionMode } from "../core/settings.ts";
import type { Answer } from "../core/tools.ts";
import { AgentSession, type SessionHost } from "../ui/session.ts";
import type { ClientCommand, ServerEvent, ServerSnapshot } from "./protocol.ts";

/** A remote (e.g. iOS) front-end for one megacode conversation, served over WebSocket
  plus a small HTTP endpoint. All logic lives in AgentSession; this class only exposes
  its public API (state out, commands in) to connected clients. */
export class RemoteServer {
  #session: AgentSession;
  #agent: Agent;
  #mode: PermissionMode;
  #authStatus: string;
  #clients = new Set<WebSocket>();
  #server: HttpServer | null = null;
  #wss: WebSocketServer | null = null;

  constructor(agent: Agent, mode: PermissionMode) {
    this.#agent = agent;
    this.#mode = mode;
    this.#authStatus = authStatus(providerOf(agent.model));
    const host: SessionHost = {
      canSend: () => true,
      mode: () => this.#mode,
      setMode: (mode) => {
        this.#mode = mode;
        this.#broadcast();
      },
      onAllowEdits: () => {
        this.#mode = "accept-edits";
        this.#broadcast();
      },
      restoreInput: (text) => this.#broadcastRestoreInput(text),
    };
    this.#session = new AgentSession(agent, host);
    this.#session.subscribe(() => this.#broadcast());
  }

  get model() {
    return this.#agent.model;
  }

  /** The whole session as a client should see it. Immutable; strip the host-side
    `resolve` hooks so it's JSON-safe. */
  snapshot(): ServerSnapshot {
    const s = this.#session.snapshot;
    const approval = s.state.approval;
    const questionnaire = s.state.questionnaire;
    return {
      model: this.#agent.model,
      authStatus: this.#authStatus,
      state: {
        running: s.state.running,
        activeTool: s.state.activeTool,
        approval: approval
          ? { tool: approval.tool, title: approval.title, body: approval.body, change: approval.change }
          : null,
        questionnaire: questionnaire ? { questions: questionnaire.questions } : null,
        queued: s.state.queued,
        verb: s.state.verb,
        completedTurns: s.state.completedTurns,
        mode: this.#mode,
      },
      items: s.items,
      epoch: s.epoch,
      streaming: s.streaming,
    };
  }

  /** Binds the server and returns the actual port (a requested port of 0 picks a free one). */
  async listen(host: string, port: number): Promise<number> {
    const server = httpServer();
    this.#server = server;
    const wss = new WebSocketServer({ server });
    this.#wss = wss;
    server.on("request", (req, res) => this.#handleHttp(req, res));
    wss.on("connection", (ws) => this.#addClient(ws));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    const shown = host === "0.0.0.0" ? "localhost" : host;
    const address = server.address();
    if (!address || typeof address !== "object")
      throw new Error("server bound but has no local address");
    console.error(`megacode server ready at ws://${shown}:${address.port}`);
    return address.port;
  }

  close() {
    this.#session.abort();
    const wss = this.#wss;
    const server = this.#server;
    const closeWss = wss
      ? new Promise<void>((resolve) => wss.close((e) => {
          if (e) console.error((e as Error).message);
          resolve();
        }))
      : Promise.resolve();
    const closeHttp = server
      ? new Promise<void>((resolve) => server.close((e) => {
          if (e) console.error((e as Error).message);
          resolve();
        }))
      : Promise.resolve();
    return Promise.all([closeWss, closeHttp]);
  }

  #handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? "/";
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") return void respond(405, { error: "method not allowed" });
    const snap = this.snapshot();
    if (url === "/") return void respond(200, snap);
    if (url === "/health")
      return void respond(200, { ok: true, model: snap.model, authStatus: snap.authStatus, epoch: snap.epoch });
    respond(404, { error: "not found" });
  }

  #addClient(ws: WebSocket) {
    this.#clients.add(ws);
    ws.on("message", (data) => this.#handleMessage(ws, data));
    ws.on("close", () => this.#clients.delete(ws));
    ws.on("error", () => this.#clients.delete(ws));
    this.#broadcast(); // hand the client its current state
  }

  /** Turn the wire bytes into a command. `RawData` is `Buffer`, an `ArrayBuffer`,
    or a chunked `Buffer[]`; all are decoded as UTF-8 JSON. */
  #handleMessage(ws: WebSocket, data: RawData) {
    let raw: string;
    if (Buffer.isBuffer(data)) raw = data.toString();
    else if (data instanceof ArrayBuffer) raw = Buffer.from(data).toString();
    else {
      const chunks = data as unknown as Buffer[];
      raw = Buffer.concat(chunks).toString();
    }
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(raw) as ClientCommand;
    } catch {
      return; // ignore malformed messages
    }
    try {
      this.#dispatch(cmd);
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", message: (e as Error).message } satisfies ServerEvent));
      console.error((e as Error).message);
    }
  }

  #dispatch(cmd: ClientCommand): void {
    switch (cmd.type) {
      case "submit": this.#session.submit(cmd.text); break;
      case "interrupt": this.#session.interrupt(); break;
      case "flushQueue": this.#session.flushQueue(cmd.text); break;
      case "sendQueued": this.#session.sendQueued(cmd.index); break;
      case "answerApproval": this.#session.answerApproval(cmd.choice); break;
      case "answerQuestionnaire": this.#session.answerQuestionnaire(cmd.answers); break;
      case "setMode": this.#session.setMode(cmd.mode); break;
      case "setModel": {
        this.#session.setModel(cmd.spec);
        this.#authStatus = authStatus(providerOf(cmd.spec));
        this.#broadcast();
        break;
      }
      case "clear": this.#session.clear(); break;
    }
  }

  #broadcast() {
    const json = JSON.stringify({ type: "state", snapshot: this.snapshot() } satisfies ServerEvent);
    for (const c of this.#clients) c.send(json);
  }

  #broadcastRestoreInput(text: string) {
    const json = JSON.stringify({ type: "restoreInput", text } satisfies ServerEvent);
    for (const c of this.#clients) c.send(json);
  }
}
