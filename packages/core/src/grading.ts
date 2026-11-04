/**
 * Grading is tenant-configured data, never a code branch. The default scale
 * mirrors the prototype (A+ ≥ 90 … F < 33) but every school can replace it.
 */
import { ValidationError } from './errors';

export interface GradeBand {
  grade: string;
  minPercent: number;
  maxPercent: number;
  gpa: number;
  remark?: string;
}

export const DEFAULT_GRADE_BANDS: readonly GradeBand[] = [
  { grade: 'A+', minPercent: 90, maxPercent: 100, gpa: 4.0, remark: 'Outstanding' },
  { grade: 'A', minPercent: 80, maxPercent: 90, gpa: 3.6, remark: 'Excellent' },
  { grade: 'B+', minPercent: 70, maxPercent: 80, gpa: 3.2, remark: 'Very good' },
  { grade: 'B', minPercent: 60, maxPercent: 70, gpa: 2.8, remark: 'Good' },
  { grade: 'C+', minPercent: 50, maxPercent: 60, gpa: 2.4, remark: 'Satisfactory' },
  { grade: 'C', minPercent: 40, maxPercent: 50, gpa: 2.0, remark: 'Acceptable' },
  { grade: 'D', minPercent: 35, maxPercent: 40, gpa: 1.6, remark: 'Needs improvement' },
  { grade: 'E', minPercent: 33, maxPercent: 35, gpa: 1.2, remark: 'Marginal pass' },
  { grade: 'F', minPercent: 0, maxPercent: 33, gpa: 0, remark: 'Fail' },
];

export const DEFAULT_PASS_PERCENT = 33;

/**
 * Validates that bands are contiguous from 0 to 100 with unique grades.
 * Called when a school edits its scale and by the API before persisting.
 */
export function validateGradeBands(bands: readonly GradeBand[]): void {
  if (bands.length === 0) throw new ValidationError('At least one grade band is required');
  const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);
  const grades = new Set<string>();
  let expectedMin = 0;

  for (const band of sorted) {
    if (!band.grade.trim()) throw new ValidationError('Grade label is required');
    if (grades.has(band.grade)) throw new ValidationError(`Duplicate grade: ${band.grade}`);
    grades.add(band.grade);
    if (band.minPercent !== expectedMin) {
      throw new ValidationError(
        `Gap or overlap at ${expectedMin}%: band ${band.grade} starts at ${band.minPercent}%`,
      );
    }
    if (band.maxPercent <= band.minPercent || band.maxPercent > 100) {
      throw new ValidationError(`Invalid range for grade ${band.grade}`);
    }
    if (!Number.isFinite(band.gpa) || band.gpa < 0) {
      throw new ValidationError(`Invalid GPA for grade ${band.grade}`);
    }
    expectedMin = band.maxPercent;
  }

  if (expectedMin !== 100) {
    throw new ValidationError(`Grade bands must cover 100%; they end at ${expectedMin}%`);
  }
}

export function roundPercent(value: number): number {
  if (!Number.isFinite(value)) throw new ValidationError('Percentage must be finite');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function percentage(obtained: number, maximum: number): number {
  if (!Number.isFinite(obtained) || !Number.isFinite(maximum)) {
    throw new ValidationError('Marks must be finite numbers');
  }
  if (maximum <= 0) throw new ValidationError('Maximum marks must be greater than zero');
  if (obtained < 0) throw new ValidationError('Marks cannot be negative');
  if (obtained > maximum) throw new ValidationError('Marks cannot exceed maximum marks');
  return roundPercent((obtained / maximum) * 100);
}

export interface GradedPercentage {
  percentage: number;
  band: GradeBand;
  passed: boolean;
}

export function gradeFor(
  percent: number,
  bands: readonly GradeBand[] = DEFAULT_GRADE_BANDS,
  passPercent = DEFAULT_PASS_PERCENT,
): GradedPercentage {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new ValidationError('Percentage must be between 0 and 100');
  }
  const rounded = roundPercent(percent);
  const band = [...bands]
    .sort((a, b) => b.minPercent - a.minPercent)
    .find(
      (candidate) =>
        rounded >= candidate.minPercent &&
        (rounded < candidate.maxPercent || candidate.maxPercent === 100),
    );
  if (!band) throw new ValidationError('No grade band matches the percentage');
  return { percentage: rounded, band, passed: rounded >= passPercent };
}

export interface WeightedComponent {
  /** Raw marks obtained. */
  obtained: number;
  /** Maximum marks for this component. */
  maximum: number;
  /** Relative weight; e.g. 25 for a 25% term assessment. */
  weight: number;
  /** Absent components score zero but still count towards the denominator. */
  absent?: boolean;
}

export interface WeightedResult {
  obtained: number;
  maximum: number;
  percentage: number;
  weightTotal: number;
}

