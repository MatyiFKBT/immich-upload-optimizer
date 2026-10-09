# Immich Web Media Optimizer — Implementation Plan

## Goal

Add a separately deployable, minimal web interface to search an existing Immich instance and compare/apply image optimizations. Use the `@immich/sdk` npm package for Immich API access and the image tools already provided by `Dockerfile.goreleaser`. Preserve the existing upload-proxy behavior and image target.

## Confirmed scope and workflow

- Search still images by date range and/or album; select individual assets.
- Accept JPEG, HEIC, and HEIF source images. Do not process videos or other image source formats in this version.
- Provide these built-in profiles:
  - JPEG → optimized JPEG using Caesium.
  - JPEG → AVIF using the existing lossy AVIF profile settings.
  - JPEG → lossy JXL using the existing lossy JXL profile settings.
  - JPEG → lossless JXL using the existing lossless JXL profile settings.
  - HEIC/HEIF → AVIF or JXL using ImageMagick.
- If multiple profiles are selected, optimize every selected image up front (three concurrently) and then let the user choose one candidate or skip each image independently, with the smallest eligible candidate highlighted.
- If one profile is selected, process the selected assets as a batch, present a result table, and require an explicit batch apply action.
- Only upload a candidate whose byte size is strictly less than the original.
- A batch-level delete-original option defaults off. When enabled, delete an original only after the replacement upload, tag/album assignment, and verification all succeed.
- Upload the replacement first, copy the original asset's tags and album membership, verify the new asset, then (optionally) delete the original. Any uncertain or failed step retains the original.

### Monthly cleanup tab (second tab)

- Year grid of 12 month boxes with per-month capture counts, taken from one `calendar-heatmap?type=Taken` request (requires the `user.read` scope); prev/next year navigation.
- Opening a month loads every asset captured in it (images and videos), newest first, thumbnails only, capped at 3000 assets with a visible truncation notice. The query range is widened by a day on each side because `takenAt` is UTC while the month is derived from the asset's local capture time, then filtered exactly.
- Assets sharing a capture minute (EXIF `localDateTime` truncated to the minute) form a burst group; the largest file in a group is highlighted as the suggested keep. Left click marks keep, right click marks trash, clicking the same mark clears it.
- Each burst group has its own action bar: trash the trash-marked images, compress the keep-marked images (smaller candidate enforced, original deleted only after verification), or archive the keep-marked images. Buttons are disabled when their set is empty, and each action confirms first.
- Ungrouped assets each get three per-asset buttons: compress and delete original, trash, archive.
- A compression-profile selector in the month toolbar chooses the profile used by every compress action in that tab.
- Trash uses `DELETE /assets` with `force: false` (reversible Immich trash), archive uses `PUT /assets` with `visibility: "archive"`.
- The month is rendered as one stream ordered oldest first: assets sharing a capture minute collapse into a burst block, and consecutive singles collapse into ordinary grids, so the month reads from the 1st onwards.
- Library actions are enqueued as jobs and executed one at a time by an in-memory FIFO queue; a compression job waits for the single optimizer slot instead of failing when the Compress tab holds it. Assets with a pending job cannot be queued again, and a still-queued job can be cancelled.
- Compressed replacements are tagged `optimized` (upserted by name via `PUT /tags`, then verified together with the copied tags before any original is deleted). The month listing marks assets that already carry the tag by querying `SearchFilter.tagIds` over the same capture range.
- Every confirmation offers a "don't ask again" checkbox stored per action kind in local storage, with a *Re-enable prompts* control in the month toolbar.
- A prepared run that produced nothing eligible finishes itself instead of holding the single active-run slot, and any prepared run can be discarded (`POST /api/batches/:id/abandon`); the monthly compression flow abandons its own run when it cannot complete.

## Architecture and deployment

