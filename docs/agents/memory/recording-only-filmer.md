---
name: recording-only-filmer
description: "Nov 1 2026: a recording that's uploading, queued, processing or failed shows and notifies only the cook who filmed it"
metadata:
  type: project
---

On 2026-11-01 Caleb set this for the 1.1 app: "The default and the uploading video should only appear in the person who filmed it in their account. For example, if Mom is cooking something, records it, sends it in, video is processing, it should only notify her. It should not notify Dad, Grandma."

**Why:** a recording in progress is the cook's own business until there's a recipe to share.

**How to apply:**
- Screens read `jobs.mine`, never `jobs.forFamily`, which stays only for 1.0's build 6.
- Everyone else sees nothing until the recipe is published. Don't add a push for a job's upload, processing or failure to anyone but the cook.
- `jobs.cancel` is unchanged: stopping a job still works across the family where it can still happen.
- Until build 6 is retired this rule holds only in the app's screens: `recipes.list` and `jobs.forFamily` still let any session in the family read. Once build 6 is retired, remove `forFamily` and limit `jobs.cancel` and `jobs.cancelUpload` to the filmer (Convex & accounts).
