# LoRa Manta code and database review

Originally reviewed on **2026-10-03**, at repository commit `9508496`, including the working tree. The review itself did not change application code or the production database; it added this report and `AGENTS.md`. Pre-existing uncommitted files were preserved.

## Implementation follow-up — 2026-10-03

The recommended create-permission filter is now implemented and applied to Cloud
instance **nano-things**, database **lora/manta**, on SurrealDB **3.2.4**. Prefix
**`18`** is stored in the protected `packet_ingest_policy:dev_addr` record.
`discard_unmatched_reception` is removed, and `reception_to_uplink` retains its
correlation body with the original CREATE/payload-hash guard. Live verification
confirmed unchanged reception fields/indexes and other existing table definitions.

Bootstrap and packet-table recovery use the same permission rule. Recovery
preserves a changed or disabled policy and retires legacy discard logic, resolving
finding 1 below. The policy uses a literal record lookup rather than a global
parameter, because caller variables can shadow parameters. A missing policy
fails closed. Collector and frontend code are unchanged.

All seven SurrealQL scripts passed 3.2.4 syntax validation, and all **10** new
local integration tests passed, including mixed batches, rollback, active/disabled
recovery, missing-policy rejection, and gateway ownership/policy protection.
No synthetic packets were inserted into Cloud.

See [the migration](surreal/implement_dev_addr_filter.surql),
[disable script](surreal/remove_dev_addr_filter.surql),
[legacy rollback](surreal/rollback_dev_addr_filter.surql), and
[integration tests](surreal/tests/dev_addr_filter.py). The original findings and
proposal below are retained as the **pre-implementation review snapshot**; use
the current scripts for the implemented behavior. Other findings remain open.

## Scope and evidence

Reviewed authentication/session handling, analyzer queries and pagination, saved filters, PER calculation, packet details and exports, collector normalization/persistence, SurrealQL schema/recovery/filter scripts, and deployment configuration.

Production schema was inspected through the **SurrealDB MCP server**, using Cloud discovery and read-only `INFO` statements. Target: organization **Individual**, instance **nano-things** (`06gc60vbv9uo70e0i8g2q65fsk`), namespace/database **lora/manta**, engine **3.2.4**. Access-definition signing keys are omitted from this report. No live credentials were used in local tests.

Runtime reproductions used an isolated localhost, in-memory **SurrealDB 3.2.4** server, synthetic gateway/user credentials, and synthetic packets. Recommendations below are proposals, not applied migrations. P1 denotes high priority; P2 denotes medium priority.

## Findings, ordered by priority

### 1. P1 — recovery can create uplinks pointing to discarded receptions

**Locations:** `surreal/restore_packet_tables.surql:135`, `surreal/implement_dev_addr_filter.surql:10`, `surreal/implement_dev_addr_filter.surql:20`.

The live filter has two complementary events. Recovery overwrites `reception_to_uplink` with a CREATE/payload-hash guard that accepts every prefix, while leaving an existing `discard_unmatched_reception` event intact. Nonmatching packets can therefore create a logical uplink and be deleted from the reception table. The stored reception count and best-reception link then refer to a nonexistent reception.

**Reproduced:** apply the bootstrap, install the current filter, run the recovery script, and insert a synthetic `26000004` reception. Its reception was absent afterward, but its uplink remained with `reception_count: 1`. This is a recovery-path defect; this inspection did not establish that the current live database already contains such orphaned uplinks.

**Recommendation:** recovery must explicitly restore one coherent ingestion policy, including both event guards or the proposed create-permission filter below. Add an integration check for recovery while filtering is enabled. Moving the filter to permissions also requires updating recovery, because it currently restores the original permissive create rule.

### 2. P1 — the PER query silently truncates the received-packet set

**Locations:** `src/api/surrealUplinks.ts:33`, `src/api/surrealUplinks.ts:213`, `src/api/surrealUplinks.ts:239`; `src/api/packetErrorRate.ts:10`.

PER selects the latest **1,000 rows** and then compares their distinct counters with the entire requested counter span. With 3,000 received counters and explicit bounds 1–3,000, retaining only counters 2,001–3,000 produces **66.67% loss**, although all packets arrived. The limit is rows before deduplication, so retransmissions can reduce the number of distinct counters further. Without explicit bounds, the result describes a truncated sample rather than the selected dataset. The mock source calculates over all matching rows, so it can hide the discrepancy.