/** Weighted aggregate across exam components (terms, theory/practical, etc.). */
export function weightedAggregate(components: readonly WeightedComponent[]): WeightedResult {
  if (components.length === 0) throw new ValidationError('At least one component is required');
  let weightedObtained = 0;
  let weightedMaximum = 0;
  let weightTotal = 0;

  for (const component of components) {
    if (component.maximum <= 0) throw new ValidationError('Component maximum must be positive');
    if (component.weight < 0) throw new ValidationError('Component weight cannot be negative');
    if (!component.absent && component.obtained < 0) {
      throw new ValidationError('Marks cannot be negative');
    }
    if (!component.absent && component.obtained > component.maximum) {
      throw new ValidationError('Marks cannot exceed component maximum');
    }
    const obtained = component.absent ? 0 : component.obtained;
    weightedObtained += (obtained / component.maximum) * component.weight;
    weightedMaximum += component.weight;
    weightTotal += component.weight;
  }

  if (weightTotal <= 0) throw new ValidationError('Total weight must be positive');
  return {
    obtained: roundPercent(weightedObtained),
    maximum: roundPercent(weightedMaximum),
    percentage: roundPercent((weightedObtained / weightTotal) * 100),
    weightTotal: roundPercent(weightTotal),
  };
}

export interface RankInput {
  studentId: string;
  percentage: number;
  /** Optional deterministic tie-breaker, e.g. total obtained marks. */
  tieBreaker?: number;
}

export interface RankedStudent extends RankInput {
  rank: number;
}

/**
 * Competition ranking (1, 2, 2, 4). Ties break by higher tieBreaker, then
 * studentId for stable output across database orderings.
 */
export function rankStudents(students: readonly RankInput[]): RankedStudent[] {
  const sorted = [...students].sort(
    (a, b) =>
      b.percentage - a.percentage ||
      (b.tieBreaker ?? 0) - (a.tieBreaker ?? 0) ||
      a.studentId.localeCompare(b.studentId),
  );

  const ranked: RankedStudent[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const student = sorted[index];
    if (!student) continue;
    const previous = sorted[index - 1];
    const sameAsPrevious =
      previous !== undefined &&
      previous.percentage === student.percentage &&
      (previous.tieBreaker ?? 0) === (student.tieBreaker ?? 0);
    const rank = sameAsPrevious ? (ranked[index - 1]?.rank ?? index + 1) : index + 1;
    ranked.push({ ...student, rank });
  }
  return ranked;
}

export interface SubjectMark {
  subjectId: string;
  subjectName?: string;
  obtained: number;
  maximum: number;
  absent?: boolean;
}

export interface SubjectResult {
  subjectId: string;
  subjectName?: string;
  obtained: number;
  maximum: number;
  percentage: number;
  grade: string;
  gpa: number;
  passed: boolean;
  absent: boolean;
}

export interface ResultSheet {
  subjects: SubjectResult[];
  totalObtained: number;
  totalMaximum: number;
  percentage: number;
  gpa: number;
  grade: string;
  passed: boolean;
}

/** Builds a full report-card result from subject marks using tenant settings. */
export function buildResultSheet(
  marks: readonly SubjectMark[],
  bands: readonly GradeBand[] = DEFAULT_GRADE_BANDS,
  passPercent = DEFAULT_PASS_PERCENT,
): ResultSheet {
  if (marks.length === 0) throw new ValidationError('At least one subject is required');
  const subjects: SubjectResult[] = marks.map((mark) => {
    const obtained = mark.absent ? 0 : mark.obtained;
    const percent = percentage(obtained, mark.maximum);
    const graded = gradeFor(percent, bands, passPercent);
    return {
      subjectId: mark.subjectId,
      subjectName: mark.subjectName,
      obtained,
      maximum: mark.maximum,
      percentage: percent,
      grade: graded.band.grade,
      gpa: graded.band.gpa,
      passed: graded.passed && !mark.absent,
      absent: Boolean(mark.absent),
    };
  });

  const totalObtained = roundPercent(subjects.reduce((sum, s) => sum + s.obtained, 0));
  const totalMaximum = roundPercent(subjects.reduce((sum, s) => sum + s.maximum, 0));
  const percent = totalMaximum > 0 ? percentage(totalObtained, totalMaximum) : 0;
  const graded = gradeFor(percent, bands, passPercent);
  const gpa =
    Math.round(
      (subjects.reduce((sum, s) => sum + s.gpa, 0) / subjects.length + Number.EPSILON) * 100,
    ) / 100;

  return {
    subjects,
    totalObtained,
    totalMaximum,
    percentage: percent,
    gpa,
    grade: graded.band.grade,
    passed: subjects.every((s) => s.passed) && graded.passed,
  };
}
