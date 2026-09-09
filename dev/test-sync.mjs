/**
 * End to end check against the local Dovecot container.
 *
 * Creates a throw away configuration, archives the seeded test mailbox and
 * prints the resulting tree. Run `node dev/seed-testserver.mjs` first.
 *
 * Usage: node dev/test-sync.mjs [workdir]
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'amberchest-'));
process.env.AMBERCHEST_CONFIG_DIR = join(workdir, 'config');
process.env.AMBERCHEST_ARCHIVE_DIR = join(workdir, 'archive');

const { AmberChestApp, logger } = await import('@amberchest/core');

logger.setLevel('debug');
logger.on('entry', (entry) => console.log(`  [${entry.level}] ${entry.message}`));

const app = new AmberChestApp();
if (!app.isInitialized) await app.initialize('test-password-123');
await app.unlock('test-password-123');
await app.updateSettings({ archivePath: join(workdir, 'archive') });

let accounts = app.listAccounts();
let account = accounts[0];
if (!account) {
  account = await app.addAccount({
    name: 'Dovecot Test',
    email: 'test@example.com',
    host: '127.0.0.1',
    port: 11143,
    security: 'none',
    rejectUnauthorized: false,
    username: 'test@example.com',
    password: 'testpass',
    archivePath: null,
  });
}

console.log('\n--- connection test ---');
console.log(
  await app.testConnection({
    host: '127.0.0.1',
    port: 11143,
    security: 'none',
    rejectUnauthorized: false,
    username: 'test@example.com',
    password: 'testpass',
  }),
);

console.log('\n--- folder tree ---');
const tree = await app.getFolderTree(account.id, true);
const printTree = (nodes, depth = 0) => {
  for (const node of nodes) {
    const marks = [
      node.selected ? 'x' : ' ',
      node.isNew ? 'NEW' : '',
      node.specialUse ?? '',
      node.messageCount === null ? '' : `${node.messageCount} msgs`,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`${'  '.repeat(depth)}[${marks}] ${node.path}`);
    printTree(node.children, depth + 1);
  }
};
printTree(tree);

const collect = (nodes, out = []) => {
  for (const node of nodes) {
    if (node.selected) out.push(node.path);
    collect(node.children, out);
  }
  return out;
};
const selected = collect(tree);
await app.setSelectedFolders(account.id, selected);
console.log('\nselected:', selected.join(', '));

console.log('\n--- sync ---');
app.sync.on('progress', (progress) => {
  if (progress.phase === 'done' || progress.phase === 'failed') {
    console.log('final:', progress.phase, JSON.stringify(progress.stats));
  }
});
await app.startSync(account.id);

console.log('\n--- archive on disk ---');
console.log(execSync(`find "${join(workdir, 'archive')}" -type f | sort`, { encoding: 'utf8' }));
console.log('workdir:', workdir);
app.close();
