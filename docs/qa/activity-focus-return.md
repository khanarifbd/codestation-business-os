# Activity drawer focus restoration (CI2356)

CI2356 failed the existing Activity keyboard proof at shared-admin-browser.mjs73: after Escape, the original View activity button remained inactive for10s. This is not a text-field focus-style issue.

Source lifecycle: opening detail makes the background inert in the same commit; the drawer previously captured document.activeElement only in a passive effect. When inert blurs the triggering button before that effect, cleanup remembers body, not the trigger. A faithful actual-component effect regression reproduced this before the fix (/tmp/activity-focus-before.log).

Correction: desktop keyboard button, row pointer and mobile button handlers retain the exact opener before openDetail updates state. Drawer cleanup restores only that connected, still-current, visible, non-inert opener. Replaced/disconnected/hidden/inert targets are not focused. Existing Escape/Tab containment and background inert remain; no CSS, permission, data-request, filter, or detail ownership changes. Retry/remount retains the same opener; a newer opener cannot be overwritten by older cleanup. Owner-keyed page unmount removes old nodes, preventing stale workspace focus theft.

53 focused Activity/administration tests pass, including actual page handlers, inert-induced blur, StrictMode effect replay, stale/disconnected/hidden target negatives, existing containment tests and exact controller inverse-hash guard with negative tamper detection. Scoped lint zero errors (one intentional fresh-ref cleanup warning). Existing browser assertions/timeouts remain unchanged and actual CI must confirm the correction; artifacts were unavailable after the failed runner shutdown.
