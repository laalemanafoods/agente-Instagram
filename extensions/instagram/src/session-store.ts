// Conversation state tracking across messages for multi-turn flows.

type ConsumerState =
  | { segment: "consumer" }
  | { segment: "consumer"; step: "asking_city" }
  | { segment: "consumer"; step: "asking_barrio"; city: string }
  | { segment: "consumer"; step: "asking_city_for_barrio"; barrio: string }
  | { segment: "consumer"; step: "disambiguating_b2b" };

type B2BState =
  | { segment: "b2b"; step: "collecting"; city?: string }
  | { segment: "b2b"; step: "done" };

type EventoState =
  | { segment: "evento"; step: "confirming" }
  | { segment: "evento"; step: "collecting" }
  | { segment: "evento"; step: "done" };

type ConfusionState =
  | { segment: "confusion"; step: "asking" }
  | { segment: "confusion"; step: "collecting" }
  | { segment: "confusion"; step: "done" };

type QuejaState =
  | { segment: "queja"; step: "collecting" }
  | { segment: "queja"; step: "done" };

type SessionState =
  | ConsumerState
  | B2BState
  | EventoState
  | QuejaState
  | ConfusionState
  | { segment: "vendedor" }
  | { segment: "unknown" };

const sessions = new Map<string, SessionState>();
const confusionCounts = new Map<string, number>();
const trollCounts = new Map<string, number>();
const staffSenders = new Set<string>();
const humanManagedAt = new Map<string, number>(); // clientId → timestamp de toma de control humano
const lastActivityAt = new Map<string, number>(); // clientId → timestamp de última actividad

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function getSession(senderId: string): SessionState {
  return sessions.get(senderId) ?? { segment: "unknown" };
}

export function setSession(senderId: string, state: SessionState): void {
  sessions.set(senderId, state);
}

export function incrementConfusion(senderId: string): number {
  const count = (confusionCounts.get(senderId) ?? 0) + 1;
  confusionCounts.set(senderId, count);
  return count;
}

export function resetConfusion(senderId: string): void {
  confusionCounts.delete(senderId);
}

export function markAsStaff(senderId: string): void {
  staffSenders.add(senderId);
}

export function isStaff(senderId: string): boolean {
  return staffSenders.has(senderId);
}

export function incrementTroll(senderId: string): number {
  const count = (trollCounts.get(senderId) ?? 0) + 1;
  trollCounts.set(senderId, count);
  return count;
}

export function resetTroll(senderId: string): void {
  trollCounts.delete(senderId);
}

export function markAsHumanManaged(clientId: string): void {
  humanManagedAt.set(clientId, Date.now());
  lastActivityAt.set(clientId, Date.now());
}

export function updateLastActivity(clientId: string): void {
  lastActivityAt.set(clientId, Date.now());
}

export function isHumanManaged(clientId: string): boolean {
  if (!humanManagedAt.has(clientId)) return false;
  const last = lastActivityAt.get(clientId) ?? humanManagedAt.get(clientId)!;
  if (Date.now() - last > SEVEN_DAYS_MS) {
    // 7 días de silencio total → reset automático
    humanManagedAt.delete(clientId);
    lastActivityAt.delete(clientId);
    sessions.delete(clientId);
    return false;
  }
  return true;
}
