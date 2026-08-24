---
name: mutation-test-safety
description: The capture-state/smallest-change/verify/revert/verify-revert contract for live-testing a mutation tool against a real account. Use any time you're about to call a mutation tool live, not just during a full audit.
---

# Mutation testing safety contract

Applies to any mutation tool (add/update/remove/delete/post/follow/favourite/
etc.) once the user has given explicit go-ahead to test it against a real
account. For every mutation call:

1. **Capture the exact pre-state first** (via the matching read tool) — not
   just an assumption of what it probably is. A target with no existing
   state has a clear pre-state too: "absent." This applies to _every_ call
   to a mutation tool, including one you intend only as a validation-only
   probe — if the schema isn't `.strict()`, a bogus/typo'd field is silently
   dropped rather than rejected, and any other real field in the same call
   still applies for real.
2. **Make the smallest possible change** that still exercises the behavior
   (e.g. one field, not a full rewrite). Never combine an unknown/invalid
   probe field with a real valid field in one call — if the probe field is
   ignored instead of rejected, the valid field mutates the account for
   real. Test unknown-param rejection with _no other fields set_ (or on a
   read-only tool) instead.
3. **Verify the change landed** by re-fetching via a read tool — a
   mutation's own echoed response is not always trustworthy (some tools
   have historically omitted fields they actually changed).
4. **Revert to the captured pre-state immediately, in the same turn**, and
   verify the revert too. Don't batch several mutations and revert at the
   end — revert each one before moving to the next unrelated test.
5. **Never leave the target in a different state than you found it**, even
   if a step errors partway through — check and clean up regardless.
6. **Never touch an uninvolved third party.** Self-targeted mutations
   (a self-message, a self-created and immediately-deleted test post/
   thread/comment) are fine; acting on a random other real user/account is
   not.
