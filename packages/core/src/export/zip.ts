import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { deflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP writer.
 *
 * Everything AmberChest needs to bundle files is here: deflate, UTF-8 file
 * names and ZIP64 for archives beyond 4 GB is deliberately *not* supported -
 * an export that large should use the folder tree instead. Writing this by
 * hand keeps another dependency out of the tree.
 */

interface Entry {
  name: string;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  time: number;
  date: number;
}

function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.max(when.getFullYear(), 1980);
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private readonly chunks: Buffer[] = [];
  private offset = 0;

  /** Adds one file. Names use forward slashes, as the format requires. */
  add(name: string, content: Buffer, modified = new Date()): void {
    const safeName = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuffer = Buffer.from(safeName, 'utf8');
    const compressed = deflateRawSync(content, { level: 6 });
    const useDeflate = compressed.length < content.length;
    const payload = useDeflate ? compressed : content;
    const { time, date } = dosDateTime(modified);
    const crc = crc32(content);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 file names
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);

    this.entries.push({
      name: safeName,
      crc,
      compressedSize: payload.length,
      uncompressedSize: content.length,
      offset: this.offset,
      time,
      date,
    });

    this.chunks.push(header, nameBuffer, payload);
    this.offset += header.length + nameBuffer.length + payload.length;
  }

  /** Produces the finished archive. */
  finish(): Buffer {
    const directory: Buffer[] = [];
    let directorySize = 0;

    for (const entry of this.entries) {
      const nameBuffer = Buffer.from(entry.name, 'utf8');
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(20, 4); // version made by
      record.writeUInt16LE(20, 6); // version needed
      record.writeUInt16LE(0x0800, 8);
      record.writeUInt16LE(entry.compressedSize === entry.uncompressedSize ? 0 : 8, 10);
      record.writeUInt16LE(entry.time, 12);
      record.writeUInt16LE(entry.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.compressedSize, 20);
      record.writeUInt32LE(entry.uncompressedSize, 24);
      record.writeUInt16LE(nameBuffer.length, 28);
      record.writeUInt32LE(entry.offset, 42);

      directory.push(record, nameBuffer);
      directorySize += record.length + nameBuffer.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(this.offset, 16);

    return Buffer.concat([...this.chunks, ...directory, end]);
  }

  async writeTo(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await pipeline(Readable.from([this.finish()]), createWriteStream(path));
  }
}
