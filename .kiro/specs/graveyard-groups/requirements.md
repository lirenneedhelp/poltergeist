# Requirements Document

## Introduction

Graveyard Groups changes how Tab Graveyard (`app2-tab-graveyard/`) buries tabs. Today `Bury all` saves each Dead_Tab to the Buried_List and then closes it. After this change:

- `Bury all` moves every listed Dead_Tab that is in no tab group into a grey, collapsed tab group titled `Graveyard` and closes nothing. A Dead_Tab inside one of the user's own tab groups stays in that group.
- A new `Empty graveyard` button, shown only when the Graveyard group holds tabs it can close, saves each of those tabs to the Buried_List and then closes them.
- Resurrect on a tab inside the Graveyard group resets the tab and takes it out of the group.
- The toolbar icon shows the number of Dead_Tabs, and shows nothing when there are none.
- Pinned and audible tabs are exempt: they do not decay and do not count as dead.
- An optional `Auto-bury dead tabs` setting, off by default, moves tabs that are in no tab group into the Graveyard group as they die.

Rules kept from the tab-graveyard-app spec: Buried_Entries are saved before any tab closes; only extension pages may request a closing command; `tabs.remove` is called from one handler only; nothing closes on a timer, an event, or a threshold; open-tab data lives only in `chrome.storage.session`; the worker takes page URLs from `MessageSender.url` and titles from the content script and never reads them from Chrome; Reopen, Demo_Mode, the decay profile in `rules.json`, and the in-page Tombstone are unchanged.

Scope: the change touches `app2-tab-graveyard/manifest.json` (the `permissions` value only), `background.js`, `content.js`, `popup.html`, `popup.js`, `popup.css`, the app's tests, `scripts/validate-graveyard-package.mjs`, and the tab-graveyard-app spec documents. It does not touch `skeleton/`, either Generated_Skeleton, `app2-tab-graveyard/rules.json`, `web_accessible_resources`, `package.json` scripts, Doomscroll, or `demo-site/`, so the haunt-kit spec, which edits Graveyard's `web_accessible_resources` and `scripts.pretest` after this spec lands, applies unchanged. The implementation plan should fit in about 6 to 8 tasks.

Change markers: `APP` changes app code; `PACKAGING` changes the manifest or the Graveyard_Validator; `DOCS` changes the tab-graveyard-app spec documents; `TEST` covers verification.

Verification modes: criteria are verified by Vitest example-based unit tests unless prefixed `(BROWSER-VERIFIED)`. Browser-verified criteria run through Playwright with the unpacked extension in Playwright's bundled Chromium, using the existing graveyard fixture. Requirement 10 (DOCS) criteria are verified by reading the Prior_Spec documents, not by a test. This spec adds no property-based tests.

### Decisions for review

These choices interpret the request. Each is cheap to change before design.

1. **One Graveyard_Group per window.** Chrome tab groups belong to one window, so "a single group" means one per window. A tab is never moved to another window. `Bury all` and `Empty graveyard` act on every non-incognito window, as `Bury all` does today.
2. **The group is identified by its id, not its title.** The worker records the id of each group it creates. A group the user made is never taken over, even if the user titled it `Graveyard`. Group ids last only for the browser session, so after a browser restart the next Bury creates a new group. This matches the existing boundary that Tab_Records do not survive a restart.
3. **A renamed group is released.** If the user renames the Graveyard group, the user has given it another purpose. The worker forgets the group, leaves it and its tabs as they are, and `Empty graveyard` no longer closes them. The next Bury creates a new Graveyard group. Changing the colour or expanding the group keeps it as the Graveyard group.
4. **Empty graveyard does not re-check deadness.** It closes the grouped tabs the popup counted, including a tab the user dragged into the group. It skips Exempt_Tabs and tabs with no saved URL, because a tab whose entry cannot be saved could not be reopened. To avoid closing more than the user saw, the worker closes only the ids the popup sent that are still in a Graveyard group.
5. **Exemption works like a held Resurrect.** While a tab is pinned or audible, its Registers stay at 0 and no Absence runs. When the exemption ends, a fresh Absence starts. A dead tab that the user pins is therefore no longer dead. Exemption does not move a tab out of the Graveyard group. Chrome itself removes a tab from its group when the tab is pinned.
6. **The badge counts every Dead_Tab, including those in the Graveyard group and those in the user's own groups (decision 12).** Moving a tab into the group does not change the count. Resurrect, closing, exemption, and Demo_Mode changes do.
7. **No `alarms` permission.** A worker timer does not survive the service worker's idle shutdown, so the worker learns that a tab died from the tab's own page (Requirement 7 criteria 3 and 7) and recounts after every event it handles. A discarded or frozen tab has no running page, so its death shows at the next handled event.
8. **Auto-bury attempts each tab once per death and skips active tabs.** A tab the user moved out of the Graveyard group, or a whole group the user ungrouped, stays out until the tab is reset and dies again. The active tab of a window is never auto-buried, so a tab does not vanish while the user is looking at it.
9. **Burying the active tab.** If `Bury all` moves a window's active tab, collapsing the group makes Chrome activate the neighbouring tab ([MDN: tabGroups.update](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/update)). The worker tracks that activation like any other.
10. **Chrome's own saved tab groups.** Recent Chrome versions can save tab groups and sync them to the user's Google account. That data belongs to Chrome and follows the user's Chrome settings; it is outside the extension's storage. The extension itself stores only what Requirement 9 allows.
11. **Existing property test.** The existing fast-check test "Property 3: Nothing closes without Bury" is updated, not removed, because its assertion names the closing message. No new property-based test is added.
12. **Tabs in the user's own groups stay there (chosen by the user).** When a Dead_Tab is inside a tab group that is not a Graveyard_Group, `Bury all` and Auto-bury leave the tab in that group, and the popup neither lists the tab nor counts it in `Bury all (N)`. The extension never moves a tab into or out of a group the user made and never changes that group's title, colour, or collapsed state. The Badge still counts every Dead_Tab, so the Badge number can be higher than the `Bury all` count. When every Dead_Tab is in the user's own groups and the Graveyard group holds no Closable_Tab, the popup shows `No dead tabs.` while the Badge shows a number.

### Permission rationale

The manifest gains exactly one permission, `tabGroups`.

