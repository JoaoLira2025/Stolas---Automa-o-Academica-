import type { IncomingMessage, ServerResponse } from "node:http";
import server from "../dist/server/index.js";

type VercelRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
type VercelResponse = ServerResponse & {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  end(body?: string | Uint8Array): void;
};

type FetchServer = {
  fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response> | Response;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const protocol = (req.headers["x-forwarded-proto"] as string | undefined) || "https";
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${protocol}://${host}`);
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  const request = new Request(url, { method: req.method, headers, body });
  const response = await (server as unknown as FetchServer).fetch(request, {}, {});

  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(new Uint8Array(await response.arrayBuffer()));
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
