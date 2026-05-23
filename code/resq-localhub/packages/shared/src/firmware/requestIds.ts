export function formatRequestId(commandTypeId: number, sequenceNumber: number): string {
  return `req-${commandTypeId}-${String(sequenceNumber).padStart(4, "0")}`;
}

export function parseRequestId(requestId: string): { valid: boolean; commandTypeId?: number; sequenceNumber?: number } {
  if (typeof requestId !== "string") {
    return { valid: false };
  }

  const match = /^req-(\d+)-(\d{4,})$/.exec(requestId);
  if (!match) {
    return { valid: false };
  }

  const commandTypeId = Number.parseInt(match[1], 10);
  const sequenceNumber = Number.parseInt(match[2], 10);

  if (!Number.isFinite(commandTypeId) || !Number.isFinite(sequenceNumber)) {
    return { valid: false };
  }

  return { valid: true, commandTypeId, sequenceNumber };
}

export function isValidRequestId(requestId: string): boolean {
  return parseRequestId(requestId).valid;
}