**Reproduced:** the actual calculation helper reported 1,000 received, 2,000 missing, and 66.67% for that truncated input. Existing tests explicitly preserve the query limit but do not establish correctness for larger complete datasets.

**Recommendation:** calculate the distinct received count and range over the complete selected device/session dataset in SurrealDB, or paginate the full dataset. If a sampling limit is retained, return an explicit incomplete result with its actual analyzed range, and do not count unqueried packets as missing.

### 3. P2 — a malformed shared filter breaks everyone's saved-filter list

**Locations:** `surreal/schema.surql:449`, `surreal/schema.surql:467`; `src/api/savedFilters.ts:84`, `src/api/savedFilters.ts:265`.

Approved users can create their own shared filters directly through the browser's database connection. The schema checks `definition.type` and `definition.version` but leaves the rest flexible. A record such as `definition: { type: "sniffer", version: 1, filters: 42 }` is accepted. `list()` then parses every visible record with `rows.map(parseSavedFilterRow)`; one invalid shared record throws and prevents the whole list from loading for every approved user. This can happen through a modified client or an older incompatible client even though the current create form validates inputs.

**Reproduced:** the local engine accepted the malformed shared record under a Google record-user JWT. Feeding its row through the actual data-source list parser threw `The Sniffer filter definition is invalid.`

**Recommendation:** enforce supported definition shapes, enum values, and bounded sizes in schema validation, and parse list rows independently so invalid records cannot suppress valid ones. Report/skips should be visible to the owner or administrator.

### 4. P2 — opening registration also reapproves existing accounts

**Location:** `surreal/schema.surql:494`; the live `google` access method has the same branch.

The open-registration branch runs on every authentication and unconditionally merges `approved: true` into the user record. An existing account with `approved: false` gains approval on its next authentication while registration is open. This is broader than the README's explanation that opening registration approves new registrations. Cookie restoration authenticates the JWT again, so the behavior is not confined to first-time Google sign-in.

**Reproduced:** create a synthetic Google user, set `approved: false`, enable `auth_config:registration.open_registration`, then authenticate again: the user becomes approved.

**Recommendation:** apply automatic approval only when creating a new account. Preserve existing approval decisions on subsequent logins, and use a separate disabled/suspended state if suspension must remain effective regardless of enrollment policy. Test both new enrollment and existing unapproved users. This review did not test revocation behavior on already-open WebSocket sessions.

### 5. P2 — counter rollover/reset makes PER misleading

**Locations:** `src/api/packetErrorRate.ts:7`, `src/api/surrealUplinks.ts:219`, `src/api/surrealUplinks.ts:738`; `lora-manta-collector/src/main.rs:502`.

The helper sorts and deduplicates 16-bit counters without retaining chronological or session information. For successive received counters `65534, 65535, 0, 1`, it reports **99.9939% loss** over a span of 65,536 instead of a four-packet sequence. Session resets or DevAddr reuse can also collapse different transmissions with the same counter. Input validation permits 32-bit FCnt bounds even though the query reads `fcnt16`.

**Reproduced:** the actual helper returned 65,532 missing packets for that four-counter input.

**Recommendation:** reconstruct counters within a known device session, or require a single unambiguous 16-bit epoch and return unavailable/ambiguous when the selection crosses rollover or reset. Keep the UI's counter width and bounds consistent with the stored data. A DevAddr alone is not a stable session identity.

### 6. P2 — packet details present ciphertext as decoded telemetry

**Locations:** `src/components/PacketDetails/PacketDetails.tsx:80`, `src/components/PacketDetails/PacketDetails.tsx:154`; `src/lorawan/devicePayload.ts:10`; `lora-manta-collector/README.md:250`.

Any valid hexadecimal FRMPayload of at least five bytes is interpreted as version, battery, status, and RSSI. There is no device/protocol/port selection or decryption step. The collector explicitly documents that it stores encrypted FRMPayload and does not decrypt it. Standard LoRaWAN ciphertext or unrelated device payloads therefore produce plausible-looking but meaningless telemetry.

**Recommendation:** show raw encrypted bytes by default. Enable the device decoder only after explicit identification of the expected plaintext protocol and, for standard LoRaWAN traffic, authenticated decryption. If this project also handles a vendor protocol that intentionally exposes these bytes, make that an explicit decoder mode rather than applying it to every data uplink.

### 7. P2 — collector writes have no application-level bound or durable recovery

**Locations:** `lora-manta-collector/src/main.rs:893`, `lora-manta-collector/src/main.rs:1016`, `lora-manta-collector/src/main.rs:1095`, `lora-manta-collector/src/main.rs:1104`.

