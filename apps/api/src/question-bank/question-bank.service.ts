import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotFoundError, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const createQuestionSchema = z.object({
  subjectId: z.string().uuid(),
  type: z.enum(['MCQ', 'SHORT', 'LONG', 'TRUE_FALSE', 'FILL_BLANK']).default('MCQ'),
  question: z.string().trim().min(3).max(5000),
  options: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  answer: z.string().trim().min(1).max(5000),
  marks: z.number().int().min(1).max(100).default(1),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const updateQuestionSchema = createQuestionSchema.partial();

export const questionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  subjectId: z.string().uuid().optional(),
  type: z.enum(['MCQ', 'SHORT', 'LONG', 'TRUE_FALSE', 'FILL_BLANK']).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const generatePaperSchema = z.object({
  subjectId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  totalMarks: z.number().int().min(1).max(1000),
  distribution: z
    .object({
      EASY: z.number().int().min(0).max(100).default(0),
      MEDIUM: z.number().int().min(0).max(100).default(0),
      HARD: z.number().int().min(0).max(100).default(0),
    })
    .optional(),
});

@Injectable()
export class QuestionBankService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal, query: z.infer<typeof questionQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.QuestionBankWhereInput = {
        schoolId: auth.schoolId,
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.difficulty ? { difficulty: query.difficulty } : {}),
        ...(query.q ? { question: { contains: query.q, mode: 'insensitive' } } : {}),
      };
      const [items, total] = await Promise.all([
        tx.questionBank.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.questionBank.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async create(
    auth: AuthPrincipal,
    input: z.infer<typeof createQuestionSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const question = await tx.questionBank.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          subjectId: input.subjectId,
          type: input.type,
          question: input.question,
          options: input.options,
          answer: input.answer,
          marks: input.marks,
          difficulty: input.difficulty,
          tags: input.tags,
          createdByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'question_bank.created',
        entity: 'QuestionBank',
        entityId: question.id,
        after: { subjectId: question.subjectId, type: question.type, marks: question.marks },
      });
      return question;
    });
  }

  async update(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateQuestionSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.questionBank.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!current) throw new NotFoundError('Question');
      const question = await tx.questionBank.update({
        where: { id },
        data: {
          ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.question !== undefined ? { question: input.question } : {}),
          ...(input.options !== undefined ? { options: input.options } : {}),
          ...(input.answer !== undefined ? { answer: input.answer } : {}),
          ...(input.marks !== undefined ? { marks: input.marks } : {}),
          ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'question_bank.updated',
        entity: 'QuestionBank',
        entityId: id,
        after: { marks: question.marks, difficulty: question.difficulty },
      });
      return question;
    });
  }

  async remove(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.questionBank.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!current) throw new NotFoundError('Question');
      await tx.questionBank.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'question_bank.deleted',
        entity: 'QuestionBank',
        entityId: id,
      });
      return { removed: true };
    });
  }

  async generatePaper(
    auth: AuthPrincipal,
    input: z.infer<typeof generatePaperSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const pool = await tx.questionBank.findMany({
        where: { schoolId: auth.schoolId, subjectId: input.subjectId },
        orderBy: { createdAt: 'asc' },
      });
      if (pool.length === 0) throw new NotFoundError('Questions for this subject');
      const picked: typeof pool = [];
      let marks = 0;
      const distribution = input.distribution;
      const ordered = distribution
        ? [...pool].sort((a, b) => {
            const order = { EASY: 0, MEDIUM: 1, HARD: 2 } as Record<string, number>;
            return (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1);
          })
        : pool;
      for (const question of ordered) {
        if (marks + question.marks > input.totalMarks) continue;
        picked.push(question);
        marks += question.marks;
        if (marks === input.totalMarks) break;
      }
      // Fill any remaining marks from questions that fit individually.
      for (const question of ordered) {
        if (picked.includes(question)) continue;
        if (marks + question.marks > input.totalMarks) continue;
        picked.push(question);
        marks += question.marks;
        if (marks === input.totalMarks) break;
      }
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'question_bank.paper_generated',
        entity: 'QuestionBank',
        entityId: input.subjectId,
        after: { title: input.title, questions: picked.length, marks },
      });
      return {
        title: input.title,
        subjectId: input.subjectId,
        totalMarks: marks,
        targetMarks: input.totalMarks,
        questions: picked.map((question) => ({
          id: question.id,
          type: question.type,
          question: question.question,
          options: question.options,
          marks: question.marks,
          difficulty: question.difficulty,
        })),
      };
    });
  }
}

export function auditCtx(auth: AuthPrincipal, meta: AuditMeta) {
  return {
    schoolId: auth.schoolId,
    userId: auth.userId,
    actorType: auth.actorType,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    impersonationId: auth.impersonationId,
  };
}
