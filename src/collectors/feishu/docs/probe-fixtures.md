# Feishu Docs — Probe Fixtures (⚠️ PARTIAL — blocked on OAuth scopes)

> **STATUS (2026-06-14): PARTIALLY CALIBRATED.** A real `lark` (lark-cli) session was
> available, but the user-auth app is **missing the drive/wiki/docx read scopes**, so
> only the root-folder endpoint could be probed. The rest return Feishu error
> `99991679` (permission_violations). See "Blocked — required OAuth scopes" below.
>
> Every `// ⚠️ CALIBRATE` marker in `src/collectors/feishu/docs/` still depends on the
> real JSON shapes here. One marker (root-folder endpoint) is now CALIBRATED; the
> rest remain best-effort from Feishu's public API docs until the scopes are granted
> and probes 2-6 are run.

## Blocked — required OAuth scopes (grant these to the lark-cli app, then re-authorize)

Probes 2-6 fail with `code: 99991679` until the user-auth application is granted:

- **Drive**: `drive:drive` (or `drive:drive:readonly`), `space:document:retrieve`
- **Wiki**: `wiki:wiki` (or `wiki:wiki:readonly`), `wiki:space:retrieve`
- **Docx**: (expected) `docx:document:readonly` / `space:document:retrieve` — confirm when probing blocks

After granting in the Feishu Open Platform console and re-running `lark` OAuth, re-run
probes 2-6 below and reconcile the remaining `⚠️ CALIBRATE` markers.

## Endpoints to probe

1. **My Space root meta** — `GET /open-apis/drive/explorer/v2/root_folder/meta` ✅ CALIBRATED
   - NOTE: the `drive/v1/files/root_folder/meta` path used in the original plan returns **HTTP 404**. The working endpoint is the **explorer v2** path. Root token is at `data.token`.
2. **Drive folder listing** — `GET /open-apis/drive/v1/files` (params `folder_token`, `--page-all --format ndjson`) ❌ BLOCKED (drive scope)
3. **Wiki spaces** — `GET /open-apis/wiki/v2/spaces` (`--page-all --format ndjson`) ❌ BLOCKED (wiki scope)
4. **Wiki space nodes** — `GET /open-apis/wiki/v2/spaces/<SPACE_ID>/nodes` ❌ BLOCKED (wiki scope)
5. **Wiki get_node** — `GET /open-apis/wiki/v2/spaces/get_node` (params `token`, `obj_type=wiki`) ❌ BLOCKED (wiki scope)
6. **Docx blocks** — `GET /open-apis/docx/v1/documents/<DOCX>/blocks` (`--page-all --format ndjson`) ❌ BLOCKED (docx scope)

## Captured fixtures

### root_folder_meta ✅ CALIBRATED 2026-06-14
```json
{
  "code": 0,
  "data": {
    "id": "<redacted>",
    "token": "<redacted-root-folder-token>",
    "user_id": "<redacted>"
  },
  "msg": "success"
}
```
→ Reconciled in `walkers.ts#getMySpaceRoot` (endpoint = explorer/v2, token at `data.token`).

### drive_file_row ❌ BLOCKED
```json
// requires drive:drive scope — code 99991679 until granted
```

### wiki_space_row ❌ BLOCKED
```json
// requires wiki:wiki scope — code 99991679 until granted
```

### wiki_node_row ❌ BLOCKED
```json
// requires wiki:wiki scope — code 99991679 until granted
```

### get_node ❌ BLOCKED
```json
// requires wiki:wiki scope — code 99991679 until granted
```

### docx_block_heading ❌ BLOCKED
```json
// requires docx scope — probe after scopes granted
```

### docx_block_text ❌ BLOCKED
```json
// requires docx scope — probe after scopes granted
```
