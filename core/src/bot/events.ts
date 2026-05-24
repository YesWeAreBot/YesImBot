import { randomUUID } from "node:crypto";

import type {
  AthenaEvent,
  AthenaEventKind,
  CreateAthenaEventInput,
  SerializedAthenaEvent,
} from "./types.js";

export function createAthenaEvent<K extends AthenaEventKind>(
  kind: K,
  input: CreateAthenaEventInput<K>,
): AthenaEvent<K> {
  return {
    id: randomUUID(),
    kind,
    timestamp: Date.now(),
    ...input,
  };
}

export function isAthenaEvent<K extends AthenaEventKind>(
  event: AthenaEvent,
  kind: K,
): event is AthenaEvent<K> {
  return event.kind === kind;
}

export function serializeAthenaEvent<K extends AthenaEventKind>(
  event: AthenaEvent<K>,
): SerializedAthenaEvent<K> {
  const { metadata: _metadata, ...rest } = event;
  return { version: 1, ...rest };
}
