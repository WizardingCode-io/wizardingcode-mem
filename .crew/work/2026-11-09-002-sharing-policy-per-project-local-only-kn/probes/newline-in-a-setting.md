# Probe: a setting value with a newline writes a sharing line into the env file

Asked by the security reviewer in round one (F-1, a defect, reasoned and not run): a caller holding the viewer token sends `PUT /api/settings` with no `confirm` and a non-sharing value that holds a newline; the sharing guard looks only at the keys of the validated changes, so it does not fire, and `writeEnvFile` writes the value raw, so the file ends with a wider roots line. The reviewer's example used `WIZARDINGCODE_MEM_AUTHOR`.

Run on 2026-11-09 against the code under review, in a temporary data directory, through the two functions the route calls in that order (`validatePatch`, then `saveSettings`), with the value `x\nWIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared` under three keys.

```
WIZARDINGCODE_MEM_AUTHOR
validatePatch errors: {"WIZARDINGCODE_MEM_AUTHOR":"a name of 1 to 80 characters, on one line"}
validatePatch changes: undefined

TYPESAFE_API_KEY
validatePatch errors: null
validatePatch changes: {"TYPESAFE_API_KEY":"x\nWIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared"}
env file now:
  | TYPESAFE_API_KEY=x
  | WIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared
roots in force after the save: ["shared","workspace"]

WIZARDINGCODE_MEM_BACKUP_S3_REGION
validatePatch errors: null
validatePatch changes: {"WIZARDINGCODE_MEM_BACKUP_S3_REGION":"x\nWIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared"}
env file now:
  | WIZARDINGCODE_MEM_BACKUP_S3_REGION=x
  | WIZARDINGCODE_MEM_SHARE_ROOTS=workspace,shared
roots in force after the save: ["shared","workspace"]
```

What it shows:

- The author key refuses a newline (its rule says "on one line"), so the reviewer's own example does not go through.
- The API key and the S3 region accept it, the file gains a roots line naming both roots, and the policy then has both roots in force, with no confirmation and no `sharing_changes` row of source `viewer`. The defect holds through those keys, and through any other key whose rule does not refuse a newline.

What it does not show: the route itself (the probe calls the two functions the route calls, in its order, with the token and Host checks already passed); a `\r` alone, which `readEnvFile` may or may not read as a line end.

The way out is the one the reviewer named, at the one place every value enters: `validatePatch` refuses a `\r` or `\n` in any value, with one message.
