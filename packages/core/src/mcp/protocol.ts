import type { AmberChestApp } from '../app.js';
import { logger } from '../util/logger.js';
import { availableTools, callTool, type McpPermissions } from './tools.js';

/**
 * Model Context Protocol, the parts a tool server needs.
 *
 * MCP is JSON-RPC 2.0 with a handful of methods. Implementing them directly
 * keeps two web frameworks out of the dependency tree - the official SDK pulls
 * in express and hono, while this project already has Fastify.
 */

/** Protocol revisions this server understands, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export interface McpServerOptions {
  app: AmberChestApp;
  /** Read fresh for every call, so a changed setting takes effect at once. */
  permissions: () => McpPermissions;
  serverName?: string;
  serverVersion?: string;
}

export class McpServer {
  private initialized = false;

  constructor(private readonly options: McpServerOptions) {}

  /**
   * Handles one message. Returns null for notifications, which by definition
   * get no answer.
   */
  async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;

    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return this.error(id, ERROR_CODES.invalidRequest, 'Invalid request');
    }

    // Notifications have no id and expect no response.
    const isNotification = message.id === undefined || message.id === null;

    try {
      switch (message.method) {
        case 'initialize':
          return this.ok(id, this.initialize(message.params ?? {}));

        case 'notifications/initialized':
          this.initialized = true;
          return null;

        case 'ping':
          return this.ok(id, {});

        case 'tools/list':
          return this.ok(id, {
            tools: availableTools(this.options.permissions()).map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          });

        case 'tools/call':
          return this.ok(id, await this.callTool(message.params ?? {}));

        // Declared as unsupported rather than silently missing.
        case 'resources/list':
          return this.ok(id, { resources: [] });
        case 'prompts/list':
          return this.ok(id, { prompts: [] });

        default:
          if (isNotification) return null;
          return this.error(id, ERROR_CODES.methodNotFound, `Unknown method: ${message.method}`);
      }
    } catch (error) {
      const text = (error as Error).message;
      logger.warn(`MCP error in ${message.method}: ${text}`);
      if (isNotification) return null;
      return this.error(id, ERROR_CODES.internal, text);
    }
  }

  private initialize(params: Record<string, unknown>): unknown {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined;
    const version =
      requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];

    return {
      protocolVersion: version,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: this.options.serverName ?? 'amberchest',
        version: this.options.serverVersion ?? '0.1.0',
      },
      instructions:
        'Archived IMAP mail. Use search_messages to find messages, then get_message with the ' +
        'returned message_id to read one. Attachment text is searchable and can be fetched with ' +
        'get_attachment_text. Which tools are available depends on the switches in the Mail ' +
        'Archiver settings.',
    };
  }

  private async callTool(params: Record<string, unknown>): Promise<unknown> {
    const name = typeof params.name === 'string' ? params.name : '';
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};

    if (!name) throw new Error('Missing tool name');

    try {
      const result = await callTool(this.options.app, this.options.permissions(), name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      // Tool failures are reported inside the result, not as protocol errors,
      // so the model can read what went wrong and try something else.
      return {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true,
      };
    }
  }

  private ok(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}

/** Parses one incoming line and hands it to the server. */
export async function handleRawMessage(server: McpServer, raw: string): Promise<string | null> {
  let parsed: JsonRpcRequest;
  try {
    parsed = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: ERROR_CODES.parse, message: 'Parse error' },
    });
  }

  const response = await server.handle(parsed);
  return response ? JSON.stringify(response) : null;
}