Every valid PUSH_DATA is acknowledged and spawns a task that retains the parsed payload while writing to SurrealDB. There is no bounded task queue, semaphore, configured request deadline, or durable spool. A prolonged database/network slowdown can accumulate tasks and memory. A failed write is logged and discarded after the upstream ACK; only an HTTP authentication rejection gets a retry. Random UUID reception IDs also mean simply adding retries after an ambiguous commit can create duplicates.

**Evidence:** source inspection; no overload or outage was induced. UDP collection may intentionally be best effort, but its resource usage still needs a bound.

**Recommendation:** bounded concurrency/queueing, request deadlines, explicit drop metrics, and stable reception identities for safe retry; add a local spool if loss during outages is unacceptable. This is a separate collector reliability improvement, not a prerequisite for the database-only filtering recommendation.

## Live event inventory

All eight live tables were inspected. Exactly two events were returned, both on `gateway_reception`; neither is ASYNC.

| Table | Event | Current condition and effect |
| --- | --- | --- |
| `gateway_reception` | `discard_unmatched_reception` | On CREATE, uppercase `lorawan.dev_addr` (missing becomes `""`) must start with `18`; otherwise delete `$after.id`. |
| `gateway_reception` | `reception_to_uplink` | On CREATE with a payload hash and DevAddr starting with `18`, find an identical PHY hash within ±200 ms of a stable gateway-time anchor; upsert the logical uplink, maintain reception/gateway arrays and strongest-RSSI metadata, and set the reception's `uplink` link. Without gateway UTC, use a separate logical uplink. |
| `lorawan_uplink`, `gateway_credential`, `gateway_stat`, `user`, `invitation`, `saved_filter`, `auth_config` | None | No events returned. |

The two live filter guards are complementary and agree on **`18`**. The filter script's comments mention **`26011A`**, but that is not the applied rule. Schema/recovery event bodies correlate all hashed receptions unless the filter script is additionally applied. The live tables have the expected reception-link and payload/anchor indexes.

The current filter drops Join Requests, unsupported/identifier-less messages, and malformed frames lacking DevAddr. Join Requests have DevEUI and JoinEUI instead. If this is deliberate data-uplink-only collection, that behavior is consistent; otherwise define a separate join whitelist.

