---
name: raw-footage-14-days
description: "Nov 2: raw videos in the uploads bucket go 14 days after upload, with S3's 28-day undo copy (fully gone at about 42 days)"
metadata:
  type: project
---

Nov 2, 2026 (Caleb, asked twice, answered "keep it as built"): a cook's raw uploaded videos are deleted 14 days after upload,
the same rule as live GCS today, as the `raw-footage-14-days` lifecycle rule on S3 `uploads` (`infra/modules/env/storage.tf`).
S3 keeps the deleted version 28 more days as an undo window, so the bytes are fully gone about 42 days after upload. The
finished recipe and its video in `media` aren't touched. A deleted account's videos don't wait for the 14 days: the purge
takes them at once (after the sweep's 7-hour wait), and the undo copy keeps them inside `/privacy`'s 30 days.

**Why:** footage nobody can film again keeps its undo window against a mistaken delete. Keeping raw videos longer, to remake a
recipe with a better model, was offered and turned down.

**How to apply:** don't change the uploads lifecycle rules without asking Caleb. When `/privacy` is rewritten to name AWS, it
must describe this accurately (raw videos gone at 14 days, the undo copy 28 more). A job re-run after 14 days fails at the
upload listing, by design.

Related: [[aws-migration]]
