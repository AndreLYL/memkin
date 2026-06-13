# Feishu Docs — Probe Fixtures (⚠️ NOT YET CAPTURED)

> **STATUS: PLACEHOLDER — these fixtures have NOT been captured from a real `lark` session.**
>
> Every `// ⚠️ CALIBRATE` marker in the `src/collectors/feishu/docs/` collection
> pipeline depends on the real JSON shapes recorded here. The field names
> currently used in the code (`edit_users[0].open_id`, wiki node `obj_token` /
> `obj_edit_time`, `block_type` 2/3/4/5, `data.node.obj_token`,
> `root_folder/meta.data.token`) are **best-effort from Feishu's public API docs**.
>
> Before running a real `memoark docs sync` in production, an operator with a
> live, authenticated `lark` (lark-cli) session MUST run the six probe commands
> below and paste the redacted JSON into the fenced blocks, then reconcile every
> `// ⚠️ CALIBRATE` marker against the captured shapes.
>
> This file was committed as a placeholder because the implementation environment
> has **no Feishu credentials** — the unit tests assert mapping *logic* (not real
> field names), so they stay green regardless; calibration risk surfaces only at
> real-sync time.

## Endpoints to probe (Task 1)

1. **My Space root meta** — `GET /open-apis/drive/v1/files/root_folder/meta`
   - Record: `data` shape — does it return `{ token, ... }`?
2. **Drive folder listing** — `GET /open-apis/drive/v1/files` (params `folder_token`, `--page-all --format ndjson`)
   - Record: one ndjson file row — confirm `token,name,type,url,owner_id,created_time,modified_time` and whether subfolders appear as `type: "folder"`.
3. **Wiki spaces** — `GET /open-apis/wiki/v2/spaces` (`--page-all --format ndjson`)
   - Record: one space row — confirm `space_id`, `name`.
4. **Wiki space nodes** — `GET /open-apis/wiki/v2/spaces/<SPACE_ID>/nodes` (`--page-all --format ndjson`)
   - Record: one node row — confirm `node_token`, `obj_token`, `obj_type`, `title`, `parent_node_token`, `has_child`, and the timestamp field name (`obj_edit_time`? epoch seconds?).
5. **Wiki get_node** — `GET /open-apis/wiki/v2/spaces/get_node` (params `token`, `obj_type=wiki`)
   - Record: `data.node` shape (`obj_token`, `obj_type`).
6. **Docx blocks** — `GET /open-apis/docx/v1/documents/<DOCX>/blocks` (`--page-all --format ndjson`)
   - Record: one heading block and one text block — confirm `block_type` integer values (Feishu: heading1=3, heading2=4, … text=2) and where the text lives (`<block>.heading1.elements[].text_run.content` vs `<block>.text.elements[].text_run.content`).

## Captured fixtures (FILL THESE IN)

### root_folder_meta
```json
// ⚠️ NOT YET CAPTURED — run probe command 1
```

### drive_file_row
```json
// ⚠️ NOT YET CAPTURED — run probe command 2
```

### wiki_space_row
```json
// ⚠️ NOT YET CAPTURED — run probe command 3
```

### wiki_node_row
```json
// ⚠️ NOT YET CAPTURED — run probe command 4
```

### get_node
```json
// ⚠️ NOT YET CAPTURED — run probe command 5
```

### docx_block_heading
```json
// ⚠️ NOT YET CAPTURED — run probe command 6
```

### docx_block_text
```json
// ⚠️ NOT YET CAPTURED — run probe command 6
```
