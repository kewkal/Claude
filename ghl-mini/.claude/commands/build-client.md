---
description: Take an onboarding response and build the client's site end to end
argument-hint: [response id]
---

Build the site for onboarding response $ARGUMENTS.

1. Use the `onboarding-agent` subagent to read the response and write a complete brief to `briefs/`.
2. Review the brief. If it has blocking questions, stop and list them for the user.
3. Otherwise use the `site-builder` subagent to build the site from the brief.
4. Update `onboarding_responses.status` as you go: `briefed`, then `delivered`.
5. Report what was built, what you assumed, and what you still need from the client.
