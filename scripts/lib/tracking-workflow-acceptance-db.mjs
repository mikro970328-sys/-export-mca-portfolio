import fs from 'node:fs';
import assert from 'node:assert/strict';

// Apply after the operator acceptance foundation; all business RPCs stay intact.
export async function applyTrackingWorkflowAcceptanceSchema(db, {manualAssignment = true} = {}) {
  // The original legacy notification table, followed by unchanged migrations.
  const schema=fs.readFileSync('supabase/schema.sql','utf8');
  const notificationTable=schema.match(/create table if not exists public\.notifications \([\s\S]*?\n\);/g);
  assert.equal(notificationTable?.length,1);
  await db.exec(notificationTable[0]);
  const webhookTable=schema.match(/create table if not exists public\.webhook_events \([\s\S]*?\n\);/g);
  assert.equal(webhookTable?.length,1);
  await db.exec(webhookTable[0]);
  // Legacy fields outside the financial fixture; no business-function doubles.
  await db.exec('alter table webhook_events add column provider text;');
  for(const name of [
    '20260728_finish_clients_notifications.sql',
    '20260730_operational_notifications_phase1.sql',
    '20260830154000_p4_task_engine.sql',
    '20260830160500_p4_task_engine_index_hardening.sql',
    '20260830161000_p4_task_dependency_completion_guard.sql',
    '20260830170000_p5_workflow_routing_foundation.sql',
    '20260830172000_p5_workflow_handoff_rules.sql',
    '20260830174500_p5_workflow_dependency_integrity.sql',
    '20260830203500_p8_operational_task_attention.sql',
    '20260830211500_p9_operational_alert_condition_registry.sql',
    '20260830211600_p9_alert_cycle_seed_normalization.sql',
    '20260830211700_p9_alert_reconcile_column_qualification.sql',
    '20260830211800_p9_alert_action_column_qualification.sql',
    '20260830215500_p10_user_notification_inbox.sql',
    '20260830220500_p10_notification_source_version_integrity.sql',
    '20260903233021_b10_1_web_push_notifications.sql',
    '20260904020411_container_tracking_assignment_notifications.sql',
    '20260904091137_inactive_notifications_not_unread.sql',
    ...(manualAssignment ? ['20260916033448_workflow_manual_assignment.sql'] : [])
  ]) {
    try {await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));}
    catch(e){throw Error(`${name}: ${e.message}`);}
  }
  // Register change triggers for the operational tables added by this slice.
  for(const name of ['20260909125237_multiuser_live_sync.sql','20260909143701_live_sync_recovery.sql']) await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
}