| Chrome API used | Permission needed | Used for |
|---|---|---|
| `tabGroups.update`, `tabGroups.get`, `tabGroups.onUpdated`, `tabGroups.onRemoved` | `tabGroups` | Setting the group's title, colour, and collapsed state; detecting a rename; forgetting a closed group |
| `tabs.group`, `tabs.ungroup` | none | Moving tabs into and out of the group |
| `Tab.pinned`, `Tab.audible`, `Tab.groupId`, and the same fields in `tabs.onUpdated` | none | Exemptions and group membership |
| `action.setBadgeText` | none (the manifest's `action` key) | The badge |

Not added: `tabs`, because it only unlocks `url`, `pendingUrl`, `title`, and `favIconUrl`, which the privacy design does not read, and carries the warning "Read your browsing history"; `host_permissions`; `alarms` (decision 7). Chrome shows the warning "View and manage your tab groups" for `tabGroups` when the extension is installed. Reloading an unpacked copy picks up the new permission. A store release that adds this permission would need a version bump, which is outside this spec because Requirement 1 criterion 2 keeps `version` unchanged; Chrome would then keep the updated copy disabled until the user approves the new permission.

Sources: [chrome.tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups), [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [permission list and warnings](https://developer.chrome.com/docs/extensions/reference/permissions-list). Content was rephrased for compliance with licensing restrictions.

Out of scope: keeping the Graveyard group across a browser restart; listing grouped tabs one by one in the popup; emptying only one window; badge colour or tooltip; per-site exemptions; changes to `rules.json`, the skeleton, the Tombstone, Doomscroll, or `demo-site/`; Chrome's own saving or syncing of tab groups.

## Glossary

- **Activity_Tracker**: the Tab Graveyard service worker in `app2-tab-graveyard/background.js`, as defined in tab-graveyard-app, including its message handlers.
- **Popup**: `app2-tab-graveyard/popup.html` with `popup.js`.
- **Runtime_Controller**: the content-script logic in `app2-tab-graveyard/content.js` that owns at most one live Poltergeist instance per document.
- **Manifest**: `app2-tab-graveyard/manifest.json`.
- **Graveyard_Validator**: `scripts/validate-graveyard-package.mjs`.
- **Unit_Suite**: the Vitest tests under `app2-tab-graveyard/test/`.
- **Browser_Suite**: the Playwright tests under `app2-tab-graveyard/test/browser/`.
- **Prior_Spec**: the tab-graveyard-app spec documents in `.kiro/specs/tab-graveyard-app/`.
- **Extension_Page**: a sender that the Activity_Tracker accepts as one of the extension's own pages (the popup or the test control page), as in tab-graveyard-app.
- **Tab_Record**, **Register**, **Absence**, **Away_Time**, **Stage**, **Buried_Entry**, **Demo_Mode**, **Resurrect**: as defined in tab-graveyard-app.
- **Buried_List**: the list of Buried_Entries stored in `chrome.storage.local`, newest first, at most 200 entries.
- **Tombstone threshold**: the trigger threshold of the `graveyard-tombstone` rule for the active profile (86400 seconds, or 24 seconds in Demo_Mode).
- **Exempt_Tab**: a tab whose `pinned` or `audible` property Chrome reports as true.
- **Reset**: setting both Registers of a tab to 0, either by Resurrect or because the tab became an Exempt_Tab.
- **Saveable_Tab**: an open, non-incognito tab whose Tab_Record holds a URL, reported through a content script, of at most 2048 characters.
- **Dead_Tab**: a Saveable_Tab that is not an Exempt_Tab and whose Away_Time is at or above the Tombstone threshold. This replaces the tab-graveyard-app definition.
- **Buryable_Tab**: a Dead_Tab that is in no tab group, that is, whose `groupId` Chrome reports as `-1`.
- **Graveyard_Group**: a tab group that the Activity_Tracker created for `Bury all` or Auto_Bury and whose id the Activity_Tracker has recorded for its window.
- **Graveyard_Tab**: an open tab whose group id is the id of a Graveyard_Group.
- **Closable_Tab**: a Graveyard_Tab that is a Saveable_Tab and not an Exempt_Tab.
- **Release**: deleting the Activity_Tracker's record of a Graveyard_Group while leaving the group, its title, its colour, and its tabs unchanged.
- **Badge**: the text on the extension's toolbar icon, set with `action.setBadgeText` for all tabs.
- **Recount**: counting the Dead_Tabs and updating the Badge.
- **Live_Page**: a tab whose top-frame content script is running in a page that Chrome has neither discarded nor frozen.
- **Auto_Bury**: a global Boolean preference stored in `chrome.storage.local`, off by default, that moves tabs into a Graveyard_Group as they die.

## Requirements

### Requirement 1: Permissions, APIs, and message protocol - PACKAGING

**User Story:** As a user, I want Tab Graveyard to ask only for the tab-group access it needs, so that grouping tabs does not expose my browsing history.

#### Acceptance Criteria

1. THE Manifest SHALL declare `permissions` as exactly `["storage", "tabGroups"]`, in that order.
2. THE Manifest SHALL keep the same set of top-level keys as the Manifest committed before this spec's first change, and SHALL keep every key other than `permissions` equal to its value in that commit when compared as parsed JSON, including `manifest_version`, `name`, `version`, `incognito`, `background`, `action`, `content_scripts`, and `web_accessible_resources`.
3. IF the Manifest `permissions` value is anything other than an array equal to `["storage", "tabGroups"]` (for example a missing `permissions` key, a non-array value, a missing `tabGroups`, an added `tabs` or `alarms`, a duplicate, or another order), THEN THE Graveyard_Validator SHALL report exactly one permission error, `manifest.json: permissions must be exactly ["storage", "tabGroups"]`, and SHALL mark the package invalid, exiting with a non-zero status when run from the command line.
4. IF the Manifest declares any of `host_permissions`, `optional_permissions`, `optional_host_permissions`, `externally_connectable`, `content_security_policy`, or `sandbox`, THEN THE Graveyard_Validator SHALL report its existing error `manifest.json: <key> is not allowed` once for each declared key, as before this spec.
5. THE Graveyard_Validator source SHALL contain a comment on the lines directly above the permission check stating that `tabGroups` is needed to read and set the Graveyard_Group's title, colour, and collapsed state and to receive its update and removal events, and that no other permission is needed because `tabs.group`, `tabs.ungroup`, `tabs.onUpdated`, the `pinned`, `audible`, and `groupId` properties, and `action.setBadgeText` need none.
6. THE Activity_Tracker SHALL call or add listeners to no Chrome API other than the APIs that `background.js` calls or listens to before this spec's first change and `tabs.group`, `tabs.ungroup`, `tabs.onUpdated`, `tabGroups.get`, `tabGroups.update`, `tabGroups.onUpdated`, `tabGroups.onRemoved`, and `action.setBadgeText`.
7. WHEN `background.js` is evaluated, THE Activity_Tracker SHALL add its `tabs.onUpdated`, `tabGroups.onUpdated`, and `tabGroups.onRemoved` listeners synchronously, in the same registration step as the existing listeners and before that evaluation completes, so that a worker woken by one of these events receives that event.
8. THE Activity_Tracker SHALL accept exactly these message types: the Prior_Spec types `graveyard:content-state`, `graveyard:report`, `graveyard:resurrect`, `graveyard:popup-state`, `graveyard:resurrect-tab`, `graveyard:bury`, `graveyard:reopen`, and `graveyard:set-demo`, plus `graveyard:empty` and `graveyard:set-auto-bury` from an Extension_Page, and SHALL reply to every message with `{ok: true, ...}` or `{ok: false, error}` under the rules of Prior_Spec Requirement 7 criterion 14. The third new type, `graveyard:refresh`, SHALL be sent only by the Activity_Tracker and handled only by the Runtime_Controller.
9. IF the Activity_Tracker receives a `graveyard:refresh` message, THEN THE Activity_Tracker SHALL reply `{ok: false, error}` and change no stored data, tab, or tab group, as it does for `graveyard:apply-reset`.
10. THE Popup SHALL call no `tabGroups` API, `tabs.group`, `tabs.ungroup`, or `action` API, so that only the Activity_Tracker moves tabs, reads tab group data, and sets the Badge. (Requirement 9 criterion 5 limits what the Popup reads from the Tabs API.)
11. WHEN the Manifest `permissions` value is exactly `["storage", "tabGroups"]`, THE Graveyard_Validator SHALL report no permission error.

### Requirement 2: Graveyard group identity - APP

**User Story:** As a user with several windows and my own tab groups, I want each window to have one Graveyard group that the extension recognises reliably, so that my own groups are left alone.

#### Acceptance Criteria

1. THE Activity_Tracker SHALL keep at most one Graveyard_Group per non-incognito window, and SHALL record only that group's id in `chrome.storage.session` under a key that ends in the window id and is separate from the Prior_Spec window entry.
2. THE Activity_Tracker SHALL treat a tab group as a Graveyard_Group only while the group's id is the recorded id for the window that holds the group, and SHALL never set the title, colour, or collapsed state of any other tab group, move a tab into it, or move a tab out of it, including a group the user titled `Graveyard` and a Released group that the user later renames back to `Graveyard` (decision 12).
3. WHEN the Activity_Tracker creates a Graveyard_Group while handling `graveyard:bury` or Auto_Bury, THE Activity_Tracker SHALL set the group's title to exactly `Graveyard`, its colour to `grey`, and its collapsed state to true before that job finishes.
4. WHEN `tabGroups.onUpdated` fires for a tab group whose id is still recorded for its window when the handling job runs, THE Activity_Tracker SHALL read the group's current title with `tabGroups.get` only after every job queued before the event has finished, and SHALL Release the group if that title is not exactly `Graveyard` (case-sensitive, with no trimming), leaving every Tab_Record unchanged.
5. WHILE a job is creating a Graveyard_Group, THE Activity_Tracker SHALL record the new group's id before the call that sets the group's title, colour, and collapsed state, and SHALL keep that record until the job finishes, so that a `tabGroups.onUpdated` event that reports the group's creation-time title does not Release it.
6. WHEN `tabGroups.onUpdated` fires for a Graveyard_Group whose current title is exactly `Graveyard`, THE Activity_Tracker SHALL keep the group recorded whatever its colour or collapsed state, and SHALL make no `tabGroups.update` call in response to that event.
7. WHEN `tabGroups.onRemoved` fires for a group whose id is recorded for its window, THE Activity_Tracker SHALL delete that record, whether the group was closed, ungrouped by the user, or emptied of its last tab.
8. WHEN `windows.onRemoved` fires, THE Activity_Tracker SHALL delete that window's Graveyard_Group record and leave the records of other windows unchanged.
9. IF, when the Activity_Tracker is about to move a tab into its window's recorded Graveyard_Group, `tabGroups.get` fails for the recorded id or reports a different window or a title other than exactly `Graveyard`, THEN THE Activity_Tracker SHALL delete the record, leave any such group and its tabs unchanged, and create a new Graveyard_Group for the tab as in criterion 3.
10. WHEN a tab enters or leaves a Graveyard_Group through any change other than the Activity_Tracker's own `tabs.group` or `tabs.ungroup` call (for example the user dragging the tab into or out of the group, or moving it to another window), THE Activity_Tracker SHALL keep the tab's Tab_Record and Registers unchanged and SHALL NOT undo the move.
11. WHEN a Graveyard_Tab closes for any reason other than `graveyard:empty`, including the user closing the tab or its whole Graveyard_Group, THE Activity_Tracker SHALL delete the tab's Tab_Record as for any closed tab and SHALL save no Buried_Entry for it.
12. IF `tabGroups.get` fails during the title check of criterion 4, THEN THE Activity_Tracker SHALL keep the record unchanged and log one diagnostic, and criteria 7 and 9 SHALL remove the record if the group is gone.
13. IF recording a new group's id or setting its title, colour, or collapsed state fails while the Activity_Tracker is creating a Graveyard_Group, THEN THE Activity_Tracker SHALL delete any record for that group, make no further Chrome call on that group, leave the group and its tabs open as they are, move no other tab of that window in the same job, log one diagnostic, and, while handling `graveyard:bury`, list in `notMoved` each of that window's tabs that qualified under Requirement 3 criterion 3 and is outside every Graveyard_Group.

### Requirement 3: Bury all moves tabs into the group - APP

**User Story:** As a student with dozens of dead tabs, I want `Bury all` to tuck them into one collapsed group instead of closing them, so that I can clear my tab strip without losing anything.

#### Acceptance Criteria

1. THE Popup SHALL list the Buryable_Tabs reported in the latest `graveyard:popup-state` reply, SHALL show their number N in the `Bury all (N)` button, and SHALL disable that button when N is 0.
2. WHEN the user activates `Bury all`, THE Popup SHALL send `graveyard:bury` with the ids of the listed tabs.
3. WHEN handling `graveyard:bury`, THE Activity_Tracker SHALL move each distinct requested tab that is a Buryable_Tab at the time the handler runs into the Graveyard_Group of that tab's own window, reusing the window's recorded Graveyard_Group when one exists and creating one otherwise, and SHALL leave each requested Dead_Tab that is in any tab group in that group (decision 12).
4. WHEN `graveyard:bury` has moved at least one tab into a Graveyard_Group, THE Activity_Tracker SHALL set that group's title to exactly `Graveyard`, its colour to `grey`, and its collapsed state to true, including a reused group whose colour or collapsed state the user had changed.
5. WHILE handling `graveyard:bury`, THE Activity_Tracker SHALL close no tab, move no tab to another window, change no Register of any Tab_Record, save no Buried_Entry, and change the title, colour, or collapsed state of no tab group other than a Graveyard_Group into which the call moved a tab. (A tab activation that Chrome makes when the group collapses is handled after the call as any other activation, as in decision 9.)
6. WHEN the Activity_Tracker finishes handling a `graveyard:bury` that passed criteria 8 and 9, THE Activity_Tracker SHALL reply `{ok: true, moved, notMoved}`, where `moved` lists each tab that this call put into a Graveyard_Group, `notMoved` lists each tab that qualified under criterion 3 but is outside every Graveyard_Group after the call, each tab id appears at most once across both arrays, a requested id that did not qualify appears in neither array, and both arrays are empty when no requested tab qualified.
7. IF a Chrome call fails during `graveyard:bury`, THEN THE Activity_Tracker SHALL list in `notMoved` each qualifying tab that the failure left outside every Graveyard_Group, list in `moved` each tab that is already inside a Graveyard_Group (for example when `tabs.group` succeeded and `tabGroups.update` failed on a reused Graveyard_Group), continue with the remaining tabs and windows, and log one diagnostic per failed call. (A failure while creating a new Graveyard_Group follows Requirement 2 criterion 13.)
8. IF a `graveyard:bury` message passes criterion 9 and `rules.json` cannot be read, THEN THE Activity_Tracker SHALL reply `{ok: false, error: 'rules unavailable'}`, move no tab, and change no tab group.
9. IF `graveyard:bury` comes from a sender other than an Extension_Page, or carries anything other than an array of 0 to 500 tab ids that are each a non-negative integer, THEN THE Activity_Tracker SHALL reply `{ok: false, error}`, move no tab, and change no tab group.
10. WHEN a `graveyard:bury` reply is `ok: true` with both a `moved` array and a `notMoved` array, THE Popup SHALL refresh its state and, when `notMoved` has a length N greater than 0, SHALL show the warning `Could not move N tab to the Graveyard group.` when N is 1, or `Could not move N tabs to the Graveyard group.` otherwise, replacing and clearing that warning as Prior_Spec Requirement 7 criterion 20 describes.
11. IF a `graveyard:bury` reply is missing, is not `ok: true`, or is `ok: true` without both a `moved` array and a `notMoved` array, THEN THE Popup SHALL treat the command as failed, roll back to the last confirmed state, and show `Could not bury those tabs. Try again.`
12. WHEN the Popup renders a `graveyard:popup-state` reply that lists no Buryable_Tabs, does not have `rulesLoaded` exactly `false`, and reports at least one Closable_Tab id, THE Popup SHALL show `No dead tabs outside tab groups.` in place of `No dead tabs.`
13. THE Activity_Tracker SHALL list in the dead-tab list of every successful `graveyard:popup-state` reply exactly the Buryable_Tabs, leaving out Graveyard_Tabs and Dead_Tabs in any other tab group (decision 12).
14. WHILE the Popup's last confirmed `graveyard:popup-state` reply has `demoMode` true, THE Popup SHALL write each Away_Time it shows on the current-tab line and in the dead-tab list as the Prior_Spec duration wording of the Away_Time multiplied by 3600 followed by ` (demo time)` (for example `Away for 5 days (demo time)`), the same demo-time scaling and wording as the Tombstone, so that the Popup and the Tombstone never disagree; WHILE `demoMode` is false, THE Popup SHALL write the Away_Time unchanged with no suffix.

### Requirement 4: Empty graveyard - APP

**User Story:** As a user, I want one button that closes everything in the Graveyard group after saving it, so that I can reopen any of those tabs later.

#### Acceptance Criteria

1. THE Activity_Tracker SHALL include in every successful `graveyard:popup-state` reply the ids of all Closable_Tabs in every non-incognito window, including when the reply has `rulesLoaded` false.
2. WHILE the number M of Closable_Tab ids in the Popup's last confirmed `graveyard:popup-state` reply is greater than 0, THE Popup SHALL show an `Empty graveyard (M)` button.
3. WHEN the user activates `Empty graveyard`, THE Popup SHALL send one `graveyard:empty` message carrying the Closable_Tab ids from its last confirmed `graveyard:popup-state` reply, limited to the first 500 ids in reply order.
4. WHEN handling `graveyard:empty`, after every queued job ahead of it has finished, THE Activity_Tracker SHALL select the requested tabs that are Closable_Tabs at that moment, whether or not they are Dead_Tabs, in request order, ignoring repeated ids, and stopping at 200 selected tabs, and SHALL leave every tab it does not select open, in its current group, with its Tab_Record unchanged.
5. WHEN the Activity_Tracker has selected at least one tab for `graveyard:empty`, THE Activity_Tracker SHALL save one Buried_Entry `{id, title, url, buriedAt, awaySeconds}` per selected tab to the Buried_List before calling `tabs.remove` for any selected tab, taking `title` and `url` from the tab's Tab_Record, `buriedAt` from the handling time, and `awaySeconds` from the tab's Away_Time in whole seconds rounded down.
6. IF saving the Buried_List fails, THEN THE Activity_Tracker SHALL close no tab, leave the stored Buried_List and every selected tab's group membership unchanged, log one diagnostic, and reply `{ok: false, error: 'could not save buried tabs'}`.
7. IF `tabs.remove` fails for a selected tab, THEN THE Activity_Tracker SHALL keep that tab's Buried_Entry in the Buried_List, list the tab id in `notClosed`, continue closing the other selected tabs, and log one diagnostic for the call.
8. WHEN the Activity_Tracker finishes handling a valid `graveyard:empty`, THE Activity_Tracker SHALL reply `{ok: true, buried, notClosed}`, where `buried` lists the selected tab ids that closed and `notClosed` lists the selected tab ids that did not, so that each selected tab appears in exactly one array, no unselected tab appears in either, and both arrays are empty when no tab was selected.
9. THE Activity_Tracker SHALL call `tabs.remove` only while handling `graveyard:empty` from an Extension_Page, so that `graveyard:bury`, every other popup or content-script message, Auto_Bury, timers, Chrome events, and thresholds close no tab.
10. IF `graveyard:empty` comes from a sender other than an Extension_Page, or carries anything other than an array of at most 500 tab ids that are each a non-negative integer, THEN THE Activity_Tracker SHALL reply `{ok: false, error}`, close no tab, and save no Buried_Entry.
11. WHILE `rules.json` cannot be read, THE Activity_Tracker SHALL handle `graveyard:empty` exactly as when the rules are loaded, without replying `rules unavailable`, because selecting Closable_Tabs does not depend on Stage.
12. THE Activity_Tracker SHALL apply the Prior_Spec Buried_List limits to entries saved by `graveyard:empty`: the new entries are placed first in selection order, the list keeps at most 200 entries by dropping the oldest, each saved title has at most 300 characters, and each saved URL has at most 2048 characters.
13. WHEN a `graveyard:empty` reply is `ok: true` with both a `buried` array and a `notClosed` array, THE Popup SHALL refresh its state and, when `notClosed` has length N greater than 0, show the existing warning `Could not close N tab. It is still open.` when N is 1, or `Could not close N tabs. They are still open.` when N is 2 or more.
14. IF the `graveyard:empty` request fails, or its reply is not `ok: true`, or the reply lacks either the `buried` array or the `notClosed` array, THEN THE Popup SHALL roll back to the last confirmed state and show `Could not empty the graveyard. Try again.`
15. WHILE any Popup command, including `graveyard:empty`, is in flight, THE Popup SHALL disable the `Empty graveyard` button and send no further command until the state refresh after the reply has finished, as under its existing one-command-at-a-time rule.
16. WHILE M is 0 or the Popup has no confirmed state, THE Popup SHALL hide the `Empty graveyard` button.
17. WHEN the user activates `Reopen` on a Buried_Entry saved by `Empty graveyard`, THE Activity_Tracker SHALL handle it under the same Prior_Spec Reopen rules as every other Buried_Entry.

### Requirement 5: Resurrect leaves the group - APP

**User Story:** As a user who brings a buried tab back, I want Resurrect to take the tab out of the Graveyard group, so that the group holds only tabs I gave up on.

#### Acceptance Criteria

1. WHEN the Activity_Tracker has saved the Reset for `graveyard:resurrect` or `graveyard:resurrect-tab` and the tab is a Graveyard_Tab at that moment, THE Activity_Tracker SHALL remove the tab from its Graveyard_Group with one `tabs.ungroup` call, made after the Reset is saved and before the Activity_Tracker sends `graveyard:apply-reset` or its reply.
2. IF a resurrected tab is in no tab group, or is in a tab group that is not a Graveyard_Group (including a group the user titled `Graveyard`), when the Reset has been saved, THEN THE Activity_Tracker SHALL make no `tabs.ungroup` call for the tab and SHALL leave its group membership unchanged.
3. IF the `tabs.ungroup` call of criterion 1 fails, THEN THE Activity_Tracker SHALL keep the saved Reset, leave the tab where the failed call left it, keep the Graveyard_Group's record, make no second `tabs.ungroup` call for that Resurrect, log one diagnostic, and finish the Resurrect as when the call succeeds: `{ok: true}` for `graveyard:resurrect`, and for `graveyard:resurrect-tab` sending `graveyard:apply-reset` and replying `{ok: true, delivered}`.
4. WHEN Resurrect removes a tab from a Graveyard_Group, THE Activity_Tracker SHALL keep the tab open in the same window, save no Buried_Entry for it, move no other tab, and make no `tabGroups.update` call for the group.
5. THE Runtime_Controller SHALL keep the Prior_Spec Resurrect order (Prior_Spec Requirement 6 criteria 8 and 9): the page clears its decay only after a successful `graveyard:resurrect` reply or on receiving `graveyard:apply-reset`, and keeps its decay when the `graveyard:resurrect` reply fails.
6. THE Activity_Tracker SHALL call `tabs.ungroup` only as criterion 1 states, so that a Resurrect whose Reset was not saved (rejected sender, unknown or closed tab, or failed storage write) and a Reset caused by a tab becoming an Exempt_Tab ungroup no tab.

### Requirement 6: Pinned and audible exemptions - APP

**User Story:** As a student who keeps a pinned calendar and a background music tab, I want those tabs never to decay, so that the haunt only targets tabs I abandoned.

#### Acceptance Criteria

1. THE Activity_Tracker SHALL decide whether a tab is an Exempt_Tab from the `pinned` and `audible` values of the most recently handled of these sources: `sender.tab` of a content-script message, a `Tab` object returned by `tabs.get` or `tabs.query`, or the `Tab` object passed to `tabs.onUpdated` when its change information includes `pinned` or `audible`. A missing or non-Boolean `pinned` or `audible` value SHALL count as false.
2. WHEN a source in criterion 1 reports a tab as an Exempt_Tab and the Activity_Tracker has not saved the tab as exempt, THE Activity_Tracker SHALL save the tab as exempt, set both Registers of its Tab_Record (when one exists) to 0, end any Absence in progress without adding its elapsed time to the Held_Absence, and leave the tab in its current tab group.
3. WHILE a tab is an Exempt_Tab, THE Activity_Tracker SHALL start no Absence for the tab in the cases where Prior_Spec Requirement 5 criteria 2, 4, and 5 would start one (another tab in its window is activated, `runtime.onInstalled` or `runtime.onStartup` fires, or a Tab_Record is created for an inactive tab), so that the tab's Away_Time stays 0.
4. WHILE a tab is an Exempt_Tab, THE Activity_Tracker SHALL leave the tab out of the Buryable_Tabs and the Closable_Tabs reported in every `graveyard:popup-state` reply, out of the Badge count, and out of Auto_Bury.
5. WHEN a source in criterion 1 reports both `pinned` and `audible` as false for a tab that the Activity_Tracker has saved as exempt, THE Activity_Tracker SHALL save the tab as not exempt and keep both Registers at 0.
6. THE Activity_Tracker SHALL include in every successful `graveyard:content-state` reply an `exempt` Boolean that is true exactly when `sender.tab` reports `pinned` or `audible` as true, and SHALL set `heldSeconds` and `currentSeconds` to 0 in every reply whose `exempt` is true.
7. WHILE the latest `graveyard:content-state` reply has `exempt` true, THE Runtime_Controller SHALL hold no Poltergeist instance, stopping any running instance so that every effect is undone and the page holds no Poltergeist artifact.
8. WHEN the Activity_Tracker has saved a change in a tab's exemption state under criterion 2 or criterion 5, THE Activity_Tracker SHALL send one `graveyard:refresh` message to the tab's top frame.
9. WHEN the Runtime_Controller receives `graveyard:refresh` from a sender whose `id` is the extension's own id, THE Runtime_Controller SHALL request fresh state through the serialized, generation-guarded refresh of Prior_Spec Requirement 6 criterion 10 and, within 2 seconds of receiving the message, hold no Poltergeist instance when the reply has `exempt` true, or exactly one instance started from the reply's seeds when `exempt` is false.
10. IF `graveyard:refresh` cannot be delivered to a tab's top frame (for example because Chrome discarded the tab or the page has no content script), THEN THE Activity_Tracker SHALL keep the saved exemption change, not retry the message, and continue handling events, so that the page takes the exemption from the `graveyard:content-state` reply it requests when its content script next starts or the page fires `pageshow` with `persisted` true.
11. THE Runtime_Controller SHALL keep reading nothing from `chrome.tabs`, SHALL learn exemption only from the `exempt` value of `graveyard:content-state` replies, and SHALL treat a reply with `ok: true` that lacks a Boolean `exempt` as a failed state request under Prior_Spec Requirement 6 criterion 12, reporting one diagnostic and holding no Poltergeist instance.
12. WHILE a tab is an Exempt_Tab, WHEN the Activity_Tracker receives a valid `graveyard:report` from the tab, THE Activity_Tracker SHALL leave both Registers unchanged and reply `{ok: true, applied: false}`, as it does for a report with another Profile_Epoch.
13. WHEN `graveyard:bury` or `graveyard:empty` requests a tab that is an Exempt_Tab, THE Activity_Tracker SHALL neither move nor close the tab, SHALL save no Buried_Entry for it, and SHALL list it in none of `moved`, `notMoved`, `buried`, and `notClosed`.
14. WHILE a tab is not the active tab of its window, WHEN the tab stops being an Exempt_Tab, THE Activity_Tracker SHALL start an Absence at the time it handles that change, so that the tab reaches the Tombstone threshold no sooner than 86400 seconds (24 seconds in Demo_Mode) after the exemption ends.

### Requirement 7: Toolbar badge - APP

**User Story:** As a user, I want the toolbar icon to show how many of my tabs are dead, so that I notice neglect without opening the popup.

#### Acceptance Criteria

1. WHEN the Activity_Tracker performs a Recount, THE Activity_Tracker SHALL set the Badge, with no tab id so that every window shows the same text, to the number of Dead_Tabs across all non-incognito windows, including Dead_Tabs that are Graveyard_Tabs and Dead_Tabs in any other tab group (decision 12), written in base-10 digits with no leading zeros, separators, or suffix, and to the empty string when that number is 0.
2. WHEN the Activity_Tracker finishes the job for a `tabs`, `windows`, or `tabGroups` event it listens to, for `runtime.onInstalled` or `runtime.onStartup`, or for a message it answers with `ok: true` (including every content-script message, every popup command, and the Demo_Mode and Auto_Bury changes), THE Activity_Tracker SHALL perform a Recount of the state after that job before it starts the next queued job.
3. WHILE Demo_Mode is on, WHEN the Away_Time that the Activity_Tracker holds for a Saveable_Tab that has a Live_Page and is not an Exempt_Tab reaches the Tombstone threshold during an Absence, THE Activity_Tracker SHALL perform a Recount that counts the tab within 5 seconds of that moment, even when no tab, window, or tab-group event and no popup command occurs in that time.
4. WHEN the Away_Time of a Saveable_Tab that is not an Exempt_Tab reaches the Tombstone threshold while the tab has no Live_Page, THE Activity_Tracker SHALL count the tab at the first Recount that runs after that moment.
5. IF `rules.json` cannot be read when a Recount runs, THEN THE Activity_Tracker SHALL set the Badge to the empty string.
6. IF a Recount cannot read the Tab_Records, cannot query the open tabs, or gets a failure from `action.setBadgeText`, THEN THE Activity_Tracker SHALL leave the Badge text as it was, log one diagnostic for that Recount, and keep handling later events and Recounts.
7. WHILE Demo_Mode is off, WHEN the Away_Time that the Activity_Tracker holds for a Saveable_Tab that has a Live_Page and is not an Exempt_Tab reaches the Tombstone threshold during an Absence, THE Activity_Tracker SHALL perform a Recount that counts the tab within 65 seconds of that moment, even when no tab, window, or tab-group event and no popup command occurs in that time. (Rationale: Chrome throttles timers in pages hidden for more than 5 minutes to about one wake-up per minute, per [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88); no `alarms` permission per decision 7.)
8. IF a Recount fails, THEN THE Activity_Tracker SHALL keep the reply and the saved changes of the job that triggered the Recount exactly as they would be if the Recount had succeeded.

### Requirement 8: Auto-bury - APP

**User Story:** As a user who never remembers to press Bury all, I want an option that moves tabs into the Graveyard group as they die, so that my tab strip stays tidy without any tab being closed for me.

#### Acceptance Criteria

1. THE Popup SHALL show an `Auto-bury dead tabs` checkbox with a visible label and visible focus and disabled states, checked exactly when the last confirmed `graveyard:popup-state` reply has `autoBury` exactly `true`, and SHALL apply its existing one-command-at-a-time rule to the checkbox, disabling it while any command is in flight or while the Popup has no confirmed state.
2. THE Activity_Tracker SHALL store Auto_Bury as one Boolean in `chrome.storage.local` that applies to every non-incognito window, SHALL treat a missing or non-Boolean stored value or a failed read as off, and SHALL include the value as an `autoBury` Boolean in every successful `graveyard:popup-state` reply.
3. WHEN the user changes the `Auto-bury dead tabs` checkbox, THE Popup SHALL send `graveyard:set-auto-bury` with `enabled` set to the checkbox's new checked state, and SHALL refresh its state after an `ok: true` reply whose `autoBury` equals `enabled`.
4. IF `graveyard:set-auto-bury` comes from a sender other than an Extension_Page, lacks a Boolean `enabled`, or saving the value fails, THEN THE Activity_Tracker SHALL reply `{ok: false, error}`, keep the stored Auto_Bury value unchanged, and move no tab.
5. WHILE Auto_Bury is on, WHEN a Recount (Requirement 7 criteria 2, 3, and 7) finds a Buryable_Tab that is not the active tab of its window and has no recorded Auto_Bury attempt, THE Activity_Tracker SHALL, as part of that Recount, move the tab into the Graveyard_Group of the tab's own window, reusing that group when one exists and creating one as in Requirement 2 criterion 3 otherwise, and SHALL leave each Dead_Tab that is in any tab group in that group (decision 12).
6. THE Activity_Tracker SHALL record an Auto_Bury attempt for a tab, whether Auto_Bury is on or off, when Auto_Bury tries to move the tab (whether or not the move succeeds), when `graveyard:bury` moves the tab, and when a Recount finds the tab is both a Dead_Tab and a Graveyard_Tab, and SHALL delete that record only when the tab is Reset or its Tab_Record is deleted, so that a tab the user moved out of a Graveyard_Group stays out until the tab is Reset and dies again.
7. WHEN `graveyard:set-auto-bury` changes Auto_Bury from off to on, THE Activity_Tracker SHALL apply criterion 5 to every Buryable_Tab at that moment, after the save succeeds and before replying.
8. WHILE Auto_Bury is off or `rules.json` cannot be read, THE Activity_Tracker SHALL move tabs into a Graveyard_Group only while handling `graveyard:bury`.
9. WHEN Auto_Bury moves a tab, THE Activity_Tracker SHALL keep the tab open and in its own window, keep its Tab_Record's Registers unchanged, and save no Buried_Entry.
10. IF a Chrome call fails while Auto_Bury moves a tab or creates or updates a Graveyard_Group, THEN THE Activity_Tracker SHALL leave each affected tab where the failed call left it, keep its Auto_Bury attempt recorded so that no later Recount retries it before its next Reset, log one diagnostic per affected tab, and continue with the remaining tabs.
11. WHEN handling a `graveyard:set-auto-bury` message from an Extension_Page with a Boolean `enabled`, THE Activity_Tracker SHALL save `enabled` as Auto_Bury, move no tab out of any tab group, and, after the save succeeds, reply `{ok: true, autoBury}` with `autoBury` equal to the saved value, whatever the outcome of the moves in criterion 7.
12. IF a `graveyard:set-auto-bury` reply is missing, is not `ok: true`, or has an `autoBury` other than the `enabled` value the Popup sent, THEN THE Popup SHALL return the checkbox to the last confirmed Auto_Bury value and show `Could not change auto-bury. Try again.`
13. WHEN Auto_Bury has moved tabs into a Graveyard_Group, THE Activity_Tracker SHALL leave the group titled `Graveyard`, coloured `grey`, and collapsed, except that it SHALL leave the collapsed state unchanged when the group holds its window's active tab, so that Auto_Bury never changes which tab is active in a window.

### Requirement 9: Stored data and privacy - APP

**User Story:** As a user, I want the new features to keep only what they need, so that grouping and counting tabs does not record my browsing.

#### Acceptance Criteria

1. THE Activity_Tracker SHALL store open-tab and group data (Tab_Records, window entries, Graveyard_Group records, exemption state, and Auto_Bury attempts) only in `chrome.storage.session`.
2. THE Activity_Tracker SHALL store in `chrome.storage.local` only Demo_Mode, Auto_Bury, and the Buried_List, and SHALL add Buried_Entries to the Buried_List only while handling `graveyard:empty`.
3. THE Activity_Tracker SHALL read from a `Tab` object (including `sender.tab`, `tabs.get` and `tabs.query` results, and the `tab` argument of `tabs.onUpdated`) or from `tabs.onUpdated` change information only `id`, `windowId`, `active`, `incognito`, `pinned`, `audible`, and `groupId`, and no other property such as `url`, `pendingUrl`, `title`, or `favIconUrl`.
4. THE Activity_Tracker SHALL read the `title` of a tab group object received from `tabGroups.get`, `tabGroups.update`, `tabGroups.onUpdated`, or `tabGroups.onRemoved` only when, at the time of the read, the group's id is the recorded Graveyard_Group id for its window, and SHALL write no tab group title to `chrome.storage.session` or `chrome.storage.local`.
5. THE Popup SHALL read only the `id` of the active tab from the Tabs API, as in the Prior_Spec. (Requirement 1 criterion 10 lists the tab-group, grouping, and `action` APIs that the Popup does not call.)
6. THE Activity_Tracker, the Runtime_Controller, and the Popup SHALL prefix every diagnostic with `[poltergeist:graveyard]` and SHALL exclude from diagnostics page titles, URLs (including any URL inside a Chrome error message), tab group titles, and the contents of Tab_Records, Buried_Entries, and Graveyard_Group records.
7. THE Activity_Tracker SHALL take page titles only from the payload of content-script messages and page URLs only from `MessageSender.url`.
8. THE Runtime_Controller SHALL include in its messages to the Activity_Tracker only the message type, the page title, the meter's Held_Absence, and the Profile_Epoch, as in Prior_Spec Requirement 8 criterion 4, including in any message added for Requirements 6 and 7.
9. WHEN `tabs.onRemoved` or `tabs.onReplaced` fires, THE Activity_Tracker SHALL, once it has handled the event, keep no exemption state or Auto_Bury attempt in `chrome.storage.session` for the removed tab id.

### Requirement 10: Prior spec documents - DOCS

**User Story:** As a maintainer, I want the tab-graveyard-app spec to state the new rules and why the permission changed, so that the spec and the code agree.

#### Acceptance Criteria

1. THE Prior_Spec `requirements.md` SHALL replace the text of each item below, in its current position, with text that states the same rule as the graveyard-groups criteria named for it, and SHALL name graveyard-groups as the source of each term that the Prior_Spec Glossary does not define:
   - Requirement 1 criterion 3: Requirement 1 criteria 1 and 4.
   - Requirement 1 criterion 6: Requirement 1 criterion 6 and Requirement 9 criterion 3, keeping the rule that the `url`, `pendingUrl`, `title`, and `favIconUrl` properties of a `Tab` object are never read.
   - Requirement 7 criterion 7: Requirement 3 criteria 2 and 3.
   - Requirement 7 criterion 8: Requirement 4 criteria 5 and 6.
   - Requirement 7 criterion 9: Requirement 4 criterion 9.
   - Requirement 7 criterion 15: Requirement 11 criteria 8 and 9, keeping the `(BROWSER-VERIFIED)` prefix.
   - Requirement 7 criterion 17: Requirement 3 criteria 10 and 11 and Requirement 4 criteria 13 and 14.
   - Requirement 8 criterion 1: Requirement 9 criterion 1.
   - Requirement 8 criterion 2: Requirement 9 criterion 2.
   - Requirement 10 criterion 4: Requirement 11 criteria 1 to 3, so that the listed worker tests name `Empty graveyard` save-before-close and closing only on `graveyard:empty` in place of Bury save-before-close and closing only on `graveyard:bury`.
   - Glossary entry Dead_Tab: the graveyard-groups Glossary entry for Dead_Tab.
   - Glossary entry Bury: Requirement 3, defining Bury as the `Bury all` action that moves the listed Dead_Tabs, which are in no tab group, into their windows' Graveyard_Groups and closes no tab.
   - Glossary entry Buried_Entry: Requirement 4 criterion 5, defining a Buried_Entry as the saved record of a tab closed by `Empty graveyard`.
2. THE Prior_Spec `requirements.md` SHALL add one paragraph beginning `Note (graveyard-groups):` directly after each item below, without changing that item's text. Each note SHALL state the content given below and the graveyard-groups requirement and criterion numbers shown:
   - After the "Out of scope" paragraph of the Introduction: tab grouping is now in scope through graveyard-groups, and Bury moves tabs into a Graveyard_Group while `Empty graveyard` saves and closes them (Requirements 3 and 4).
   - After each of Requirement 5 criteria 2, 4, 5, and 10: an Exempt_Tab starts no Absence and its page reports are ignored (Requirement 6 criteria 3 and 12).
   - After Requirement 6 criterion 3: a `graveyard:content-state` reply with `exempt` true starts no Poltergeist instance, and `graveyard:refresh` stops or starts the instance (Requirement 6 criteria 7 and 9).
   - After Requirement 7 criterion 1: the Dead_Tab list shows only Dead_Tabs that are in no tab group, leaving out Graveyard_Tabs and tabs in the user's own groups, and the popup adds the `Empty graveyard` button and the `Auto-bury dead tabs` checkbox (Requirement 3 criteria 1 and 13, Requirement 4 criterion 2, Requirement 8 criterion 1).
   - After Requirement 6 criterion 8 and after Requirement 7 criterion 5: Resurrect removes a Graveyard_Tab from its Graveyard_Group (Requirement 5 criterion 1).
3. THE Prior_Spec `design.md` SHALL add one paragraph beginning `Note (graveyard-groups):` in each place below:
   - At the end of the "Permission justification" section: the Manifest now declares `storage` and `tabGroups`, with the `tabGroups` reason of Requirement 1 criterion 5.
   - Directly after Property 3 and its "Validates" line: `graveyard:empty` is now the only message that closes tabs, `graveyard:bury` closes no tab, and the property's test is named "Property 3: Nothing closes without Empty graveyard" (Requirement 11 criterion 1).
   - Directly after the "Bury" subsection of the Activity_Tracker section: the save-before-close flow described there now handles `graveyard:empty` on the selected Closable_Tabs without needing the rules (Requirement 4 criteria 4 to 11), and `graveyard:bury` moves tabs and replies `{ok: true, moved, notMoved}` (Requirement 3 criteria 3 to 6).
4. THE Prior_Spec documents SHALL keep every requirement number, criterion number, Glossary term, and Property number, and SHALL remove, merge, or renumber none of them, so that references from haunt-polish and haunt-kit stay valid. Notes and reasons added under this requirement SHALL be unnumbered paragraphs.
5. THE Prior_Spec `requirements.md` SHALL end each text replaced under criterion 1 with the marker `(amended by graveyard-groups)`, and SHALL add directly after it one paragraph of one or two sentences, beginning `Reason (graveyard-groups):`, that states why the rule changed.
6. THE Prior_Spec documents SHALL change no text other than the replacements, reasons, and notes listed in criteria 1, 2, 3, and 5. They SHALL keep every `(amended by haunt-polish)` text and every `Reason (haunt-polish):` and `Note (haunt-polish):` paragraph unchanged, and SHALL leave the Prior_Spec `tasks.md` unchanged.

### Requirement 11: Verification - TEST

**User Story:** As a maintainer, I want unit and real-browser evidence for grouping, emptying, exemptions, and the badge, so that a regression that closes or loses a tab is caught.

#### Acceptance Criteria

1. THE Unit_Suite SHALL add no property-based test. It SHALL rename the existing fast-check `describe` block "Property 3: Nothing closes without Bury" in `background.test.js`, and its header comment, to "Property 3: Nothing closes without Empty graveyard". It SHALL change the block only so that `graveyard:empty` from an Extension_Page is the one message allowed to close tabs: the first property SHALL add popup `graveyard:bury`, content-script `graveyard:empty`, and `graveyard:set-auto-bury` to its generated actions and still assert that `tabs.remove` is never called; the second property SHALL send `graveyard:empty` instead of `graveyard:bury`, generate tabs that vary in being requested, open, Graveyard_Tabs, and Exempt_Tabs, and assert that exactly the requested tabs that are Closable_Tabs at the time of the call close, each after a saved Buried_List holds its URL; each property SHALL keep 100 runs.
2. THE Unit_Suite SHALL update the existing `bury` tests in `background.test.js` so that no test expects `graveyard:bury` to close a tab or save a Buried_Entry, and SHALL contain at least one example-based test for each case below:
   - Bury: moving into a new Graveyard_Group and into the window's existing one, with tabs from two windows each going to their own window's group; title `Graveyard`, colour `grey`, and collapsed state true, including a reused group the user had recoloured or expanded (Requirement 3 criterion 4); skipping requested tabs that are not Dead_Tabs or are already Graveyard_Tabs; no closing, unchanged Registers, and no Buried_Entry; `notMoved` on a failed `tabs.group` call, and `moved` for tabs already in a reused Graveyard_Group when `tabGroups.update` fails (Requirement 3 criterion 7); the `graveyard:popup-state` dead-tab list holding exactly the Buryable_Tabs (Requirement 3 criterion 13).
   - User groups (decision 12): a Dead_Tab in a user-made group is not listed in `graveyard:popup-state`, is not moved by `graveyard:bury` and appears in neither `moved` nor `notMoved`, is not moved by Auto_Bury, and keeps its group's title, colour, and collapsed state unchanged; a user-made group titled `Graveyard` is left unchanged and never used as a Graveyard_Group.
   - Group identity: Release on rename, and no Release during creation or on a colour or collapsed-state change; a failed `tabGroups.get` during the title check keeping the record (Requirement 2 criterion 12); a failed group creation deleting the record and listing that window's qualifying tabs in `notMoved` (Requirement 2 criterion 13); record deletion on `tabGroups.onRemoved` and `windows.onRemoved`; a new Graveyard_Group when the recorded one no longer exists.
   - Empty graveyard: save-before-close; selection of only the requested ids that are still Closable_Tabs (skipping Exempt_Tabs, tabs with no saved URL, and tabs no longer in a Graveyard_Group); save failure; `tabs.remove` failure; exactly 200 tabs closed when 201 Closable_Tabs are requested; sender and payload checks.
   - Resurrect: ungrouping from both paths; a user group left alone; a failed ungroup.
   - Exemption: Reset on becoming pinned and on becoming audible; Registers held at 0; ignored page reports; the `exempt` reply field; `graveyard:refresh` sent on entry and exit; a fresh Absence on exit for a tab that is not active.
   - Badge: the text after one Recount trigger of each kind listed in Requirement 7 criterion 2, counting Dead_Tabs that are Graveyard_Tabs or are in a user-made group; the empty string at 0 Dead_Tabs and when `rules.json` cannot be read.
   - Auto_Bury: default off; once per death, with a `graveyard:bury` move counting as the attempt; the active-tab skip; no move while off; turning on; the collapsed state left unchanged when the group holds its window's active tab (Requirement 8 criterion 13).
3. THE Unit_Suite source-scan test in `background.test.js`, renamed "closes tabs only from the Empty graveyard handler (source scan)", SHALL assert that `background.js` with comments removed contains exactly one `tabs.remove` occurrence, located inside the function that handles `graveyard:empty`, and SHALL keep its existing check that every other `.remove(` call is on session storage.
4. THE Unit_Suite privacy tests SHALL fail when the Activity_Tracker reads `url`, `pendingUrl`, `title`, or `favIconUrl` from a Tab object it receives from `sender.tab`, `tabs.get`, `tabs.query`, or a `tabs` event, or from `tabs.onUpdated` change information; reads the title of a tab group that is not a recorded Graveyard_Group from `tabGroups.get` or `tabGroups.onUpdated`; or writes any tab group title to storage or to a diagnostic.
5. THE Unit_Suite SHALL cover in `popup.test.js`: the `Bury all` flow with `moved` and `notMoved`, including the warning for N of 1 and of 2 and the rollback on an `ok: true` reply that lacks either array; the `Empty graveyard (M)` button hidden at M of 0 and shown with the count at M of 1 or more, the ids it sends, its disabled state while any command is in flight, its warnings for N of 1 and of 2, and its rollback; the `Auto-bury dead tabs` checkbox checked from the `graveyard:popup-state` reply, the `graveyard:set-auto-bury` message it sends, and its rollback with the error text; the text `No dead tabs outside tab groups.`; and, for Requirement 3 criterion 14, the demo-scaled current-tab and dead-row text with the ` (demo time)` suffix when `demoMode` is true and the unchanged text with no suffix when `demoMode` is false. It SHALL cover in `content.test.js`: an `exempt: true` reply starting no Poltergeist instance, `graveyard:refresh` stopping a running instance when the new reply has `exempt` true, and `graveyard:refresh` starting an instance when the new reply has `exempt` false for a dead tab.
6. THE Unit_Suite SHALL expect `["storage", "tabGroups"]` as the committed Manifest's `permissions` in `package.test.js`, SHALL expect the error of Requirement 1 criterion 3 wherever `package.test.js` and `sync.test.js` now expect the `["storage"]` error, SHALL add Graveyard_Validator cases for a missing `tabGroups`, an added `alarms`, a duplicated `tabGroups`, and the order `["tabGroups", "storage"]`, each reporting that error and no other error, and SHALL keep the read-only `check:graveyard` failure on an added `tabs` permission, which leaves every file unchanged.
7. THE Browser_Suite comment in `discard-reload.pw.js` that states the manifest permissions SHALL state `["storage", "tabGroups"]`; every other comment in the Unit_Suite and Browser_Suite that states the Manifest's `permissions` value SHALL state `["storage", "tabGroups"]`; and every test comment that describes `Bury all` SHALL describe it as moving tabs into the Graveyard_Group without closing them.
8. (BROWSER-VERIFIED) WHEN, in Demo_Mode, tabs A and B in one window have each been away for at least 26 seconds while tab C of that window is in front, and the user clicks `Bury all (2)` in the Popup, opened as a foreground tab, with a real Playwright click, THE `bury-reopen.pw.js` test "Bury all moves without closing", which replaces the existing test "Bury all closes exactly the dead tabs, and Reopen restores one at its saved URL", SHALL find within 10 seconds: A and B open with the same group id, which is the Graveyard_Group id recorded for the window; that group titled `Graveyard`, coloured `grey`, and collapsed; C and the Popup tab outside every tab group; the number of open tabs equal to the number just before the click; the Buried_List empty; and the Popup showing `Bury all (0)` disabled and `Empty graveyard (2)`.
9. (BROWSER-VERIFIED) WHEN, after repeating the steps of criterion 8, A and B are in the Graveyard_Group, C is outside every tab group, and the user clicks `Empty graveyard (2)` with a real Playwright click, THE `bury-reopen.pw.js` test "Empty graveyard closes and saves" SHALL find within 10 seconds A and B closed, C open, exactly two Buried_Entries whose URLs are A's and B's, and the `Empty graveyard` button hidden, and, after a real Playwright click on `Reopen` for A, SHALL find within 10 seconds a new tab open at A's URL and only B's Buried_Entry left. (The save-before-close order is verified in the Unit_Suite, criterion 2.)
10. (BROWSER-VERIFIED) WHEN, in Demo_Mode, tab A has been away for at least 26 seconds, has been moved into a Graveyard_Group with `Bury all`, and has then been activated so that its page shows the Tombstone, and the user clicks the Tombstone's `Resurrect` button with a trusted (real Playwright) click, THE Browser_Suite test "Resurrect ungroups" SHALL confirm immediately before the click that A's group id is the Graveyard_Group id recorded for A's window, and SHALL find within 5 seconds after the click A open in its window, A outside every tab group, no Poltergeist artifact on A's page, and both of A's Registers at 0.
11. (BROWSER-VERIFIED) WHEN, in Demo_Mode, the test has pinned tab A and made tab B audible while each was in front, and A and B have then each been away for at least 26 seconds while tab C is in front, THE Browser_Suite test "Pinned and audible tabs are exempt" SHALL find: an empty Badge, read with `chrome.action.getBadgeText` in the worker; neither A nor B among the Buryable_Tabs or Closable_Tabs in the `graveyard:popup-state` reply; no Absence in progress and both Registers at 0 in A's and B's Tab_Records; and no Poltergeist artifact on A's or B's page at any sample during the 5 seconds after each tab is activated. It SHALL also assert that `chrome.tabs.get` reported `pinned` true for A and `audible` true for B at every sample, with samples at most 2 seconds apart, from the moment each tab left the front until the last assertion.
12. (BROWSER-VERIFIED) WHEN, in Demo_Mode, tab A leaves the front and then tab B leaves the front while tab C stays in front, THE Browser_Suite test "Badge counts dead tabs" SHALL read the Badge as in criterion 11 and find: the empty string at a reading taken after B left and less than 22 seconds after A left; `2` at a reading taken no later than 29 seconds after B left, with no tab switch, popup command, or control message between B leaving and that reading; `1` within 5 seconds after A is resurrected with `graveyard:resurrect-tab` from an Extension_Page; and the empty string within 5 seconds after the test closes B.
13. THE final check SHALL run `npm test`, `npm run build:skeletons`, and `npm run test:browser`, each exiting with status 0 with no test skipped. It SHALL find the same `git status --porcelain` output before and after `npm run build:skeletons`, and SHALL find every Doomscroll and skeleton test file unchanged by this spec.
