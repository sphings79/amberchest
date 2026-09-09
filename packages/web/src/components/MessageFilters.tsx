import type { SearchField, SearchSort } from '@amberchest/core';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Input, Select, Toggle } from './ui.js';

/**
 * The filters over a list of messages.
 *
 * Shared between the search and the mailbox on purpose: the two ask the same
 * questions of the same index, and a filter that exists in one and not the
 * other is a filter somebody will look for in the wrong place.
 */
export interface MessageFilterValues {
  accountId: string;
  from: string;
  to: string;
  field: SearchField;
  sort: SearchSort;
  dateFrom: string;
  dateTo: string;
  withAttachments: boolean;
  unreadOnly: boolean;
  flaggedOnly: boolean;
  includeDeleted: boolean;
  /** Kept as text so the fields can be empty. */
  minSizeKb: string;
  maxSizeKb: string;
  folders: string[];
}

export const EMPTY_MESSAGE_FILTERS: MessageFilterValues = {
  accountId: '',
  from: '',
  to: '',
  field: 'all',
  sort: 'relevance',
  dateFrom: '',
  dateTo: '',
  withAttachments: false,
  unreadOnly: false,
  flaggedOnly: false,
  includeDeleted: false,
  minSizeKb: '',
  maxSizeKb: '',
  folders: [],
};

/** How many are set, for the little badge on the button that opens the panel. */
export function activeFilterCount(filters: MessageFilterValues, countFolders = true): number {
  let count = 0;
  if (filters.from) count += 1;
  if (filters.to) count += 1;
  if (filters.field !== 'all') count += 1;
  if (filters.dateFrom) count += 1;
  if (filters.dateTo) count += 1;
  if (filters.withAttachments) count += 1;
  if (filters.unreadOnly) count += 1;
  if (filters.flaggedOnly) count += 1;
  if (filters.includeDeleted) count += 1;
  if (filters.minSizeKb) count += 1;
  if (filters.maxSizeKb) count += 1;
  if (countFolders) count += filters.folders.length;
  return count;
}

/** Kilobytes from an input field into bytes, ignoring anything unusable. */
export function sizeToBytes(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 : undefined;
}

/** Everything the two screens send to the search endpoint alike. */
export function toSearchOptions(filters: MessageFilterValues): {
  from?: string;
  to?: string;
  field: SearchField;
  sort: SearchSort;
  dateFrom?: string;
  dateTo?: string;
  withAttachments: boolean;
  unreadOnly: boolean;
  flaggedOnly: boolean;
  includeDeleted: boolean;
  minSize?: number;
  maxSize?: number;
} {
  return {
    from: filters.from || undefined,
    to: filters.to || undefined,
    field: filters.field,
    sort: filters.sort,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    withAttachments: filters.withAttachments,
    unreadOnly: filters.unreadOnly,
    flaggedOnly: filters.flaggedOnly,
    includeDeleted: filters.includeDeleted,
    minSize: sizeToBytes(filters.minSizeKb),
    maxSize: sizeToBytes(filters.maxSizeKb),
  };
}

export function MessageFilters({
  filters,
  onChange,
  folderOptions = [],
  showSort = true,
}: {
  filters: MessageFilterValues;
  onChange: (next: MessageFilterValues) => void;
  /** Folders to offer as chips; empty hides the row, as in the mailbox where
   *  the folder is already the thing that was clicked. */
  folderOptions?: string[];
  showSort?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const set = (part: Partial<MessageFilterValues>): void => onChange({ ...filters, ...part });

  return (
    <div
      className="animate-fade-up flex flex-col gap-3 rounded-xl p-3"
      style={{ background: 'var(--surface-2)' }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('search.from')}>
          <Input value={filters.from} onChange={(event) => set({ from: event.target.value })} />
        </Field>
        <Field label={t('search.to')}>
          <Input value={filters.to} onChange={(event) => set({ to: event.target.value })} />
        </Field>
        <Field label={t('search.field')}>
          <Select
            value={filters.field}
            onChange={(event) => set({ field: event.target.value as SearchField })}
          >
            <option value="all">{t('search.fieldAll')}</option>
            <option value="subject">{t('search.fieldSubject')}</option>
            <option value="from">{t('search.fieldFrom')}</option>
            <option value="to">{t('search.fieldTo')}</option>
            <option value="body">{t('search.fieldBody')}</option>
            <option value="attachments">{t('search.fieldAttachments')}</option>
          </Select>
        </Field>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${showSort ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <Field label={t('search.dateFrom')}>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => set({ dateFrom: event.target.value })}
          />
        </Field>
        <Field label={t('search.dateTo')}>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(event) => set({ dateTo: event.target.value })}
          />
        </Field>
        {showSort && (
          <Field label={t('search.sort')}>
            <Select
              value={filters.sort}
              onChange={(event) => set({ sort: event.target.value as SearchSort })}
            >
              <option value="relevance">{t('search.sortRelevance')}</option>
              <option value="date-desc">{t('search.sortDateDesc')}</option>
              <option value="date-asc">{t('search.sortDateAsc')}</option>
              <option value="size-desc">{t('search.sortSizeDesc')}</option>
              <option value="size-asc">{t('search.sortSizeAsc')}</option>
            </Select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('search.minSize')}>
          <Input
            type="number"
            min={0}
            placeholder="0"
            value={filters.minSizeKb}
            onChange={(event) => set({ minSizeKb: event.target.value })}
          />
        </Field>
        <Field label={t('search.maxSize')}>
          <Input
            type="number"
            min={0}
            placeholder="0"
            value={filters.maxSizeKb}
            onChange={(event) => set({ maxSizeKb: event.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Toggle
          checked={filters.withAttachments}
          onChange={(withAttachments) => set({ withAttachments })}
          label={t('search.withAttachments')}
        />
        <Toggle
          checked={filters.unreadOnly}
          onChange={(unreadOnly) => set({ unreadOnly })}
          label={t('search.unreadOnly')}
        />
        <Toggle
          checked={filters.flaggedOnly}
          onChange={(flaggedOnly) => set({ flaggedOnly })}
          label={t('search.flaggedOnly')}
        />
        <Toggle
          checked={filters.includeDeleted}
          onChange={(includeDeleted) => set({ includeDeleted })}
          label={t('search.includeDeleted')}
        />
      </div>

      {folderOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {folderOptions.map((path) => {
            const active = filters.folders.includes(path);
            return (
              <button
                key={path}
                type="button"
                onClick={() =>
                  set({
                    folders: active
                      ? filters.folders.filter((value) => value !== path)
                      : [...filters.folders, path],
                  })
                }
                className="rounded-full border px-2.5 py-1 text-xs transition"
                style={{
                  background: active ? 'var(--accent-soft)' : 'var(--surface-1)',
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {path}
              </button>
            );
          })}
        </div>
      )}

      <Button
        variant="ghost"
        className="self-start"
        onClick={() => onChange({ ...EMPTY_MESSAGE_FILTERS, accountId: filters.accountId })}
      >
        {t('search.reset')}
      </Button>
    </div>
  );
}
