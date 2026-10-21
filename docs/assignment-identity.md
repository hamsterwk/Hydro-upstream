# Contest and homework assignments

Users and groups used to share one string key: UID 2501 and group `2501` both
became `2501`. Autocomplete cached them under the same key and reloaded numeric
keys as users. The server also appended a synthetic group named after each UID,
so the same assignment granted access to both the user and the group's members.

New selections are submitted and stored in `assignTyped`, using `user:`, `group:`
and `legacy:` followed by a URI-encoded identifier. Every entry is encoded;
`legacy:user%3A2501` preserves an old group name literally, and `group:user%3A2501`
selects that group explicitly. No characters are reserved in group names. Numeric
names, leading zeros, commas and Unicode survive transport unchanged.

`assignTyped` takes precedence, including an empty array. Missing or null typed
fields fall back to `assign`. Existing numeric assignments retain their historical
meaning (both the UID and members of the same-named group); the editor labels
these as legacy assignments. Removing a legacy entry and explicitly selecting a
user or group resolves its ambiguity. No migration or inferred conversion occurs.

The model normalizes both creation and assignment edits. Legacy API callers may
continue writing `assign`, whose values are always interpreted literally. Typed
callers write `assignTyped`; if both fields are supplied, the typed field wins.
Clearing writes both arrays empty. Unrelated edits leave assignments unchanged.
`assign` retains a decoded compatibility projection; older software cannot enforce
the distinction and reverts to historical ambiguous permissions. Assignment edits
made by older software do not maintain the typed field and require reconciliation
before upgrading again.

Membership keys are computed separately from `User.group`, which continues to
contain ordinary group names. List queries, details, team attendance, related
contests and discussion visibility use the same typed/legacy matching rules.

Extensions calling `DiscussionModel.getListVnodes` should pass
`user.assignmentKeys`. The old `string[]` argument is accepted only as legacy
membership: it cannot match explicit user/group assignments. Compatibility with
legacy stored `assign` data does not imply full compatibility for old plugin calls.

Bulk paste accepts group names and UIDs separated by English or Chinese commas.
It resolves human text separately from stored keys: `user:2501` is a literal group
name, not an instruction to select a user. If a number matches both a group and a
UID, select the intended candidate from the suggestions. A batch with an ambiguous
or missing entry adds nothing, preserves the pasted text and displays an error;
existing selections remain unchanged. Names containing commas can be selected
from the suggestions instead.

Tests:

- `node packages/ui-default/tests/assign-identity.spec.cjs` exercises the
  real React autocomplete with synthetic API results and the form validator.
- `yarn test` also runs Mongo persistence, legacy compatibility and permission
  query regressions through the existing application test runner.
