'use strict';

// Your task: implement a circuit breaker around PromptPilot's model provider.
//
// The supplied tests in test/circuitBreaker.test.js describe the exact behaviour.
// Do not modify the tests. Make them all pass.
//
// Requirements proven by the tests:
//   - Start in the CLOSED state. While CLOSED, count calls and failures.
//   - OPEN when (failures / calls) >= failureThreshold AND calls >= minimumRequests.
//   - While OPEN and within openMillis, SHORT-CIRCUIT: throw CircuitOpenError
//     WITHOUT calling fn, and increment metrics.short_circuited_total.
//   - After openMillis has elapsed (use the injected now()), allow ONE probe
//     call (HALF_OPEN). A successful probe -> CLOSED and reset the counts.
//     A failed probe -> OPEN again.
//   - Increment metrics.breaker_open_total every time you move to OPEN.
//   - Call options.onStateChange(state) on every state transition.
//
// Injected options (all optional, with sensible defaults):
//   failureThreshold, minimumRequests, openMillis, now, onStateChange

class CircuitOpenError extends Error {
  constructor() {
    super('circuit is open');
    this.code = 'CIRCUIT_OPEN';
  }
}

function createCircuitBreaker(options = {}) {
  const failureThreshold = options.failureThreshold ?? 0.5;
  const minimumRequests = options.minimumRequests ?? 5;
  const openMillis = options.openMillis ?? 10000;
  const now = options.now ?? Date.now;
  const onStateChange = options.onStateChange ?? function () {};

  const metrics = {
    breaker_open_total: 0,
    short_circuited_total: 0,
    success_total: 0,
    failure_total: 0,
  };

  let state = 'CLOSED';
  let totalCalls = 0;
  let failureCalls = 0;
  let openedAt = 0;

  function transitionTo(newState) {
    if (state === newState) return;
    state = newState;
    if (state === 'OPEN') {
      openedAt = now();
      metrics.breaker_open_total++;
    }
    onStateChange(state);
  }

  async function exec(fn) {
    if (state === 'OPEN') {
      if (now() - openedAt >= openMillis) {
        transitionTo('HALF_OPEN');
      } else {
        metrics.short_circuited_total++;
        throw new CircuitOpenError();
      }
    } else if (state === 'HALF_OPEN') {
      metrics.short_circuited_total++;
      throw new CircuitOpenError();
    }

    const currentState = state;
    if (currentState === 'HALF_OPEN') {
      try {
        const result = await fn();
        metrics.success_total++;
        totalCalls = 0;
        failureCalls = 0;
        transitionTo('CLOSED');
        return result;
      } catch (err) {
        metrics.failure_total++;
        totalCalls = 0;
        failureCalls = 0;
        transitionTo('OPEN');
        throw err;
      }
    }

    // CLOSED state
    totalCalls++;
    try {
      const result = await fn();
      metrics.success_total++;
      return result;
    } catch (err) {
      metrics.failure_total++;
      failureCalls++;
      if (totalCalls >= minimumRequests && (failureCalls / totalCalls) >= failureThreshold) {
        transitionTo('OPEN');
      }
      throw err;
    }
  }

  return {
    exec,
    metrics,
    get state() {
      return state;
    },
  };
}

module.exports = { createCircuitBreaker, CircuitOpenError };
