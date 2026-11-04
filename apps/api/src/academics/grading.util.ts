import { DEFAULT_GRADE_BANDS, DEFAULT_PASS_PERCENT, type GradeBand } from '@schoolerp/core';
import type { TxClient } from '@schoolerp/db';

export async function loadPolicyBands(
  tx: TxClient,
  schoolId: string,
): Promise<{ bands: GradeBand[]; passPercent: number }> {
  const scale = await tx.gradingScale.findFirst({
    where: { schoolId, isDefault: true },
    include: { bands: { orderBy: { sequence: 'asc' } } },
  });
  if (!scale || scale.bands.length === 0) {
    return { bands: [...DEFAULT_GRADE_BANDS], passPercent: DEFAULT_PASS_PERCENT };
  }
  return {
    bands: scale.bands.map((band) => ({
      grade: band.grade,
      minPercent: Number(band.minPercent),
      maxPercent: Number(band.maxPercent),
      gpa: Number(band.gpa),
      ...(band.remark ? { remark: band.remark } : {}),
    })),
    passPercent: DEFAULT_PASS_PERCENT,
  };
}
