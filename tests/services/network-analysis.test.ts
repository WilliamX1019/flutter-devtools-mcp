import { describe, expect, it } from "vitest";
import {
  applyHttpStreamEvent,
  mergeHttpRequests,
  parseHttpStreamEvent,
  parseTimelineHttpRequests,
} from "../../src/services/network-analysis.js";
import { TimelineEvent } from "../../src/services/vm-service-client.js";

const event = (partial: Partial<TimelineEvent>): TimelineEvent => ({
  name: partial.name ?? "HTTP GET",
  cat: partial.cat ?? "Dart",
  ph: partial.ph ?? "X",
  ts: partial.ts ?? 1000,
  dur: partial.dur,
  pid: partial.pid ?? 1,
  tid: partial.tid ?? 1,
  args: partial.args,
});

describe("parseHttpStreamEvent", () => {
  it("parses dart:io request start events", () => {
    const request = parseHttpStreamEvent(
      {
        kind: "dart:io.httpClient.request.start",
        id: "1",
        method: "POST",
        uri: "https://example.com/items",
        headers: { Authorization: "Bearer token" },
      },
      { includeHeaders: true, now: 100 }
    );

    expect(request).toMatchObject({
      id: "1",
      method: "POST",
      uri: "https://example.com/items",
      startTime: 100,
      source: "dart:io",
      requestHeaders: { authorization: "Bearer token" },
    });
  });

  it("merges request start and response finish events", () => {
    const requests = new Map();

    applyHttpStreamEvent(
      requests,
      {
        kind: "dart:io.httpClient.request.start",
        id: "1",
        method: "GET",
        uri: "https://example.com/feed",
      },
      { includeHeaders: false, now: 100 }
    );
    applyHttpStreamEvent(
      requests,
      {
        kind: "dart:io.httpClient.request.finish",
        id: "1",
        statusCode: 200,
        responseSize: 2048,
      },
      { includeHeaders: false, now: 250 }
    );

    expect(requests.get("1")).toMatchObject({
      method: "GET",
      uri: "https://example.com/feed",
      startTime: 100,
      endTime: 250,
      statusCode: 200,
      responseSize: 2048,
    });
  });
});

describe("parseTimelineHttpRequests", () => {
  it("parses HTTP-like timeline duration events", () => {
    const requests = parseTimelineHttpRequests(
      [
        event({
          name: "HTTP Client Request",
          dur: 42_000,
          args: {
            method: "GET",
            uri: "https://example.com/feed",
            statusCode: 200,
            responseContentLength: 4096,
            response: { headers: { "content-type": "application/json" } },
          },
        }),
      ],
      { includeHeaders: true }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "GET",
      uri: "https://example.com/feed",
      endTime: 43,
      statusCode: 200,
      responseSize: 4096,
      contentType: "application/json",
      source: "timeline",
      responseHeaders: { "content-type": "application/json" },
    });
  });

  it("recognizes Dio and URLRequest timeline names", () => {
    const requests = parseTimelineHttpRequests(
      [
        event({ name: "Dio GET https://api.example.com/user", dur: 10_000 }),
        event({ name: "NSURLRequest", cat: "URLRequest", dur: 20_000 }),
      ],
      { includeHeaders: false }
    );

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.source)).toEqual(["timeline", "timeline"]);
  });
});

describe("mergeHttpRequests", () => {
  it("keeps stream data when timeline contains the same ID", () => {
    const streamRequests = new Map([
      [
        "1",
        {
          id: "1",
          method: "GET",
          uri: "https://example.com/feed",
          startTime: 100,
          endTime: 200,
          statusCode: 200,
          source: "dart:io" as const,
        },
      ],
    ]);

    const merged = mergeHttpRequests(streamRequests, [
      {
        id: "1",
        method: "POST",
        uri: "https://example.com/other",
        startTime: 1,
        endTime: 50,
        source: "timeline",
      },
    ]);

    expect(merged.get("1")).toMatchObject({
      method: "GET",
      uri: "https://example.com/feed",
      source: "dart:io",
    });
  });
});
