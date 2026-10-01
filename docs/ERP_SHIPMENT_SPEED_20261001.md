# Shipment load and save performance

The capacity test on PR #377 confirmed 225 durable saves with 2,000 shipments,
but high concurrency delayed both lists and writes. Its 50-session p95 was
9,635.2 ms for the full list and 5,494.5 ms for a sparse save. These are isolated
CI measurements, not production latency or a comparison with another ERP.

## Reduced work

- Shipment action masks read only the three relevant permissions from the
  current `admin_effective_permissions` view. They no longer load team membership,
  role descriptions or a second account record. Authorization still validates
  the active account and session version on every request.
- The permission read and canonical business capability read run in parallel.
  Every request reads current permissions; there is no permission or list cache.
- Capability masking copies the state, action map and action entries directly,
  without a stringify/parse round trip. The canonical input remains untouched.
- Stored notification errors are projected before adding canonical capabilities
  and fulfillment. This avoids recursively copying all action entries again.
- Full list reads expose aggregate `Server-Timing` phases for permissions and
  capabilities, shipments, loads, direct fulfillment and projection. The headers
  contain durations only, with no identities or database diagnostics.
- A service-only, read-only scalar snapshot collects canonical action state in
  one REST request. It delegates every business rule to the unchanged
  `shipment_action_state` owner, uses one database snapshot and refuses more
  than 50,000 rows before computing action JSON. The scalar JSON result avoids
  REST's table row cap. Only a missing-function `PGRST202` response enables the
  existing complete-page fallback during migration/schema-cache rollout;
  permissions, transport failures and malformed responses never do.

## Verification

The isolated load workflow checks out the preceding production/base revision
alongside the new code. Both actual shipment handlers run against the same real
Postgres 17.6 and PostgREST 12.2.3 fixture, runner and loopback HTTP transport.
There are 2,000 shipments, 100 canonical invoices and 50 distinct real QA logins.
The order of the before/after measurements alternates between concurrency levels.

Before timing, the complete list payloads must match, including all fulfillment
links and action permissions. At 5, 20 and 50 sessions, each version performs
three rounds of account, dashboard, financial, full list and sparse save calls.
Separate synthetic rows preserve all 450 final writes and exactly one history
and audit record per confirmed save. All external traffic is blocked and no
notifications may be queued. The anonymous artifact records p50/p95/p99,
database request counts and the comparison; timing differences are reported,
not converted into a fragile pass/fail threshold.

Focused tests also verify live permission revocation, read-only operators,
master business restrictions, immutable source capabilities and failure behavior.
The existing save guard, public-error projection and shipment action checks remain.

The additive function is `STABLE SECURITY INVOKER`, with an empty search path,
schema-qualified relations and execution revoked from PUBLIC/anon/authenticated.
Tests compare all 2,000 action states with the canonical view, enforce volume
limits and confirm that only service_role may execute it. No financial
transaction, business action eligibility, notification delivery or external
resource is changed.
