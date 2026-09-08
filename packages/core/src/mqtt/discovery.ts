import type { AccountOverview } from '../app.js';
import type { Topics } from './topics.js';

/**
 * Builds the Home Assistant MQTT discovery messages.
 *
 * Home Assistant creates the entities itself once these retained messages sit
 * on `<prefix>/<component>/<object_id>/config`, so nothing has to be written
 * into its configuration by hand. The unique ids contain the base topic, which
 * keeps two Mail Archiver instances on one broker apart.
 */
export interface DiscoveryMessage {
  topic: string;
  payload: Record<string, unknown> | null;
}

interface DiscoveryOptions {
  prefix: string;
  baseTopic: string;
  topics: Topics;
  version: string;
  /** Buttons are only published when the user allows commands. */
  allowCommands: boolean;
}

function idPrefix(baseTopic: string): string {
  return baseTopic.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mailarchiver';
}

function hubDevice(options: DiscoveryOptions): Record<string, unknown> {
  return {
    identifiers: [`${idPrefix(options.baseTopic)}_hub`],
    name: 'Mail Archiver',
    manufacturer: 'Mail Archiver',
    model: 'Mail backup',
    sw_version: options.version,
  };
}

function availability(topics: Topics): Record<string, unknown> {
  return {
    availability_topic: topics.status,
    payload_available: 'online',
    payload_not_available: 'offline',
  };
}

/** The two instance wide sensors. */
export function hubDiscovery(options: DiscoveryOptions): DiscoveryMessage[] {
  const id = idPrefix(options.baseTopic);
  const device = hubDevice(options);
  const common = { ...availability(options.topics), state_topic: options.topics.state, device };

  return [
    {
      topic: `${options.prefix}/sensor/${id}_total_size/config`,
      payload: {
        ...common,
        name: 'Archive size',
        unique_id: `${id}_total_size`,
        object_id: 'mail_archiver_archive_size',
        value_template: '{{ value_json.bytes }}',
        device_class: 'data_size',
        state_class: 'measurement',
        unit_of_measurement: 'B',
        suggested_display_precision: 0,
        icon: 'mdi:database',
      },
    },
    {
      topic: `${options.prefix}/sensor/${id}_next_run/config`,
      payload: {
        ...common,
        name: 'Next scheduled backup',
        unique_id: `${id}_next_run`,
        object_id: 'mail_archiver_next_scheduled_backup',
        value_template: '{{ value_json.next_run }}',
        device_class: 'timestamp',
        icon: 'mdi:calendar-clock',
      },
    },
  ];
}

/** Everything that belongs to one mailbox. */
export function accountDiscovery(
  overview: AccountOverview,
  slug: string,
  options: DiscoveryOptions,
): DiscoveryMessage[] {
  const id = `${idPrefix(options.baseTopic)}_${overview.account.id.replace(/-/g, '')}`;
  const stateTopic = options.topics.accountState(slug);
  const device = {
    identifiers: [id],
    name: overview.account.name,
    manufacturer: 'Mail Archiver',
    model: 'IMAP account',
    sw_version: options.version,
    via_device: `${idPrefix(options.baseTopic)}_hub`,
  };
  const common = { ...availability(options.topics), state_topic: stateTopic, device };

  const messages: DiscoveryMessage[] = [
    {
      topic: `${options.prefix}/sensor/${id}_messages/config`,
      payload: {
        ...common,
        name: 'Messages',
        unique_id: `${id}_messages`,
        object_id: `${slug}_messages`,
        value_template: '{{ value_json.messages }}',
        state_class: 'measurement',
        unit_of_measurement: 'messages',
        icon: 'mdi:email-multiple',
      },
    },
    {
      topic: `${options.prefix}/sensor/${id}_size/config`,
      payload: {
        ...common,
        name: 'Archive size',
        unique_id: `${id}_size`,
        object_id: `${slug}_archive_size`,
        value_template: '{{ value_json.bytes }}',
        device_class: 'data_size',
        state_class: 'measurement',
        unit_of_measurement: 'B',
        suggested_display_precision: 0,
        icon: 'mdi:database',
      },
    },
    {
      topic: `${options.prefix}/sensor/${id}_last_backup/config`,
      payload: {
        ...common,
        name: 'Last backup',
        unique_id: `${id}_last_backup`,
        object_id: `${slug}_last_backup`,
        // An account that was never backed up publishes null, which Home
        // Assistant shows as "unknown" instead of a broken timestamp.
        value_template: '{{ value_json.last_backup }}',
        device_class: 'timestamp',
        icon: 'mdi:backup-restore',
      },
    },
    {
      topic: `${options.prefix}/binary_sensor/${id}_syncing/config`,
      payload: {
        ...common,
        name: 'Backup running',
        unique_id: `${id}_syncing`,
        object_id: `${slug}_backup_running`,
        value_template: '{{ "ON" if value_json.syncing else "OFF" }}',
        device_class: 'running',
      },
    },
  ];

  if (options.allowCommands) {
    messages.push({
      topic: `${options.prefix}/button/${id}_backup/config`,
      payload: {
        ...availability(options.topics),
        device,
        name: 'Back up now',
        unique_id: `${id}_backup`,
        object_id: `${slug}_back_up_now`,
        command_topic: options.topics.accountCommand(slug),
        payload_press: 'backup',
        icon: 'mdi:cloud-download',
      },
    });
  }

  return messages;
}

/** Same topics with an empty payload, which makes Home Assistant forget them. */
export function removalMessages(messages: DiscoveryMessage[]): DiscoveryMessage[] {
  return messages.map((message) => ({ topic: message.topic, payload: null }));
}
