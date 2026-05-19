import { TimelineEvent } from "./vm-service-client.js";

export interface HttpRequest {
  id: string;
  method: string;
  uri: string;
  startTime: number;
  endTime?: number;
  statusCode?: number;
  requestSize?: number;
  responseSize?: number;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  error?: string;
  source: "dart:io" | "timeline";
}

export function parseHttpStreamEvent(
  event: unknown,
  options: { includeHeaders: boolean; now?: number }
): HttpRequest | undefined {
  if (!isRecord(event)) return undefined;

  const kind = String(event.extensionKind ?? event.kind ?? "");
  const data = isRecord(event.extensionData) ? event.extensionData : event;
  const now = options.now ?? Date.now();

  if (kind === "dart:io.httpClient.request.start" || kind === "HttpClientRequest") {
    return {
      id: stringValue(data.id) ?? stringValue(data.isolateId) ?? `req_${now}`,
      method: stringValue(data.method) ?? "GET",
      uri: stringValue(data.uri) ?? stringValue(data.url) ?? "unknown",
      startTime: now,
      requestSize: numberValue(data.contentLength) ?? numberValue(data.requestSize),
      requestHeaders: options.includeHeaders ? headersValue(data.headers) : undefined,
      source: "dart:io",
    };
  }

  if (kind === "Extension" && isRecord(data.extensionData)) {
    return parseHttpStreamEvent(
      {
        ...data.extensionData,
        kind: stringValue(data.extensionKind) ?? "Extension",
      },
      options
    );
  }

  if (!isHttpLikeKind(kind)) return undefined;

  const id = stringValue(data.id) ?? stringValue(data.isolateId) ?? `req_${now}`;
  return {
    id,
    method: stringValue(data.method) ?? "GET",
    uri: stringValue(data.uri) ?? stringValue(data.url) ?? "unknown",
    startTime: numberValue(data.startTime) ?? now,
    endTime: numberValue(data.endTime) ?? now,
    statusCode: numberValue(data.statusCode) ?? numberValue(data.status),
    requestSize: numberValue(data.requestSize),
    responseSize:
      numberValue(data.contentLength) ??
      numberValue(data.responseSize) ??
      numberValue(valueAtPath(data, ["compressionState", "length"])),
    contentType:
      stringValue(data.contentType) ?? headerValue(data.headers, "content-type"),
    requestHeaders: options.includeHeaders
      ? headersValue(data.requestHeaders)
      : undefined,
    responseHeaders: options.includeHeaders ? headersValue(data.headers) : undefined,
    error: stringValue(data.error) ?? stringValue(data.message),
    source: "dart:io",
  };
}

export function applyHttpStreamEvent(
  requests: Map<string, HttpRequest>,
  event: unknown,
  options: { includeHeaders: boolean; now?: number }
): void {
  const parsed = parseHttpStreamEvent(event, options);
  if (!parsed) return;

  const existing = requests.get(parsed.id);
  if (!existing) {
    requests.set(parsed.id, parsed);
    return;
  }

  requests.set(parsed.id, {
    ...existing,
    ...withoutUndefined(parsed),
    startTime: existing.startTime,
    method: parsed.method === "GET" ? existing.method : parsed.method,
    uri: parsed.uri === "unknown" ? existing.uri : parsed.uri,
    requestHeaders: parsed.requestHeaders ?? existing.requestHeaders,
    responseHeaders: parsed.responseHeaders ?? existing.responseHeaders,
  });
}

export function parseTimelineHttpRequests(
  events: TimelineEvent[],
  options: { includeHeaders: boolean }
): HttpRequest[] {
  return events
    .filter(isHttpTimelineEvent)
    .map((event, index) => timelineEventToRequest(event, index, options))
    .filter((request): request is HttpRequest => request !== undefined);
}

