import { describe, expect, it } from 'vitest';
import type { AccountOverview } from '../src/app.js';
import { accountDiscovery, hubDiscovery } from '../src/mqtt/discovery.js';
import { accountSlug, accountSlugs, buildTopics, slugFromCommandTopic } from '../src/mqtt/topics.js';

function overview(id: string, name: string): AccountOverview {
  return {
    account: {
      id,
      name,
      email: `${name}@example.com`,
      host: 'mail.example.com',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'user',
      archivePath: null,
      selectedFolders: [],
      settings: {
        concurrency: 2,
        batchSize: 200,
        requestDelayMs: 0,
        sinceDate: null,
        deletedHandling: 'move-to-deleted',
        deletedRetentionDays: null,
        autoSelectNewFolders: false,
      },
      attachments: {
        targetPath: null,
        layout: 'folder-tree',
        includeInline: false,
        minSizeBytes: 0,
        extensionMode: 'all',
        extensions: [],
        deduplicate: true,
        writeManifest: true,
        folders: [],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    messageCount: 10,
    deletedCount: 0,
    folderCount: 3,
    bytes: 1234,
    lastRun: null,
    running: false,
    progress: null,
    attachmentCount: 0,
    attachmentBytes: 0,
    indexedCount: 10,
    indexRunning: false,
    exportRunning: false,
    exportProgress: null,
  };
}

describe('accountSlug', () => {
  it('makes a topic segment out of a name', () => {
    expect(accountSlug(overview('a', 'Privat'))).toBe('privat');
    expect(accountSlug(overview('a', 'Büro Müller'))).toBe('buero_mueller');
    expect(accountSlug(overview('a', 'Arbeit / GmbH & Co'))).toBe('arbeit_gmbh_co');
  });

  it('falls back to the id when nothing usable is left', () => {
    expect(accountSlug(overview('abcdef1234', '+++'))).toBe('abcdef12');
  });

  it('keeps two accounts with the same name apart', () => {
    const slugs = accountSlugs([overview('a', 'Privat'), overview('b', 'Privat')]);
    expect(slugs.get('a')).toBe('privat');
    expect(slugs.get('b')).toBe('privat_2');
  });
});

describe('topics', () => {
  it('puts the account into the path', () => {
    const topics = buildTopics('mailarchiver');
    expect(topics.status).toBe('mailarchiver/status');
    expect(topics.accountState('privat')).toBe('mailarchiver/account/privat/state');
    expect(topics.accountCommand('privat')).toBe('mailarchiver/account/privat/set');
    expect(topics.accountCommandFilter).toBe('mailarchiver/account/+/set');
  });

  it('tolerates slashes around the base topic', () => {
    expect(buildTopics('/haus/mail/').state).toBe('haus/mail/state');
  });

  it('reads the account back out of a command topic', () => {
    expect(slugFromCommandTopic('mailarchiver/account/privat/set')).toBe('privat');
    expect(slugFromCommandTopic('mailarchiver/state')).toBeNull();
  });
});

describe('discovery', () => {
  const options = {
    prefix: 'homeassistant',
    baseTopic: 'mailarchiver',
    topics: buildTopics('mailarchiver'),
    version: '1.0.0',
    allowCommands: true,
  };

  it('describes the two instance sensors', () => {
    const messages = hubDiscovery(options);
    expect(messages.map((message) => message.topic)).toEqual([
      'homeassistant/sensor/mailarchiver_total_size/config',
      'homeassistant/sensor/mailarchiver_next_run/config',
    ]);
  });

  it('points every account entity at the account topic', () => {
    const messages = accountDiscovery(overview('11-22', 'Privat'), 'privat', options);
    expect(messages).toHaveLength(5);
    for (const message of messages) {
      const payload = message.payload as Record<string, unknown>;
      const topic = (payload.state_topic ?? payload.command_topic) as string;
      expect(topic).toContain('/account/privat/');
      expect(payload.unique_id as string).toContain('mailarchiver_1122');
    }
  });

  it('leaves the button out when commands are switched off', () => {
    const messages = accountDiscovery(overview('11-22', 'Privat'), 'privat', {
      ...options,
      allowCommands: false,
    });
    expect(messages).toHaveLength(4);
    expect(messages.some((message) => message.topic.includes('/button/'))).toBe(false);
  });
});
