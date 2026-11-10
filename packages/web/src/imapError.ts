import type { ConnectionTestResult } from '@amberchest/core';
import type { TFunction } from 'i18next';

/**
 * The text for a failed connection test, in the language of the interface.
 *
 * The server words every error in English, because the same text goes to the
 * log and the run history. The common failures carry a code, which is worded
 * here; any other failure keeps the server's own text, since that is often
 * what the mail provider said and not something to paraphrase.
 */
export function describeTestError(t: TFunction, result: Pick<ConnectionTestResult, 'error' | 'errorCode'>): string {
  if (result.errorCode) return t(`imapError.${result.errorCode}`);
  return result.error ?? t('imapError.unknown');
}
