import { ECONOMY } from '@/lib/economy.generated';
import { getUnseenProgression, markProgressionSeen, type ProgressionReport } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { getSocket } from '@/lib/socket';

// Client side of the Fame/level system. The server decides everything (see
// server/src/db/progression.ts); this module only
//  - holds each finished match's progression report so the result screen can
//    show it whether it arrived before or after navigation (online reports come
//    over the socket as `progression:update`, bot reports from the HTTP reply),
//  - and queues celebrations (level up / new title) for the global overlay,
//    including ones missed while offline (fetched from the server's unseen list).

const reports = new Map<string, ProgressionReport>();
const reportListeners = new Set<(key: string, report: ProgressionReport) => void>();

const celebrationQueue: ProgressionReport[] = [];
const queuedIds = new Set<string>();
const celebrationListeners = new Set<() => void>();
let attached = false;

export const LEVEL_TITLES = ECONOMY.levels.titles;
// Chapter titles (earned by beating a Tour boss) live in the Tour catalog.
const CHAPTER_TITLES = ECONOMY.tour.chapters.map((c) => c.title);
export function titleName(id: string | null | undefined): string | null {
  return LEVEL_TITLES.find((t) => t.id === id)?.name ?? CHAPTER_TITLES.find((t) => t.id === id)?.name ?? null;
}

function isCelebratory(report: ProgressionReport): boolean {
  return report.levelAfter > report.levelBefore || report.titlesUnlocked.length > 0 || !!report.tour?.bossBeaten;
}

function enqueueCelebration(report: ProgressionReport): void {
  if (!isCelebratory(report) || queuedIds.has(report.eventId)) return;
  queuedIds.add(report.eventId);
  celebrationQueue.push(report);
  celebrationListeners.forEach((listener) => listener());
}

// Stores a report under `key` (the online matchId, or a bot report key) and queues
// its celebration. Idempotent per eventId.
export function putReport(key: string, report: ProgressionReport): void {
  reports.set(key, report);
  enqueueCelebration(report);
  reportListeners.forEach((listener) => listener(key, report));
}

export function getReport(key: string): ProgressionReport | undefined {
  return reports.get(key);
}

export function subscribeReports(listener: (key: string, report: ProgressionReport) => void): () => void {
  ensureProgressionListener();
  reportListeners.add(listener);
  return () => {
    reportListeners.delete(listener);
  };
}

// One module-level listener on the shared socket, attached on first use (same
// pattern as lib/wagerResult.ts).
export function ensureProgressionListener(): void {
  if (attached) return;
  attached = true;
  getSocket().on('progression:update', (report: ProgressionReport) => {
    // Online reports are keyed by the in-memory match id the client already has.
    putReport(report.matchId ?? report.eventId, report);
  });
}

export function peekCelebration(): ProgressionReport | undefined {
  return celebrationQueue[0];
}

export function subscribeCelebrations(listener: () => void): () => void {
  celebrationListeners.add(listener);
  return () => {
    celebrationListeners.delete(listener);
  };
}

// Called by the overlay once it has shown the head of the queue.
export async function dismissCelebration(): Promise<void> {
  const report = celebrationQueue.shift();
  celebrationListeners.forEach((listener) => listener());
  if (!report) return;
  try {
    const token = await getAuthToken();
    if (token) await markProgressionSeen(token, report.eventId);
  } catch (error) {
    console.log('Failed to mark progression seen', error);
  }
}

// Replays celebrations the player missed (offline, app closed mid-result).
export async function loadUnseenCelebrations(): Promise<void> {
  try {
    const token = await getAuthToken();
    if (!token) return;
    const { events } = await getUnseenProgression(token);
    events.forEach(enqueueCelebration);
  } catch (error) {
    console.log('Failed to load unseen progression', error);
  }
}