- Add a Hono/Node backend-for-frontend that uses `@immich/sdk` server-side. The browser calls only this service; the Immich API key is never returned to browser code.
- Build the UI as a React SPA bundled by Vite; React reconciliation keeps asset thumbnails attached to stable element keys, so polling never re-creates or re-requests them.
- Style the SPA with Tailwind CSS v4 and shadcn/ui; the app is a two-tab shell (Compress, Monthly cleanup) with the shared Immich client in `web/client/src/api.ts`.
- Monthly cleanup writes through narrow endpoints (`/api/library/trash`, `/api/library/archive`) and reuses the compression batch pipeline rather than adding a second write path.
- Pin `@immich/sdk` to `3.3.0-rc.0`, matching `immich-openapi-specs.json`; use its stable nested date/album/type filter and cursor pagination rather than deprecated flat search fields.
- The backend owns temporary downloads and candidate files and invokes only fixed, built-in optimizer profiles. Do not execute user-supplied commands or construct shell command strings from request data.
- Configure the Immich URL and API key using Docker environment variables or secret files. Require a separate web UI password because this service can mutate and delete assets. Document that it must be exposed only on a trusted network or through HTTPS.
- Extend the existing multi-stage Docker build with a web target sharing the current codec/tool runtime. Preserve the existing proxy target and its default behavior.
- Serve the minimal UI and API from the same web service/origin. Add deployment instructions and required environment variables.

## Implementation steps

1. Create this plan and `WEB_OPTIMIZER_PROGRESS.json` with implementation states.
2. Add the Hono web service, server-side SDK client, configuration/secrets loading, authentication, and safe same-origin API routes.
3. Implement Immich album/date search, paginated asset selection, metadata retrieval, and thumbnail access needed by the UI.
4. Implement the fixed optimization profiles, bounded-concurrency processing, candidate size comparison, and temporary-file cleanup.
5. Implement the upload → copy tags/albums → verify → optional delete transaction. Fail closed: never delete the original on an upload, metadata, verification, or communication error.
6. Implement the minimal UI for search, image selection, profile selection, per-image comparison or single-profile batch review, progress, and explicit apply/skip actions.
7. Add the web Docker target and deployment documentation without building the image.
8. Do not run builds, tests, or smoke checks here; the user will validate the web app and container in their environment.
9. Add the monthly library endpoints: per-month capture counts, a full-month asset listing, trash, and archive, all validated and rate-limited per request.
10. Add the two-tab shell and convert both tabs to Tailwind CSS v4 with shadcn/ui components.
11. Add the monthly cleanup flow: year grid, month view with same-minute burst groups, keep/trash marking, per-group and per-asset actions with confirmation, and the compression-profile selector.

## Safety invariants

- A candidate that is the same size or larger than its source cannot be uploaded.
- The original is retained by default and is never deleted before a replacement's existence, copied tags, and album membership are verified through Immich.
- Preserve and verify the linked video asset ID for Live Photos before any optional deletion of the source image.
- Failed or ambiguous replacement operations report their state and leave the original intact.
- Temporary source and candidate data is removed when no longer needed; persistent state, if required for recoverability, must not trigger automatic deletion after restart.
- API keys and passwords are not embedded in static assets, URLs, logs, or client-visible API responses.

## Acceptance criteria

- A user can connect to an existing Immich instance, search by date/album, select supported assets, and see originals and candidate sizes.
- All selected profiles use the established toolchain and their intended conversion settings.
- Multi-profile runs optimize every selected asset up front (three concurrently) and then accept independent per-asset decisions with the smallest candidate highlighted; a single profile supports batch processing and explicit batch application.
- Only smaller candidates are uploaded.
- Replacement tags and album memberships are copied and verified before any optional original deletion.
- The existing proxy image/target remains usable with its previous default behavior.
- The repository contains deployment instructions and a progress JSON that accurately reflects implementation and verification status.
- The monthly tab shows per-month capture counts for a year and loads a selected month as thumbnails only.
- Assets captured in the same minute are grouped, keep/trash marks drive the per-group actions, and ungrouped assets expose compress, trash, and archive per asset.
- Trash uses the non-forced delete so it stays restorable in Immich, and every action is confirmed before it runs.
