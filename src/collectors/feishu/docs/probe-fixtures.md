# Feishu Docs — Probe Fixtures

> **STATUS: CALIBRATED 2026-06-14 — all probes captured; field mappings reconciled.**
> A real `lark` (lark-cli) session was used after granting the drive/wiki/docx read
> scopes via `lark auth login --scope`. Every probe below was captured live and the
> corresponding `⚠️ CALIBRATE` markers in `src/collectors/feishu/docs/` have been
> reconciled against these real (redacted) shapes.

## Endpoints probed

1. **My Space root meta** — `GET /open-apis/drive/explorer/v2/root_folder/meta` ✅ CALIBRATED
   - NOTE: the `drive/v1/files/root_folder/meta` path used in the original plan returns **HTTP 404**. The working endpoint is the **explorer v2** path. Root token is at `data.token`.
2. **Drive folder listing** — `GET /open-apis/drive/v1/files` (params `folder_token`, `--page-all --format ndjson`) ✅ CALIBRATED
3. **Wiki spaces** — `GET /open-apis/wiki/v2/spaces` (`--page-all --format ndjson`) ✅ CALIBRATED
4. **Wiki space nodes** — `GET /open-apis/wiki/v2/spaces/<SPACE_ID>/nodes` ✅ CALIBRATED
5. **Docx blocks** — `GET /open-apis/docx/v1/documents/<DOCX>/blocks` (`--page-all --format ndjson`) ✅ CALIBRATED
6. **Doc meta (batch)** — `POST /open-apis/drive/v1/metas/batch_query` ✅ CALIBRATED

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

### drive_file_row ✅ CALIBRATED 2026-06-14
```json
{
  "token": "...",
  "name": "...",
  "type": "folder|docx|bitable|file",
  "url": "https://my.feishu.cn/docx/...",
  "owner_id": "ou_...",
  "created_time": "1780328431",
  "modified_time": "1780328627",
  "parent_token": "..."
}
```
→ **No `edit_users` field**: the list API does not return the last editor. Reconciled in
`candidate.ts#driveFileToCandidate` (`last_editor_id` falls back to `owner_id`) and
`walkers.ts#walkDriveFolder` (`type` values folder/docx/bitable/file).

### wiki_space_row ✅ CALIBRATED 2026-06-14
```json
{
  "space_id": "...",
  "name": "...",
  "description": "...",
  "space_type": "...",
  "visibility": "...",
  "open_sharing": "..."
}
```
→ `space_id`/`name` already correct in `walkers.ts#walkWiki`; no mapping change needed.

### wiki_node_row ✅ CALIBRATED 2026-06-14
```json
{
  "node_token": "...",
  "obj_token": "...",
  "obj_type": "docx",
  "title": "...",
  "obj_create_time": "1774882737",
  "obj_edit_time": "1774882737",
  "owner": "ou_...",
  "creator": "ou_...",
  "has_child": false,
  "parent_node_token": "",
  "space_id": "...",
  "url": "https://my.feishu.cn/wiki/<node_token>"
}
```
→ The last-editor field is **`owner`** (NOT `owner_id`), and a real `url` exists.
Reconciled in `candidate.ts` (`FeishuWikiNode.owner`/`url`, `wikiNodeToCandidate`).

### docx_block (heading + text + ordered) ✅ CALIBRATED 2026-06-14
```json
[
  { "block_type": 1, "page": { "elements": [{ "text_run": { "content": "..." } }] } },
  { "block_type": 3, "heading1": { "elements": [{ "text_run": { "content": "..." } }] } },
  { "block_type": 2, "text": { "elements": [{ "text_run": { "content": "..." } }] } },
  { "block_type": 13, "ordered": { "elements": [{ "text_run": { "content": "..." } }] } },
  { "block_type": 22, "divider": {} }
]
```
→ Text path confirmed: `block[<typeKey>].elements[].text_run.content`. Live `block_type`
integers seen: `1`=page, `2`=text, `3`=heading1, `13`=ordered, `22`=divider (no text).
Standard Feishu values (well-established, not directly seen): `4`=heading2, `5`=heading3,
`12`=bullet, `14`=code, `15`=quote, `17`=todo. Reconciled in `blocks.ts#BLOCK_MAP` so all
text-bearing types contribute to raw text + body hash.

### doc_meta (batch_query) ✅ CALIBRATED 2026-06-14
`POST /open-apis/drive/v1/metas/batch_query`, body `{"request_docs":[{"doc_token":"...","doc_type":"docx"}]}`:
```json
{
  "code": 0,
  "data": {
    "metas": [
      {
        "title": "...",
        "owner_id": "ou_...",
        "create_time": "1780238336",
        "latest_modify_time": "1780289097",
        "latest_modify_user": "ou_...",
        "url": "",
        "doc_token": "...",
        "doc_type": "docx"
      }
    ]
  }
}
```
→ `url` is an **empty string `""`** (not undefined), so the fallback must use `||`, not `??`.
`latest_modify_user` IS returned (a real last-editor, unlike the file list). Reconciled in
`ingest.ts#fetchDocMeta`.
