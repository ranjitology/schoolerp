/**
 * Timetable conflict detection. The database enforces uniqueness for a
 * class/section slot; teacher and room clashes span classes and are detected
 * here (and re-checked inside the write transaction).
 */
export interface TimetableSlotInput {
  id: string;
  dayOfWeek: number;
  periodId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherId?: string | null;
  room?: string | null;
}

export type ConflictType = 'CLASS_SLOT' | 'TEACHER' | 'ROOM';

export interface TimetableConflict {
  type: ConflictType;
  slotIds: [string, string];
  message: string;
}

function pairKey(day: number, period: string, value: string): string {
  return `${day}|${period}|${value}`;
}

export function detectTimetableConflicts(
  slots: readonly TimetableSlotInput[],
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  const seen = new Map<string, TimetableSlotInput>();

  const check = (key: string, slot: TimetableSlotInput, type: ConflictType, label: string): void => {
    const existing = seen.get(key);
    if (existing && existing.id !== slot.id) {
      conflicts.push({
        type,
        slotIds: [existing.id, slot.id],
        message: `${label} is already booked on day ${slot.dayOfWeek} for this period`,
      });
      return;
    }
    seen.set(key, slot);
  };

  for (const slot of slots) {
    check(
      pairKey(slot.dayOfWeek, slot.periodId, `${slot.classId}|${slot.sectionId}`),
      slot,
      'CLASS_SLOT',
      'This class section',
    );
    if (slot.teacherId) {
      check(
        pairKey(slot.dayOfWeek, slot.periodId, slot.teacherId),
        slot,
        'TEACHER',
        'This teacher',
      );
    }
    if (slot.room?.trim()) {
      check(
        pairKey(slot.dayOfWeek, slot.periodId, slot.room.trim().toLowerCase()),
        slot,
        'ROOM',
        `Room ${slot.room.trim()}`,
      );
    }
  }

  return conflicts;
}

export function assertNoTimetableConflicts(slots: readonly TimetableSlotInput[]): void {
  const conflicts = detectTimetableConflicts(slots);
  if (conflicts.length > 0) {
    const error = new Error(conflicts.map((c) => c.message).join('; '));
    error.name = 'TimetableConflictError';
    throw error;
  }
}

export function periodMinutes(
  periods: readonly { startTime: string; endTime: string }[],
): number {
  let total = 0;
  for (const period of periods) {
    const [startH = '0', startM = '0'] = period.startTime.split(':');
    const [endH = '0', endM = '0'] = period.endTime.split(':');
    const start = Number(startH) * 60 + Number(startM);
    const end = Number(endH) * 60 + Number(endM);
    if (end <= start) throw new Error(`Invalid period ${period.startTime}-${period.endTime}`);
    total += end - start;
  }
  return total;
}

export function isValidWorkingDay(dayOfWeek: number, workingDays: readonly number[]): boolean {
  return Number.isInteger(dayOfWeek) && dayOfWeek >= 1 && dayOfWeek <= 7 && workingDays.includes(dayOfWeek);
}