The CREATE-only guards prevent recursion when correlation updates a reception or the discard event deletes it. Synchronous events participate in the initiating transaction, and event queries bypass record permissions; the correlation writes can therefore maintain a packet table that gateway record users cannot update directly. See [DEFINE EVENT](https://surrealdb.com/docs/reference/query-language/statements/define/event).

The correlation SELECT-then-UPSERT is also worth testing under simultaneous writes from multiple gateways: two transactions can observe no match, or contend while updating a shared uplink. No concurrency stress test was performed, so splitting/lost reception updates are an open risk rather than a reproduced finding. Keep a stable anchor and idempotent membership updates when addressing it.

## Better incoming-message filtering without collector changes

**Recommendation: add the DevAddr predicate to `gateway_reception`'s `FOR create WHERE` permission.** Keep correlation in its existing event, and retire the delete event after verifying the migration. The existing collector already signs in through `gateway_writer` record access, so its SQL and gateway deployments can stay as they are.

This rejects unwanted records at the creation permission gate and avoids their subsequent discard event and deletion. It still incurs request parsing, schema processing, and permission evaluation; it does not remove upstream bandwidth or all ingestion costs. It controls future creates and does not prune historical data.

### Proposed migration — reviewed, not applied

This preserves the **current prefix `18`**, browser read permissions, enabled-gateway check, and gateway ownership check. The complete snippet passed `surreal validate` on 3.2.4 and was exercised under a record-user credential in the isolated mixed-batch runtime test.

```surql
USE NS lora DB manta;

BEGIN TRANSACTION;

ALTER TABLE gateway_reception
    PERMISSIONS
        FOR select WHERE $auth.approved = true
        FOR create WHERE
            $auth.enabled = true
            AND gateway_id = <string>record::id($auth.id)
            AND string::starts_with(
                string::uppercase(lorawan.dev_addr ?? ""),
                "18"
            )
        FOR update, delete NONE;

ALTER EVENT reception_to_uplink ON TABLE gateway_reception
    WHEN $event = "CREATE" AND $after.phy.payload_hash IS NOT NONE;

REMOVE EVENT IF EXISTS discard_unmatched_reception
    ON TABLE gateway_reception;

COMMIT TRANSACTION;
```

Also update the bootstrap/recovery policy and provide a rollback before operational adoption. A rollback should atomically restore the original create permission and both complementary filter events. Keep the former correlation-prefix guard temporarily during initial verification if desired; the proposal removes it once create permissions become the policy boundary.

### Why this works with the current batches

| Isolated 3.2.4 test | Outcome |
| --- | --- |
| Current paired events; batch with `18000001`, `26000001`, and a Join Request | Transaction succeeded; only the matching reception and its uplink remained. |
| Create permission with prefix `18`; equivalent mixed batch | Every statement returned OK; the matching reception/uplink committed, the nonmatching reception and Join Request were skipped. |
| Prefix enforced as a field ASSERT; mixed batch | Transaction failed; the accepted reception earlier in the same batch was also rolled back. |

The permission approach is a successful no-op for filtered messages in this tested CREATE path. That matches the collector's `RETURN NONE` and success-status handling. Do not substitute a throwing event or field assertion for routine filtering: the collector wraps the whole PUSH_DATA batch in one transaction.

Table permissions apply to record users, not root/namespace/database system users. Privileged imports, administrative writes, or another writing event can bypass this filter; preserve appropriate guards on any such ingestion path. A Cloud PAT/system-user test would therefore not establish gateway behavior. See [table permissions](https://surrealdb.com/docs/reference/query-language/statements/define/table#defining-permissions).

For frequently changing rules, replace the literal with one database-owned prefix parameter or a validated policy record/read-only function. Keep one shared predicate, fail closed on missing policy, and allow only administrators to change it. This can support separate DevAddr rules for data uplinks and DevEUI/JoinEUI rules for Join Requests without installing a server or changing the collector. The dynamic-policy variant was not implemented or runtime-tested here.

### Alternatives and limits

- **Keep the paired events:** works today for valid input and preserves successful batch responses, but performs extra event/delete work and needs both conditions maintained together. If privileged writers must be filtered too, retaining a synchronous discard guard may be appropriate.
- **Field ASSERT or event THROW:** useful for malformed data/invariants, unsuitable as a routine drop filter for the current atomic batch. [Field assertions](https://surrealdb.com/docs/reference/query-language/statements/define/field#asserting-rules-on-fields) reject violating writes.
- **A filtered view or SELECT permission:** limits what the analyzer sees but retains unwanted source records; it does not solve ingestion/storage filtering.
- **A database function or DEFINE API ingestion endpoint:** can explicitly return accepted/skipped results, but the collector must call it, so it does not meet the unchanged-collector constraint.
- **ASYNC discard:** permits unwanted records to commit until processing happens and weakens immediate filtering; it is not an improvement for this requirement.

A prefix is a collection policy, not proof of LoRaWAN network membership: DevAddr is visible on air, and this collector does not validate MICs. Restrict the prefix or maintain exact address/session allowlists if needed. No database-side policy can prevent an unchanged collector from transmitting unwanted messages to the database; saving that gateway-to-Cloud bandwidth requires filtering before transmission.

## Validation and remaining coverage

| Check | Result |
| --- | --- |
| `npm test` | Pass: 9 JavaScript test files reported successful. |
| `npm run build` | Pass, including TypeScript build; Vite reported an 884.65 kB minified JS chunk (260.57 kB gzip). |
| `npm run worker:check` | Pass: Wrangler dry run only; no deployment. |
| `cargo test --locked --offline --manifest-path lora-manta-collector/Cargo.toml` | Pass: 33 tests. |
| `surreal validate surreal/*.surql` on 3.2.4 | All six scripts passed syntax validation. |
| Proposed permission migration syntax | Passed validation on 3.2.4. |
| Isolated database/runtime probes | Confirmed mixed-batch permission filtering, ASSERT rollback, recovery orphan creation, reapproval, and malformed shared-filter acceptance. |
| Actual JS helpers | Confirmed PER truncation/rollover outcomes and malformed saved-filter list failure. |

No browser end-to-end sign-in/session test, production write test, throughput benchmark, or concurrent correlation test was performed. The installed frontend dependencies and collector lockfile were used; this was not a clean-install dependency compatibility audit.

The application already uses parameter binding for filter values and opaque keyset cursors, hashes invitation tokens, verifies Google JWTs in the Worker, and keeps browser packet writes denied at the database. Those controls should remain intact when fixing the findings. The bounded free-text search is labeled as searching the newest 1,000 candidates and disclosed in CSV export; its intentional limit is distinct from the silent PER truncation.
