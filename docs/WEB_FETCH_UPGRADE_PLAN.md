# Web Fetch Layer Upgrade Plan

## Objective
Replace public-proxy based fetching (for example `r.jina.ai`) with a controlled, production-grade first-party browsing/fetch architecture.

## Current Problems
- Shared proxy IP pools get blocked by anti-bot controls (451/403/captcha walls).
- Proxy uptime/behavior is outside product control.
- Error modes are inconsistent and hard to reason about.
- Compliance and data-governance posture is weak when relying on public proxies.

## Target Architecture
1. First-party fetch execution only.
2. A single navigation policy layer that:
   - normalizes URLs,
   - defines deterministic retry/attempt strategies,
   - classifies failures (HTTP/auth/challenge/network/timeout),
   - emits structured diagnostics.
3. Browser-backed acquisition as primary strategy (Playwright sessions controlled by us).
4. Optional future private fetch relay (self-hosted) for scale-out and IP reputation control.

## Phased Plan

### Phase 1: Proxy Elimination (Implemented in this change)
- Remove generation of `r.jina.ai` navigation attempts.
- Unwrap legacy incoming `r.jina.ai/<source-url>` links to source-domain URLs.
- Keep first-party direct hostname attempts only.
- Add regression tests proving no proxy attempts are emitted.

### Phase 2: Navigation Policy Hardening
- Introduce explicit attempt budgets and retry backoff by failure class.
- Add domain policies:
  - required waits/selectors,
  - JS-enabled vs raw DOM strategies,
  - optional mobile/desktop user-agent profiles.
- Add canonicalization rules for common paywall/challenge redirects.

### Phase 3: Anti-Bot & Reliability Layer
- Classify blocks with stable internal error codes:
  - `CHALLENGE_WALL`,
  - `IP_REPUTATION_BLOCK`,
  - `PAYWALL_BLOCK`,
  - `RATE_LIMIT`.
- Add fallback execution routes:
  - alternate first-party egress pools (self-managed),
  - private relay (not public proxy).
- Persist per-domain health metrics and adaptive strategy selection.

### Phase 4: Observability and SLOs
- Emit structured events for each attempt:
  - URL (normalized),
  - attempt index,
  - status code,
  - classifier,
  - elapsed time.
- Add dashboards and alerting for:
  - success ratio by domain,
  - block ratio by domain,
  - median acquisition latency.
- Define SLO targets and rollback criteria.

### Phase 5: Controlled Rollout
- Feature flag rollout:
  - `first_party_fetch_policy` (default off -> on gradually).
- Canary by domain buckets.
- Remove dead code and legacy compatibility paths after stable cutover.

## Acceptance Criteria
- Zero runtime dependency on public proxy endpoints.
- No internally generated `r.jina.ai` URLs.
- Legacy wrapped URLs continue to resolve to source URLs safely.
- Equivalent or improved snapshot acquisition success rate on priority domains.
- Clear error taxonomy and diagnosable logs for failures.

## Work Started (This Iteration)
- `browser/orchestrator` now uses first-party direct attempts only.
- Legacy `r.jina.ai` wrapper URLs are normalized into source URLs.
- Unit tests updated to enforce proxy-free behavior.
