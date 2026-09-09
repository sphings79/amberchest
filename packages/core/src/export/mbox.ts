/**
 * mbox writer in the mboxrd flavour.
 *
 * Thunderbird, Apple Mail and mutt all read this: messages separated by a
 * "From " line, and any line in the body that starts with "From " (or with a
 * run of ">" before it) gets one more ">" so the separator stays unambiguous.
 */

const FROM_LINE = /^(>*From )/;

function mboxDate(when: Date): string {
  const valid = Number.isNaN(when.getTime()) ? new Date(0) : when;
  // asctime format: "Thu Jan 15 14:30:22 2024"
  return valid.toUTCString().replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) ([\d:]{8}) GMT$/, '$1 $3 $2 $5 $4');
}

/** Escapes body lines and prefixes the message with its separator line. */
export function toMboxEntry(source: Buffer, from: string | null, date: Date): Buffer {
  const text = source.toString('binary');
  const escaped = text
    .split(/\r?\n/)
    .map((line) => (FROM_LINE.test(line) ? `>${line}` : line))
    .join('\n');

  const separator = `From ${from ?? 'amberchest@localhost'} ${mboxDate(date)}\n`;
  const trailing = escaped.endsWith('\n') ? '\n' : '\n\n';
  return Buffer.from(separator + escaped + trailing, 'binary');
}

/** Concatenates messages into one mbox file. */
export class MboxWriter {
  private readonly parts: Buffer[] = [];

  add(source: Buffer, from: string | null, date: Date): void {
    this.parts.push(toMboxEntry(source, from, date));
  }

  finish(): Buffer {
    return Buffer.concat(this.parts);
  }

  get size(): number {
    return this.parts.reduce((sum, part) => sum + part.length, 0);
  }
}
