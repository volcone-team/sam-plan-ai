import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { formatDate } from '@/lib/format-date';
import {
  NOT_ANSWERED,
  type AnswerField,
  type AnswerItem,
  type AnswerSection,
} from '@/lib/intake/answers-view';

/**
 * Settings → "Intake answers": the company's intake questionnaire, read-only.
 *
 * Presentational only. No hooks and no client state, so it renders on the
 * server inside the client-side tab shell. There are deliberately no edit
 * controls: the intake is the one place answers are changed.
 */

export type IntakeAnswersData =
  | { status: 'ok'; sections: AnswerSection[]; updatedAt: string | null }
  | { status: 'empty' }
  | { status: 'error' };

export function IntakeAnswers({ data }: { data: IntakeAnswersData }) {
  if (data.status === 'error') {
    return (
      <p className="text-sm text-[hsl(var(--foreground-muted))]" role="alert">
        We couldn&apos;t load your intake answers. Please refresh the page to try again.
      </p>
    );
  }

  if (data.status === 'empty') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <ClipboardList
          className="h-8 w-8 text-[hsl(var(--foreground-muted))]"
          aria-hidden="true"
        />
        <p className="text-sm text-foreground">You haven&apos;t completed the intake yet.</p>
        <Link
          href="/intake/start"
          className="text-sm font-medium text-[hsl(var(--primary))] underline underline-offset-2"
        >
          Start the intake
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Your intake answers</h2>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            What your company told us in the intake questionnaire.
          </p>
        </div>
        {data.updatedAt && (
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Last updated {formatDate(data.updatedAt)}
          </p>
        )}
      </div>

      {data.sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`intake-section-${section.id}`}
          className="rounded-[var(--radius-lg)] border border-border p-4 sm:p-5"
        >
          <h3
            id={`intake-section-${section.id}`}
            className="mb-2 text-sm font-semibold text-foreground"
          >
            {section.title}
          </h3>
          <dl className="divide-y divide-border">
            {section.items.map((item, index) => (
              <Item key={`${item.label}-${index}`} item={item} />
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Item({ item }: { item: AnswerItem }) {
  if (item.kind === 'field') return <FieldRow field={item} />;

  return (
    <div className="py-3">
      <dt className="text-sm text-[hsl(var(--foreground-muted))]">{item.label}</dt>
      <dd className="mt-2">
        {item.records.length === 0 ? (
          <Missing />
        ) : (
          <ul className="space-y-3">
            {item.records.map((record, index) => (
              <li
                key={`${record.title}-${index}`}
                className="rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-3 py-2 sm:px-4"
              >
                <p className="py-1 text-sm font-medium text-foreground">{record.title}</p>
                <dl className="divide-y divide-border">
                  {record.items.map((field, fieldIndex) => (
                    <FieldRow key={`${field.label}-${fieldIndex}`} field={field} compact />
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

function FieldRow({ field, compact }: { field: AnswerField; compact?: boolean }) {
  return (
    <div
      className={`grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4 ${
        compact ? 'py-2' : 'py-3'
      }`}
    >
      <dt className="text-sm text-[hsl(var(--foreground-muted))]">{field.label}</dt>
      <dd
        className={`text-sm text-foreground break-words ${
          field.multiline ? 'whitespace-pre-line' : ''
        }`}
      >
        {field.value === null ? <Missing /> : field.value}
      </dd>
    </div>
  );
}

function Missing() {
  return (
    <span className="text-sm italic text-[hsl(var(--foreground-muted))]">{NOT_ANSWERED}</span>
  );
}
