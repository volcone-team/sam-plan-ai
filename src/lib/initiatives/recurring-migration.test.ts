import { describe, it, expect } from 'vitest';
import { isRecurringMigrationMissing, RECURRING_DISABLED } from './recurring-migration';

describe('isRecurringMigrationMissing', () => {
  it.each([
    // Exactly what the live database returned before 046 was applied.
    { code: 'PGRST205', message: "Could not find the table 'public.initiative_instances' in the schema cache" },
    { code: '42703', message: 'column initiatives.correction_kept_at does not exist' },
    { code: 'PGRST204', message: "Could not find the 'correction_kept_at' column of 'initiatives' in the schema cache" },
    { code: '42P01', message: 'relation "initiative_instances" does not exist' },
  ])('reads $code as the migration missing', (err) => {
    expect(isRecurringMigrationMissing(err)).toBe(true);
  });

  it('falls back to the message when there is no code', () => {
    expect(isRecurringMigrationMissing({ message: 'relation "initiative_instances" does not exist' })).toBe(true);
    expect(isRecurringMigrationMissing({ message: 'column initiatives.correction_kept_at does not exist' })).toBe(true);
  });

  it('does not swallow other errors', () => {
    expect(isRecurringMigrationMissing({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isRecurringMigrationMissing({ code: '42501', message: 'permission denied for table initiatives' })).toBe(false);
    expect(isRecurringMigrationMissing({ code: '22P02', message: 'invalid input syntax for type uuid' })).toBe(false);
    expect(isRecurringMigrationMissing(null)).toBe(false);
    expect(isRecurringMigrationMissing(undefined)).toBe(false);
    expect(isRecurringMigrationMissing('PGRST205')).toBe(false);
  });

  it('the disabled body is exactly { enabled: false }', () => {
    expect(RECURRING_DISABLED).toEqual({ enabled: false });
  });
});