export function mergeHttpRequests(
  requests: Map<string, HttpRequest>,
  timelineRequests: HttpRequest[]
): Map<string, HttpRequest> {
  const merged = new Map(requests);

  for (const request of timelineRequests) {
    const existing = merged.get(request.id);
    if (!existing) {
      merged.set(request.id, request);
      continue;
    }
    merged.set(request.id, {
      ...request,
      ...existing,
      requestHeaders: existing.requestHeaders ?? request.requestHeaders,
      responseHeaders: existing.responseHeaders ?? request.responseHeaders,
    });
  }

  return merged;
}

function timelineEventToRequest(
  event: TimelineEvent,
  index: number,
  options: { includeHeaders: boolean }
): HttpRequest | undefined {
  const args = event.args ?? {};
  const method =
    stringValue(args.method) ??
    stringValue(args.httpMethod) ??
    stringValue(valueAtPath(args, ["request", "method"])) ??
    inferMethod(event.name);
  const uri =
    stringValue(args.uri) ??
    stringValue(args.url) ??
    stringValue(valueAtPath(args, ["request", "uri"])) ??
    stringValue(valueAtPath(args, ["request", "url"]));

  if (!uri && !isHttpLikeName(event.name, event.cat)) return undefined;

  const startTime = event.ts / 1000;
  const durationMs = event.dur !== undefined ? event.dur / 1000 : undefined;
  const id =
    stringValue(args.id) ??
    stringValue(args.requestId) ??
    `${method ?? "HTTP"}:${uri ?? event.name}:${Math.round(event.ts)}:${index}`;

  return {
    id,
    method: method ?? "GET",
    uri: uri ?? event.name,
    startTime,
    endTime: durationMs !== undefined ? startTime + durationMs : undefined,
    statusCode:
      numberValue(args.statusCode) ??
      numberValue(args.status) ??
      numberValue(valueAtPath(args, ["response", "statusCode"])),
    requestSize:
      numberValue(args.requestSize) ??
      numberValue(args.requestContentLength) ??
      numberValue(valueAtPath(args, ["request", "contentLength"])),
    responseSize:
      numberValue(args.responseSize) ??
      numberValue(args.responseContentLength) ??
      numberValue(args.contentLength) ??
      numberValue(valueAtPath(args, ["response", "contentLength"])),
    contentType:
      stringValue(args.contentType) ??
      headerValue(args.headers, "content-type") ??
      headerValue(valueAtPath(args, ["response", "headers"]), "content-type"),
    requestHeaders: options.includeHeaders
      ? headersValue(valueAtPath(args, ["request", "headers"]) ?? args.requestHeaders)
      : undefined,
    responseHeaders: options.includeHeaders
      ? headersValue(valueAtPath(args, ["response", "headers"]) ?? args.headers)
      : undefined,
    source: "timeline",
  };
}

function isHttpTimelineEvent(event: TimelineEvent): boolean {
  if (isHttpLikeName(event.name, event.cat)) return true;
  const args = event.args ?? {};
  return (
    stringValue(args.uri) !== undefined ||
    stringValue(args.url) !== undefined ||
    stringValue(valueAtPath(args, ["request", "uri"])) !== undefined ||
    stringValue(valueAtPath(args, ["request", "url"])) !== undefined
  );
}

function isHttpLikeKind(kind: string): boolean {
  const lower = kind.toLowerCase();
  return (
    lower.includes("http") || lower.includes("request") || lower.includes("response")
  );
}

function isHttpLikeName(name: string, category: string = ""): boolean {
  const lower = `${name} ${category}`.toLowerCase();
  return (
    lower.includes("http") ||
    lower.includes("socket") ||
    lower.includes("dio") ||
    lower.includes("urlrequest")
  );
}

function inferMethod(name: string): string | undefined {
  const match = name.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i);
  return match?.[1]?.toUpperCase();
}

function headersValue(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      headers[key.toLowerCase()] = String(raw);
    } else if (Array.isArray(raw)) {
      headers[key.toLowerCase()] = raw.map(String).join(", ");
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function headerValue(value: unknown, headerName: string): string | undefined {
  const headers = headersValue(value);
  return headers?.[headerName.toLowerCase()];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
