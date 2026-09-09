import fs from 'node:fs';
import pg from 'pg';
import { applyFinanceAcceptanceSchema } from './finance-acceptance-db.mjs';

export const operatorAcceptanceMigrations = [
  '20260830090500_p3_access_control_foundation.sql',
  '20260830092000_p3_access_control_setters.sql',
  '20260831005000_p17_session_audit_foundation.sql',
  '20260831005200_p17_access_control_atomic_audit.sql',
  '20260909125237_multiuser_live_sync.sql',
  '20260909143701_live_sync_recovery.sql'
];

export async function applyOperatorAcceptanceSchema(connection) {
  await applyFinanceAcceptanceSchema(connection);
  await connection.exec(fs.readFileSync('supabase/tests/fixtures/operator_acceptance_legacy.sql','utf8'));
  for (const file of operatorAcceptanceMigrations) {
    try { await connection.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8')); }
    catch (error) { throw Error(`Operator migration ${file}: ${error.message}`); }
  }
}

export async function createOperatorAcceptanceDb() {
  const connectionString = process.env.ERP_TEST_DATABASE_URL;
  if (!connectionString) throw Error('ERP_TEST_DATABASE_URL must point to an empty local QA PostgreSQL database');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !/^\/erp_operator_qa(?:_[a-z0-9]+)?$/.test(url.pathname)
      || url.search) throw Error('Refusing a non-local or non-QA database');
  const pool = new pg.Pool({ connectionString, max:8, options:'-c timezone=UTC -c statement_timeout=15000 -c lock_timeout=10000' });
  pool.exec = sql => pool.query(sql);
  try {
    const { rows:[state] } = await pool.query(`select current_database() as name,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') as objects`);
    if (`/${state.name}` !== url.pathname || state.objects !== 0) throw Error('Refusing to initialize a database that is not empty');
    const connection = await pool.connect();
    connection.exec = sql => connection.query(sql);
    try {
      await applyOperatorAcceptanceSchema(connection);
    } finally { connection.release(); }
    return pool;
  } catch (error) { await pool.end(); throw error; }
}
