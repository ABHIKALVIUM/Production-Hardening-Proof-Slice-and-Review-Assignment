# Starter — Circuit Breaker Proof Slice (PromptPilot)

This is the starter repository for **Option B (provided scenario)** of the assignment.

Repository: `https://github.com/kalviumcommunity/Production-Hardening-Proof-Slice-and-Review-Assignment` (public, owned by
`kalviumcommunity`). Fork it, implement the breaker, and open a pull request back to your fork.

> The control here is a **circuit breaker**, covered earlier in this module. You are applying a
> concept you have already learned, not a new one.

## Scenario

PromptPilot drafts support replies by calling an external model provider. When the provider is slow
or failing, every request still tries it, so doomed calls pile up and the failure spreads. You will
add a **circuit breaker** so sustained failures short-circuit fast to a safe fallback, then recover
through a probe.

## Your task

Implement the circuit breaker in [`src/circuitBreaker.js`](./src/circuitBreaker.js). The file has a
skeleton and a `TODO`. The behaviour is fully specified by the supplied tests.

Prerequisite: Node.js 18 or newer (the tests use Node's built-in test runner). Then run:

```bash
node --test
```

Make **all tests pass**. Do **not** modify the tests. The reply path in `src/replyService.js` is
already wired to your breaker.

The breaker must:

- start `CLOSED` and count calls and failures;
- move to `OPEN` when `failures / calls >= failureThreshold` **and** `calls >= minimumRequests`;
- while `OPEN` and within `openMillis`, short-circuit (throw `CircuitOpenError` without calling the
  dependency) and increment `metrics.short_circuited_total`;
- after `openMillis` elapses (using the injected `now()`), allow one `HALF_OPEN` probe — success
  closes it and resets counts, failure re-opens it;
- increment `metrics.breaker_open_total` on every trip and call `onStateChange(state)` on every
  transition.

## What to submit

Open a pull request on a branch named `production-hardening-slice`, and in your README include these
labelled sections:

1. **Risk addressed**
2. **Chosen control**
3. **How to run / test**
4. **Evidence** (a reviewer can confirm it works without reading all your code)
5. **Observability note** (which metric moves and which state changes are logged)
6. **Trade-off**
7. **Remaining risk**
8. **How this production control protects my Modules 1–3 design**

Submit the pull-request URL.

---

## Production Hardening Proof Slice: Circuit Breaker

### 1. Risk addressed
Cascading failure, worker thread exhaustion, and unbound latency when PromptPilot's external model provider fails or responds slowly, causing doomed requests to pile up and take down the support ticket service.

### 2. Chosen control
A stateful circuit breaker pattern implemented in [`src/circuitBreaker.js`](./src/circuitBreaker.js) wrapping external model provider invocations in [`src/replyService.js`](./src/replyService.js). It transitions through `CLOSED`, `OPEN`, and `HALF_OPEN` states, tripping when failures reach or exceed the `failureThreshold` (default 50%) after at least `minimumRequests` (default 5). When `OPEN`, it short-circuits instantly by throwing `CircuitOpenError` to return a safe fallback without calling the dependency, and probes recovery via a single request once `openMillis` has elapsed.

### 3. How to run / test
Run the automated test suite using Node's built-in test runner:
```bash
npm test
```
(or `node --test`)

**Expected result:**
All 8 tests pass (8 pass, 0 fail) in ~100ms:
```text
TAP version 13
# Subtest: stays closed below the minimum request volume
ok 1 - stays closed below the minimum request volume
# Subtest: opens once failures cross the threshold with enough volume
ok 2 - opens once failures cross the threshold with enough volume
# Subtest: short-circuits without calling the dependency while open
ok 3 - short-circuits without calling the dependency while open
# Subtest: probes after the open window and closes on a successful probe
ok 4 - probes after the open window and closes on a successful probe
# Subtest: a failed probe re-opens the circuit
ok 5 - a failed probe re-opens the circuit
# Subtest: reports state changes for observability
ok 6 - reports state changes for observability
# Subtest: returns a model draft while the provider is healthy
ok 7 - returns a model draft while the provider is healthy
# Subtest: degrades to a safe fallback once the circuit opens
ok 8 - degrades to a safe fallback once the circuit opens
1..8
# tests 8
# suites 0
# pass 8
# fail 0
```

### 4. Evidence
The automated test suite in `test/circuitBreaker.test.js` and `test/replyService.test.js` provides runnable verification:
- `stays closed below the minimum request volume`: verifies calls below `minimumRequests` (4 failures) keep the breaker `CLOSED`.
- `opens once failures cross the threshold with enough volume`: verifies 5 failures trip the breaker to `OPEN` and increment `breaker_open_total`.
- `short-circuits without calling the dependency while open`: proves downstream dependency is never called when open, throwing `CircuitOpenError` and incrementing `short_circuited_total`.
- `probes after the open window and closes on a successful probe`: verifies that after `openMillis` (1000ms), a probe executes, transitions to `HALF_OPEN`, and closes the circuit on success.
- `a failed probe re-opens the circuit`: verifies a failing probe re-trips the breaker back to `OPEN` and increments `breaker_open_total` to 2.
- `reports state changes for observability`: verifies state transitions `['OPEN', 'HALF_OPEN', 'CLOSED']` via `onStateChange`.
- `degrades to a safe fallback once the circuit opens`: verifies `replyService` falls back to queued human agent text immediately with `reason: 'circuit_open'` when breaker is open.

### 5. Observability note
The control announces itself via metrics and structured state transition events:
- **Metrics**:
  - `metrics.breaker_open_total`: Incremented whenever the breaker transitions to `OPEN` (trips).
  - `metrics.short_circuited_total`: Incremented on every call fast-failed while `OPEN` or during concurrent calls in `HALF_OPEN`.
  - `metrics.success_total` & `metrics.failure_total`: Cumulative telemetry counters tracking downstream health.
- **Events**:
  - `onStateChange(state)` callback triggers on every state transition (`OPEN`, `HALF_OPEN`, `CLOSED`), allowing structured logging (e.g. `{"event": "circuit_breaker_transition", "to_state": "OPEN"}`) and alerting.
  - Safe telemetry only: no customer secrets, prompt payloads, or personal data are ever exposed in logs or metrics.

### 6. Trade-off
- **Degraded user experience during outage windows**: While the circuit is `OPEN`, all requests immediately receive the fallback response ("Your ticket is queued for a human agent") rather than an AI-drafted reply, even if the upstream provider temporarily recovers before the `openMillis` window expires.
- **In-memory state overhead**: Requires local state tracking (`state`, timestamps, counters) per node or centralized coordination in distributed deployments.

### 7. Remaining risk
The breaker protects against sustained provider outages and cascading pileups, but does not protect against:
- High latency on individual requests before the failure threshold trips.
- Sudden traffic spikes causing resource exhaustion while the circuit is still `CLOSED`.
- *Next step:* Introduce a strict request timeout (e.g. 2500ms abort controller) and a concurrency-limiting backpressure bulkhead around provider calls.

### 8. How this production control protects my Modules 1–3 design
This control defends the core availability contract and support ticket SLA established in Modules 1–3:
- The ticket ingestion and routing workflow assumes the reply pipeline remains responsive under all conditions.
- Without this circuit breaker, a dead or lagging LLM provider would exhaust PromptPilot's I/O event loop and HTTP connection pools, blocking the ingestion of new tickets.
- The breaker preserves system responsiveness by shedding doomed provider calls and falling back immediately to human agent queueing.

