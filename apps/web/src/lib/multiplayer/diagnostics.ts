"use client";

import { useMultiplayerConnectionStore } from "@/lib/multiplayer/connectionStore";

const LOG_CAP = 250;

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  t: number;
  level: LogLevel;
  msg: string;
  data?: unknown;
}

const ring: LogEntry[] = [];

export interface MultiplayerDiagnosticsSnapshot {
  logs: LogEntry[];
  transportInboundTotal: number;
  duplicateEventsDropped: number;
  lastDesyncReason: string | null;
  connection: ReturnType<typeof useMultiplayerConnectionStore.getState>;
}

let transportInboundTotal = 0;
let duplicateEventsDropped = 0;
let lastDesyncReason: string | null = null;

export function mpLog(level: LogLevel, msg: string, data?: unknown): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "development") {
    if (level === "error" || level === "warn") {
      /* still record for getMultiplayerDiagnostics */
    } else {
      return;
    }
  }
  ring.push({ t: Date.now(), level, msg, data });
  if (ring.length > LOG_CAP) ring.shift();
}

export function mpRecordTransportInbound(
  kind: string,
  meta?: { roomId?: string; seq?: number; version?: number },
): void {
  transportInboundTotal += 1;
  useMultiplayerConnectionStore.getState().incrementPacketIn();
  mpLog("debug", `transport.in ${kind}`, meta);
}

export function mpRecordDuplicateDropped(kind: string): void {
  duplicateEventsDropped += 1;
  useMultiplayerConnectionStore.getState().incrementDuplicateDropped();
  mpLog("warn", "transport.duplicate_dropped", { kind });
}

export function mpRecordDesync(reason: string, detail?: unknown): void {
  lastDesyncReason = reason;
  useMultiplayerConnectionStore.getState().setLastDesyncReason(reason);
  mpLog("warn", "sync.desync", { reason, detail });
}

export function getMultiplayerDiagnostics(): MultiplayerDiagnosticsSnapshot {
  return {
    logs: [...ring],
    transportInboundTotal,
    duplicateEventsDropped,
    lastDesyncReason,
    connection: useMultiplayerConnectionStore.getState(),
  };
}

export function resetMultiplayerDiagnostics(): void {
  ring.length = 0;
  transportInboundTotal = 0;
  duplicateEventsDropped = 0;
  lastDesyncReason = null;
}

export function installMultiplayerDevtools(): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "development") return;
  const w = window as unknown as {
    __FLUX_MULTIPLAYER__?: typeof getMultiplayerDiagnostics;
  };
  w.__FLUX_MULTIPLAYER__ = getMultiplayerDiagnostics;
}
