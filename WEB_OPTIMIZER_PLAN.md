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

## Architecture and deployment

- Add a Hono/Node backend-for-frontend that uses `@immich/sdk` server-side. The browser calls only this service; the Immich API key is never returned to browser code.
- Build the UI as a React SPA bundled by Vite; React reconciliation keeps asset thumbnails attached to stable element keys, so polling never re-creates or re-requests them.
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
