// src/lib/db/errors.ts
// Typed error taxonomy for PostgreSQL database operations

export class DatabaseError extends Error {
  public readonly code?: string;
  public readonly detail?: string;
  public readonly constraint?: string;
  public readonly table?: string;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'DatabaseError';

    if (originalError && typeof originalError === 'object') {
      const err = originalError as Record<string, unknown>;
      this.code = typeof err.code === 'string' ? err.code : undefined;
      this.detail = typeof err.detail === 'string' ? err.detail : undefined;
      this.constraint = typeof err.constraint === 'string' ? err.constraint : undefined;
      this.table = typeof err.table === 'string' ? err.table : undefined;
    }
  }
}

export class UniqueConstraintViolationError extends DatabaseError {
  constructor(message: string, originalError?: unknown) {
    super(message, originalError);
    this.name = 'UniqueConstraintViolationError';
  }
}

export class ForeignKeyViolationError extends DatabaseError {
  constructor(message: string, originalError?: unknown) {
    super(message, originalError);
    this.name = 'ForeignKeyViolationError';
  }
}

export class CheckConstraintViolationError extends DatabaseError {
  constructor(message: string, originalError?: unknown) {
    super(message, originalError);
    this.name = 'CheckConstraintViolationError';
  }
}

export class TransactionAbortedError extends DatabaseError {
  constructor(message: string, originalError?: unknown) {
    super(message, originalError);
    this.name = 'TransactionAbortedError';
  }
}

export class QueryTimeoutError extends DatabaseError {
  constructor(message: string, originalError?: unknown) {
    super(message, originalError);
    this.name = 'QueryTimeoutError';
  }
}

/**
 * Normalizes PostgreSQL error codes into strongly typed error classes.
 */
export function wrapDatabaseError(error: unknown): Error {
  if (error instanceof DatabaseError) {
    return error;
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code: string; message: string; constraint?: string };
    const constraintName = pgError.constraint ? ` (constraint: ${pgError.constraint})` : '';

    switch (pgError.code) {
      case '23505':
        return new UniqueConstraintViolationError(
          `Unique constraint violation${constraintName}: ${pgError.message}`,
          pgError
        );
      case '23503':
        return new ForeignKeyViolationError(
          `Foreign key constraint violation${constraintName}: ${pgError.message}`,
          pgError
        );
      case '23514':
        return new CheckConstraintViolationError(
          `Check constraint violation${constraintName}: ${pgError.message}`,
          pgError
        );
      case '25P02':
        return new TransactionAbortedError(`Current transaction is aborted: ${pgError.message}`, pgError);
      case '57014':
        return new QueryTimeoutError(`Database statement timed out: ${pgError.message}`, pgError);
      default:
        return new DatabaseError(`Database error [${pgError.code}]: ${pgError.message}`, pgError);
    }
  }

  return error instanceof Error ? error : new DatabaseError(String(error));
}
