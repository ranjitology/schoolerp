#!/usr/bin/env node
/**
 * Static validation for the Tauri shell.
 *
 * The Rust toolchain is not required in the Node CI job, so this script checks
 * that the configuration, capabilities and Rust sources referenced by
 * `tauri dev` / `tauri build` are present and internally consistent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const configPath = resolve(root, 'src-tauri/tauri.conf.json');
check(existsSync(configPath), 'src-tauri/tauri.conf.json is missing');
if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  check(config.identifier === 'np.edu.schoolerp.desktop', 'unexpected bundle identifier');
  check(Boolean(config.build?.devUrl), 'build.devUrl is required for tauri dev');
  check(Boolean(config.build?.beforeDevCommand), 'build.beforeDevCommand is required');
  check(Boolean(config.build?.beforeBuildCommand), 'build.beforeBuildCommand is required');

  const dist = resolve(root, 'src-tauri', config.build?.frontendDist ?? '');
  check(
    config.build?.frontendDist === '../../web/dist',
    `frontendDist must point at the shared web build (received ${config.build?.frontendDist})`,
  );
  const expectedDist = resolve(root, '../web/dist');
  check(
    dist === expectedDist,
    `frontendDist does not resolve to apps/web/dist (received ${config.build?.frontendDist})`,
  );
  check(Array.isArray(config.bundle?.icon) && config.bundle.icon.length > 0, 'bundle.icon is empty');
  for (const icon of config.bundle?.icon ?? []) {
    check(existsSync(resolve(root, 'src-tauri', icon)), `missing bundle icon ${icon}`);
  }
  check(
    Boolean(config.app?.security?.csp),
    'app.security.csp is required for a production desktop build',
  );
}

check(existsSync(resolve(root, 'src-tauri/Cargo.toml')), 'src-tauri/Cargo.toml is missing');
check(existsSync(resolve(root, 'src-tauri/build.rs')), 'src-tauri/build.rs is missing');
check(existsSync(resolve(root, 'src-tauri/src/main.rs')), 'src-tauri/src/main.rs is missing');
check(existsSync(resolve(root, 'src-tauri/src/lib.rs')), 'src-tauri/src/lib.rs is missing');
check(
  existsSync(resolve(root, 'src-tauri/capabilities/default.json')),
  'src-tauri/capabilities/default.json is missing',
);

const cargo = existsSync(resolve(root, 'src-tauri/Cargo.toml'))
  ? readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8')
  : '';
check(cargo.includes('tauri-build'), 'Cargo.toml must depend on tauri-build');
check(cargo.includes('rusqlite'), 'Cargo.toml must depend on rusqlite for the offline store');
check(
  cargo.includes('bundled-sqlcipher'),
  'rusqlite must be built with bundled-sqlcipher for encrypted offline data',
);
check(cargo.includes('serde_json'), 'Cargo.toml must depend on serde_json for cached JSON payloads');

const libPath = resolve(root, 'src-tauri/src/lib.rs');
const rust = existsSync(libPath) ? readFileSync(libPath, 'utf8') : '';

// The offline cache is the desktop half of the `/sync/pull` contract. These
// assertions keep the Rust schema, commands and handler registration aligned
// with `apps/api/src/sync/cache.mapper.ts` without needing a Rust toolchain.
const CACHE_TABLES = [
  'cache_classes',
  'cache_sections',
  'cache_students',
  'cache_fee_heads',
  'cache_fee_structures',
  'cache_invoices',
  'attendance_drafts',
];
for (const table of CACHE_TABLES) {
  check(rust.includes(`CREATE TABLE IF NOT EXISTS ${table} (`), `lib.rs is missing ${table}`);
}
check(
  /const SCHEMA_VERSION: i64 = 2;/.test(rust),
  'lib.rs must declare the offline cache schema version 2',
);
check(
  rust.includes("VALUES ('schema_version', '2')"),
  'open_db must persist the offline cache schema version',
);

const CACHE_COMMANDS = [
  'cache_apply_pull',
  'cache_status',
  'cache_classes',
  'cache_students',
  'cache_invoices',
  'cache_fee_heads',
  'cache_fee_structures',
  'cache_clear',
  'attendance_draft_save',
  'attendance_draft_get',
  'attendance_draft_list',
  'attendance_draft_clear',
];
const handlerBlock = rust.slice(
  rust.indexOf('generate_handler!['),
  rust.indexOf('])', rust.indexOf('generate_handler![')),
);
for (const command of CACHE_COMMANDS) {
  check(
    rust.includes(`fn ${command}(`),
    `lib.rs is missing the ${command} command`,
  );
  check(
    handlerBlock.includes(command),
    `${command} is not registered in tauri::generate_handler!`,
  );
}

if (failures.length > 0) {
  console.error('Desktop configuration check failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(
  'Desktop configuration OK (Tauri 2 shell, SQLCipher outbox + offline cache v2, CSP present).',
);
console.log('Compile with: pnpm --filter @schoolerp/desktop bundle (requires Rust + platform webview).');
