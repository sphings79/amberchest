import { EventEmitter } from 'node:events';
import mqtt, { type MqttClient } from 'mqtt';
import type { AccountOverview } from '../app.js';
import type { MqttSettings, SyncProgress, SyncStats } from '../types.js';
import { logger } from '../util/logger.js';
import { APP_VERSION } from '../util/version.js';
import { accountDiscovery, hubDiscovery, removalMessages, type DiscoveryMessage } from './discovery.js';
import { accountSlugs, buildTopics, slugFromCommandTopic, type Topics } from './topics.js';

export interface MqttStatus {
  enabled: boolean;
  connected: boolean;
  /** Broker the client is talking to, without the credentials. */
  url: string;
  baseTopic: string;
  lastError: string | null;
  lastPublishedAt: string | null;
  publishedAccounts: number;
}

export interface MqttBridgeOptions {
  settings: () => MqttSettings;
  overview: () => AccountOverview[];
  startSync: (accountId: string) => Promise<unknown>;
  cancelSync: (accountId: string) => boolean;
  /** Set by the container, which is the only place with a schedule. */
  nextRun?: () => Date | null;
}

const COMMANDS = new Set(['backup', 'cancel']);

/**
 * Publishes the state of every account to an MQTT broker.
 *
 * Home Assistant picks the entities up through MQTT discovery, so nothing has
 * to be configured there. The account is part of the topic
 * (`<base>/account/<account>/state`), which keeps several mailboxes apart and
 * makes the topics readable in any MQTT client.
 *
 * Commands are a separate switch: with them turned off the bridge never
 * subscribes and publishes no buttons, so the integration can be read only.
 */
export class MqttBridge extends EventEmitter {
  private client: MqttClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private topics: Topics = buildTopics('amberchest');
  private slugs = new Map<string, string>();
  private published: DiscoveryMessage[] = [];
  private connected = false;
  private lastError: string | null = null;
  private lastPublishedAt: string | null = null;
  /** Set while stop() runs, so the reconnect handler stays quiet. */
  private stopping = false;

  private nextRun: (() => Date | null) | null = null;

  constructor(private readonly options: MqttBridgeOptions) {
    super();
    this.nextRun = options.nextRun ?? null;
  }

  /** The container hands in its scheduler once it exists. */
  setNextRunProvider(nextRun: () => Date | null): void {
    this.nextRun = nextRun;
  }

  get status(): MqttStatus {
    const settings = this.options.settings();
    return {
      enabled: settings.enabled,
      connected: this.connected,
      url: settings.url,
      baseTopic: settings.baseTopic,
      lastError: this.lastError,
      lastPublishedAt: this.lastPublishedAt,
      publishedAccounts: this.slugs.size,
    };
  }

  /** Starts, stops or restarts the client so it matches the settings. */
  async apply(): Promise<void> {
    const settings = this.options.settings();
    await this.stop();
    if (!settings.enabled) return;
    if (!settings.url.trim()) {
      this.lastError = 'No broker address configured';
      logger.warn('MQTT is enabled but no broker address is configured');
      return;
    }
    this.start(settings);
  }

