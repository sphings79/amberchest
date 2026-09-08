import type { ArchiveDatabase } from '../db/database.js';
import type { Account, FolderTreeNode, RemoteFolder } from '../types.js';

/**
 * Special use folders that are pre-selected the very first time an account is
 * set up. Trash, Junk and Drafts are offered but left unchecked; everything
 * else the server does not label is treated as normal mail and checked.
 */
const DEFAULT_OFF: ReadonlySet<string> = new Set(['\\Trash', '\\Junk', '\\Drafts']);

export function suggestSelection(folders: RemoteFolder[]): string[] {
  return folders
    .filter((folder) => !folder.noSelect)
    .filter((folder) => !folder.specialUse || !DEFAULT_OFF.has(folder.specialUse))
    .map((folder) => folder.path);
}

export interface FolderTreeOptions {
  account: Account;
  db: ArchiveDatabase;
  remoteFolders: RemoteFolder[];
}

/**
 * Merges the server listing with what the archive already knows.
 *
 * A folder counts as new only when the account has been synced before -
 * otherwise the whole tree would light up on first use.
 */
export function buildFolderTree({ account, db, remoteFolders }: FolderTreeOptions): FolderTreeNode[] {
  const knownFolders = db.listFolders(account.id);
  const knownByPath = new Map(knownFolders.map((row) => [row.path, row]));
  const firstRun = knownFolders.length === 0;

  const selection = account.selectedFolders.length > 0
    ? new Set(account.selectedFolders)
    : new Set(suggestSelection(remoteFolders));

  const nodes = new Map<string, FolderTreeNode>();
  const sorted = [...remoteFolders].sort((a, b) => a.path.localeCompare(b.path));

  for (const folder of sorted) {
    const known = knownByPath.get(folder.path);
    nodes.set(folder.path, {
      ...folder,
      known: known !== undefined,
      isNew: !firstRun && known === undefined,
      selected: selection.has(folder.path) && !folder.noSelect,
      localMessageCount: known ? db.countMessages(known.id) : 0,
      children: [],
    });
  }

  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    const delimiter = node.delimiter;
    const cut = delimiter ? node.path.lastIndexOf(delimiter) : -1;
    const parentPath = cut > 0 ? node.path.slice(0, cut) : '';
    const parent = parentPath ? nodes.get(parentPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/** Flattens a tree back into the list of selected server paths. */
export function collectSelected(nodes: FolderTreeNode[]): string[] {
  const result: string[] = [];
  const walk = (list: FolderTreeNode[]): void => {
    for (const node of list) {
      if (node.selected) result.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}
