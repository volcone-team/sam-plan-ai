/**
 * Full-data backup to JSON, using the `pg` driver — no pg_dump, no CLI.
 *
 * Dumps every table in the `public` schema plus `auth.users` to timestamped JSON
 * files under ./db-backup-<timestamp>/. This is a DATA backup, not a schema one:
 * it is the undo button for the wipe, which only touches data and leaves schema,
 * triggers and functions in place. Restoring is therefore a matter of re-inserting
 * rows, not rebuilding structure.
 *
 * Run:
 *   node scripts/backup-db.mjs "postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
 *
 * Get the connection string from Supabase > Project Settings > Database. Use the
 * DIRECT connection (port 5432), not the pooler, so every table is reachable.
 *
 * The connection string is passed as an argument rather than read from a file so
 * the password is never written to disk by this script.
 */

import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";

const connectionString = process.argv[2];
if (!connectionString) {
  console.error('Usage: node scripts/backup-db.mjs "postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"');
  process.exit(1);
}

const { Client } = pg;

// Supabase requires SSL; rejectUnauthorized:false avoids a local CA bundle issue
// and is safe for a one-off backup over the direct connection.
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main() {
  await client.connect();
  console.log("Connected.\n");

  const dir = `db-backup-${stamp()}`;
  mkdirSync(dir, { recursive: true });

  // Every base table in public, plus auth.users (the wipe deletes it, and the
  // dashboard CSV export cannot reach the auth schema).
  const { rows: tableRows } = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND (table_schema = 'public' OR (table_schema = 'auth' AND table_name = 'users'))
    ORDER BY table_schema, table_name
  `);

  const manifest = [];
  let totalRows = 0;

  for (const { table_schema, table_name } of tableRows) {
    const qualified = `${table_schema}.${table_name}`;
    try {
      const { rows } = await client.query(`SELECT * FROM ${table_schema}."${table_name}"`);
      const file = `${table_schema}.${table_name}.json`;
      writeFileSync(`${dir}/${file}`, JSON.stringify(rows, null, 2));
      manifest.push({ table: qualified, rows: rows.length, file });
      totalRows += rows.length;
      console.log(`  ${qualified.padEnd(40)} ${rows.length} rows`);
    } catch (err) {
      console.error(`  ${qualified.padEnd(40)} FAILED: ${err.message}`);
      manifest.push({ table: qualified, error: err.message });
    }
  }

  writeFileSync(
    `${dir}/_manifest.json`,
    JSON.stringify({ takenAt: new Date().toISOString(), totalRows, tables: manifest }, null, 2)
  );

  console.log(`\nBacked up ${manifest.length} tables, ${totalRows} rows total → ${dir}/`);
  await client.end();
}

main().catch(async (err) => {
  console.error("\nBackup failed:", err.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
