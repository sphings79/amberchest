import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Notifier } from '../src/notify/notifier.js';
import type { NotificationSettings } from '../src/types.js';

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

interface Received {
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

async function receiver(status = 200): Promise<{ url: string; got: Received[] }> {
  const got: Received[] = [];
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      got.push({ body, headers: request.headers });
      response.writeHead(status);
      response.end('ok');
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server!.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/hook`, got };
}

function settings(part: Partial<NotificationSettings>): NotificationSettings {
  return {
    enabled: true,
    url: '',
    format: 'json',
    authHeader: '',
    events: {
      backupFailed: true,
      backupFinished: false,
      verifyProblems: true,
      lowDiskSpace: true,
    },
    ...part,
  };
}

describe('Notifier', () => {
  it('sends the events that are switched on, and stays quiet for the others', async () => {
    const { url, got } = await receiver();
    const notifier = new Notifier(() => settings({ url }));

    await notifier.send({ event: 'backupFailed', level: 'error', title: 'A', message: 'B' });
    // backupFinished is off in these settings.
    await notifier.send({ event: 'backupFinished', level: 'info', title: 'C', message: 'D' });

    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]!.body)).toMatchObject({ event: 'backupFailed', title: 'A' });
  });

  it('says nothing at all while it is switched off', async () => {
    const { url, got } = await receiver();
    const notifier = new Notifier(() => settings({ url, enabled: false }));
    await notifier.send({ event: 'backupFailed', level: 'error', title: 'A', message: 'B' });
    expect(got).toHaveLength(0);
  });

  it('speaks the shape each service expects', async () => {
    const { url, got } = await receiver();

    await new Notifier(() => settings({ url, format: 'discord' })).send({
      event: 'backupFailed',
      level: 'error',
      title: 'Titel',
      message: 'Text',
    });
    expect(JSON.parse(got[0]!.body).content).toContain('Titel');

    await new Notifier(() => settings({ url, format: 'gotify' })).send({
      event: 'backupFailed',
      level: 'error',
      title: 'Titel',
      message: 'Text',
    });
    expect(JSON.parse(got[1]!.body)).toMatchObject({ title: 'Titel', message: 'Text', priority: 8 });

    await new Notifier(() => settings({ url, format: 'ntfy' })).send({
      event: 'backupFailed',
      level: 'error',
      title: 'Titel',
      message: 'Text',
    });
    // ntfy takes the message as the body and the title as a header.
    expect(got[2]!.body).toBe('Text');
    expect(got[2]!.headers.title).toBe('Titel');

    await new Notifier(() => settings({ url, format: 'apprise' })).send({
      event: 'backupFailed',
      level: 'error',
      title: 'Titel',
      message: 'Text',
    });
    expect(JSON.parse(got[3]!.body)).toMatchObject({ title: 'Titel', body: 'Text' });
  });

  it('passes a token header along', async () => {
    const { url, got } = await receiver();
    await new Notifier(() => settings({ url, authHeader: 'X-Token: abc123' })).send({
      event: 'backupFailed',
      level: 'error',
      title: 'A',
      message: 'B',
    });
    expect(got[0]!.headers['x-token']).toBe('abc123');
  });

  it('never lets a failing webhook escape', async () => {
    const notifier = new Notifier(() => settings({ url: 'http://127.0.0.1:1/nothing-here' }));
    await expect(
      notifier.send({ event: 'backupFailed', level: 'error', title: 'A', message: 'B' }),
    ).resolves.toBeUndefined();
  });

  it('reports the outcome when the user presses test', async () => {
    const { url } = await receiver(500);
    const notifier = new Notifier(() => settings({ url }));
    const result = await notifier.trySend({
      event: 'test',
      level: 'info',
      title: 'A',
      message: 'B',
    });
    expect(result).toEqual({ ok: false, error: 'HTTP 500' });
  });
});
