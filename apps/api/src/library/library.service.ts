import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createBookSchema = z.object({
  isbn: z.string().trim().max(32).optional(),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  copies: z.number().int().min(1).max(10_000).default(1),
  location: z.string().trim().max(80).optional(),
});

export const updateBookSchema = createBookSchema.partial();

export const bookQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
});

export const issueBookSchema = z.object({
  bookId: z.string().uuid(),
  studentId: z.string().uuid(),
  dueDate: isoDate,
});

export const returnBookSchema = z.object({
  returnDate: isoDate.optional(),
  finePerDayMinor: z.number().int().min(0).max(100_000).default(500),
});

export const issueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['ISSUED', 'RETURNED', 'OVERDUE', 'LOST']).optional(),
  studentId: z.string().uuid().optional(),
});

@Injectable()
export class LibraryService {
  constructor(private readonly audit: AuditService) {}

  async listBooks(auth: AuthPrincipal, query: z.infer<typeof bookQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.LibraryBookWhereInput = {
        schoolId: auth.schoolId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { author: { contains: query.q, mode: 'insensitive' } },
                { isbn: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.libraryBook.findMany({
          where,
          orderBy: { title: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.libraryBook.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async createBook(auth: AuthPrincipal, input: z.infer<typeof createBookSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const book = await tx.libraryBook.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          isbn: input.isbn ?? null,
          title: input.title,
          author: input.author,
          category: input.category,
          copies: input.copies,
          available: input.copies,
          location: input.location ?? null,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'library.book_created',
        entity: 'LibraryBook',
        entityId: book.id,
        after: { title: book.title, copies: book.copies },
      });
      return book;
    });
  }

  async updateBook(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateBookSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.libraryBook.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Book');
      const issued = current.copies - current.available;
      const copies = input.copies ?? current.copies;
      if (copies < issued) throw new ConflictError('Copies cannot be fewer than issued books');
      const book = await tx.libraryBook.update({
        where: { id },
        data: {
          ...(input.isbn !== undefined ? { isbn: input.isbn ?? null } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.author !== undefined ? { author: input.author } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.copies !== undefined ? { copies, available: copies - issued } : {}),
          ...(input.location !== undefined ? { location: input.location ?? null } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'library.book_updated',
        entity: 'LibraryBook',
        entityId: id,
        before: { title: current.title, copies: current.copies },
        after: { title: book.title, copies: book.copies },
      });
      return book;
    });
  }

  async listIssues(auth: AuthPrincipal, query: z.infer<typeof issueQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.LibraryIssueWhereInput = {
        schoolId: auth.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.studentId ? { studentId: query.studentId } : {}),
      };
      const [issues, total] = await Promise.all([
        tx.libraryIssue.findMany({
          where,
          orderBy: { issueDate: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.libraryIssue.count({ where }),
      ]);
      const bookIds = [...new Set(issues.map((issue) => issue.bookId))];
      const studentIds = [...new Set(issues.map((issue) => issue.studentId))];
      const [books, students] = await Promise.all([
        tx.libraryBook.findMany({ where: { schoolId: auth.schoolId, id: { in: bookIds } } }),
        tx.student.findMany({
          where: { schoolId: auth.schoolId, id: { in: studentIds } },
          select: { id: true, firstName: true, lastName: true, admissionNo: true },
        }),
      ]);
      const bookMap = new Map(books.map((book) => [book.id, book]));
      const studentMap = new Map(students.map((student) => [student.id, student]));
      return {
        items: issues.map((issue) => ({
          ...issue,
          bookTitle: bookMap.get(issue.bookId)?.title ?? 'Unknown book',
          studentName: studentMap.get(issue.studentId)
            ? `${studentMap.get(issue.studentId)!.firstName} ${studentMap.get(issue.studentId)!.lastName}`.trim()
            : 'Unknown student',
          admissionNo: studentMap.get(issue.studentId)?.admissionNo ?? null,
          overdue: issue.status === 'ISSUED' && issue.dueDate < new Date(),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async issueBook(auth: AuthPrincipal, input: z.infer<typeof issueBookSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [book, student] = await Promise.all([
        tx.libraryBook.findFirst({ where: { id: input.bookId, schoolId: auth.schoolId } }),
        tx.student.findFirst({
          where: { id: input.studentId, schoolId: auth.schoolId, deletedAt: null },
        }),
      ]);
      if (!book) throw new NotFoundError('Book');
      if (!student) throw new NotFoundError('Student');
      if (book.available <= 0) throw new ConflictError('No copies of this book are available');
      const issue = await tx.libraryIssue.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          bookId: book.id,
          studentId: student.id,
          issuedByUserId: auth.userId,
          dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
          status: 'ISSUED',
        },
      });
      await tx.libraryBook.update({
        where: { id: book.id },
        data: { available: { decrement: 1 } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'library.book_issued',
        entity: 'LibraryIssue',
        entityId: issue.id,
        after: { bookId: book.id, studentId: student.id, dueDate: input.dueDate },
      });
      return { ...issue, bookTitle: book.title };
    });
  }

  async returnBook(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof returnBookSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const issue = await tx.libraryIssue.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!issue) throw new NotFoundError('Issue record');
      if (issue.status !== 'ISSUED') throw new ConflictError('This book is already returned');
      const returnDate = input.returnDate
        ? new Date(`${input.returnDate}T00:00:00.000Z`)
        : new Date(new Date().toISOString().slice(0, 10));
      const lateDays = Math.max(
        0,
        Math.floor((returnDate.getTime() - issue.dueDate.getTime()) / 86_400_000),
      );
      const fineMinor = lateDays * input.finePerDayMinor;
      const updated = await tx.libraryIssue.update({
        where: { id },
        data: { returnDate, fineMinor, status: 'RETURNED' },
      });
      await tx.libraryBook.update({
        where: { id: issue.bookId },
        data: { available: { increment: 1 } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'library.book_returned',
        entity: 'LibraryIssue',
        entityId: id,
        after: { returnDate: returnDate.toISOString().slice(0, 10), fineMinor },
      });
      return { ...updated, lateDays };
    });
  }

  async summary(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [titles, copies, issued, overdue, fines] = await Promise.all([
        tx.libraryBook.count({ where: { schoolId: auth.schoolId } }),
        tx.libraryBook.aggregate({ where: { schoolId: auth.schoolId }, _sum: { copies: true, available: true } }),
        tx.libraryIssue.count({ where: { schoolId: auth.schoolId, status: 'ISSUED' } }),
        tx.libraryIssue.count({
          where: { schoolId: auth.schoolId, status: 'ISSUED', dueDate: { lt: new Date() } },
        }),
        tx.libraryIssue.aggregate({
          where: { schoolId: auth.schoolId, status: 'RETURNED' },
          _sum: { fineMinor: true },
        }),
      ]);
      return {
        titles,
        copies: copies._sum.copies ?? 0,
        available: copies._sum.available ?? 0,
        issued,
        overdue,
        finesMinor: fines._sum.fineMinor ?? 0,
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