  private start(settings: MqttSettings): void {
    this.stopping = false;
    this.topics = buildTopics(settings.baseTopic);
    this.lastError = null;

    const client = mqtt.connect(settings.url, {
      ...(settings.username ? { username: settings.username } : {}),
      ...(settings.password ? { password: settings.password } : {}),
      ...(settings.clientId ? { clientId: settings.clientId } : {}),
      reconnectPeriod: 5000,
      connectTimeout: 15_000,
      rejectUnauthorized: settings.rejectUnauthorized,
      // The broker sends this for us when the connection dies, which is what
      // makes every entity go unavailable instead of showing a stale value.
      will: { topic: this.topics.status, payload: 'offline', qos: 1, retain: true },
    });
    this.client = client;

    client.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      logger.info(`MQTT connected to ${settings.url} (base topic ${settings.baseTopic})`);
      void this.onConnected(settings);
      this.emit('status', this.status);
    });

    client.on('reconnect', () => {
      this.connected = false;
    });

    client.on('close', () => {
      if (this.connected) logger.warn('MQTT connection closed');
      this.connected = false;
      this.emit('status', this.status);
    });

    client.on('error', (error: Error) => {
      this.lastError = error.message;
      logger.warn(`MQTT error: ${error.message}`);
      this.emit('status', this.status);
    });

    client.on('message', (topic: string, payload: Buffer) => {
      void this.onCommand(topic, payload.toString('utf8'));
    });

    const interval = Math.max(settings.publishIntervalSeconds, 10) * 1000;
    this.timer = setInterval(() => void this.publishState(), interval);
  }

  private async onConnected(settings: MqttSettings): Promise<void> {
    await this.publish(this.topics.status, 'online', true);

    if (settings.allowCommands) {
      this.client?.subscribe(this.topics.accountCommandFilter, { qos: 1 });
    }
    if (settings.discovery) this.publishDiscovery(settings);
    await this.publishState();
  }

  /** Publishes the discovery configs and removes the ones no longer needed. */
  private publishDiscovery(settings: MqttSettings): void {
    const accounts = this.options.overview();
    this.slugs = accountSlugs(accounts);

    const options = {
      prefix: settings.discoveryPrefix.replace(/^\/+|\/+$/g, '') || 'homeassistant',
      baseTopic: settings.baseTopic,
      topics: this.topics,
      version: APP_VERSION,
      allowCommands: settings.allowCommands,
    };

    const messages = [
      ...hubDiscovery(options),
      ...accounts.flatMap((overview) =>
        accountDiscovery(overview, this.slugs.get(overview.account.id) ?? overview.account.id, options),
      ),
    ];

    // An account that was deleted or renamed leaves its retained config
    // behind, which would show up in Home Assistant as an entity that never
    // updates again.
    const current = new Set(messages.map((message) => message.topic));
    const gone = removalMessages(this.published.filter((message) => !current.has(message.topic)));

    for (const message of [...messages, ...gone]) {
      void this.publish(message.topic, message.payload ? JSON.stringify(message.payload) : '', true);
    }
    this.published = messages;
  }

  /** Publishes one JSON document per account plus the instance totals. */
  async publishState(): Promise<void> {
    if (!this.client?.connected) return;
    const settings = this.options.settings();
    const accounts = this.options.overview();

    // A new account has to get its discovery config before its state.
    if (settings.discovery && accounts.some((entry) => !this.slugs.has(entry.account.id))) {
      this.publishDiscovery(settings);
    }

    let bytes = 0;
    let messages = 0;
    let syncing = false;

    for (const overview of accounts) {
      bytes += overview.bytes;
      messages += overview.messageCount;
      if (overview.running) syncing = true;

      const slug = this.slugs.get(overview.account.id) ?? overview.account.id;
      await this.publish(
        this.topics.accountState(slug),
        JSON.stringify(accountState(overview)),
        settings.retain,
      );
    }

    const next = this.nextRun?.() ?? null;
    await this.publish(
      this.topics.state,
      JSON.stringify({
        accounts: accounts.length,
        messages,
        bytes,
        syncing,
        next_run: next ? next.toISOString() : null,
        version: APP_VERSION,
      }),
      settings.retain,
    );

    this.lastPublishedAt = new Date().toISOString();
  }

  /** Publishes one account after a progress event, without the whole sweep. */
  async publishAccount(accountId: string): Promise<void> {
    if (!this.client?.connected) return;
    const overview = this.options.overview().find((entry) => entry.account.id === accountId);
    if (!overview) return;
    const slug = this.slugs.get(accountId) ?? accountId;
    await this.publish(
      this.topics.accountState(slug),
      JSON.stringify(accountState(overview)),
      this.options.settings().retain,
    );
    this.lastPublishedAt = new Date().toISOString();
  }

  private async onCommand(topic: string, payload: string): Promise<void> {
    const settings = this.options.settings();
    if (!settings.allowCommands) return;

    const slug = slugFromCommandTopic(topic);
    if (!slug) return;

    const command = payload.trim().toLowerCase();
    if (!COMMANDS.has(command)) {
      logger.warn(`MQTT command ignored, unknown payload "${payload}" on ${topic}`);
      return;
    }

    const accountId = [...this.slugs.entries()].find(([, value]) => value === slug)?.[0];
    if (!accountId) {
      logger.warn(`MQTT command ignored, no account for "${slug}"`);
      return;
    }

    if (command === 'cancel') {
      logger.info(`MQTT: cancelling the backup of ${slug}`);
      this.options.cancelSync(accountId);
      await this.publishAccount(accountId);
      return;
    }

    logger.info(`MQTT: starting a backup of ${slug}`);
    try {
      await this.options.startSync(accountId);
    } catch (error) {
      logger.warn(`MQTT backup could not start: ${(error as Error).message}`);
    }
    await this.publishAccount(accountId);
  }

  private publish(topic: string, payload: string, retain: boolean): Promise<void> {
    return new Promise((resolve) => {
      if (!this.client?.connected) return resolve();
      this.client.publish(topic, payload, { qos: 1, retain }, (error) => {
        if (error) {
          this.lastError = error.message;
          logger.warn(`MQTT publish to ${topic} failed: ${error.message}`);
        }
        resolve();
      });
    });
  }

  /** Says goodbye properly, so Home Assistant does not wait for the will. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const client = this.client;
    if (!client) return;
    this.stopping = true;
    this.client = null;

    if (client.connected) await this.publishOffline(client);
    await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));

    this.connected = false;
    this.slugs.clear();
    this.published = [];
    this.emit('status', this.status);
  }

  private publishOffline(client: MqttClient): Promise<void> {
    return new Promise((resolve) => {
      client.publish(this.topics.status, 'offline', { qos: 1, retain: true }, () => resolve());
    });
  }
}

/** A sync_runs row, as it comes out of the database. */
interface RunRow {
  started_at?: string;
  finished_at?: string | null;
  status?: string;
  /** JSON, because SQLite has no object column. */
  stats?: string;
  error?: string | null;
}

/** The document one account publishes; every field is flat for a template. */
function accountState(overview: AccountOverview): Record<string, unknown> {
  const progress: SyncProgress | null = overview.progress;
  const run = overview.lastRun as RunRow | null;
  const stats = parseStats(run?.stats);

  return {
    name: overview.account.name,
    email: overview.account.email,
    messages: overview.messageCount,
    deleted: overview.deletedCount,
    folders: overview.folderCount,
    bytes: overview.bytes,
    attachments: overview.attachmentCount,
    attachment_bytes: overview.attachmentBytes,
    indexed: overview.indexedCount,
    syncing: overview.running,
    phase: progress?.phase ?? null,
    current_folder: progress?.currentFolder ?? null,
    last_backup: run?.finished_at ?? run?.started_at ?? null,
    last_backup_status: run?.status ?? null,
    last_new: stats.messagesNew ?? 0,
    last_moved: stats.messagesMoved ?? 0,
    last_deleted: stats.messagesDeleted ?? 0,
    last_error: run?.error ?? null,
  };
}

/** A run that was written by an older version may have no usable stats. */
function parseStats(raw: string | undefined): Partial<SyncStats> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<SyncStats>;
  } catch {
    return {};
  }
}
