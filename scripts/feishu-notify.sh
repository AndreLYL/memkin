#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Feishu Webhook Notification — Git push & PR events
# Sends Interactive Message Cards to a Feishu group chat.
# ============================================================

# --- Guard ---
if [ -z "${FEISHU_WEBHOOK_URL:-}" ]; then
  echo "::warning::FEISHU_WEBHOOK_URL not set, skipping notification"
  exit 0
fi

# --- Helpers ---

truncate_str() {
  local str="$1" max="${2:-200}"
  if [ "${#str}" -gt "$max" ]; then
    echo "${str:0:$max}..."
  else
    echo "$str"
  fi
}

escape_json() {
  local str="$1"
  str="${str//\\/\\\\}"
  str="${str//\"/\\\"}"
  str="${str//$'\n'/\\n}"
  str="${str//$'\r'/}"
  str="${str//$'\t'/\\t}"
  echo "$str"
}

send_card() {
  local payload="$1"

  if [ "${DRY_RUN:-}" = "1" ]; then
    echo "=== DRY RUN — Feishu Card Payload ==="
    echo "$payload" | jq . 2>/dev/null || echo "$payload"
    return 0
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "$FEISHU_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" != "200" ]; then
    echo "::warning::Feishu webhook returned HTTP $http_code"
    echo "$body"
  else
    echo "Feishu notification sent successfully"
  fi
}

# --- Card Builders ---

build_push_card() {
  local branch="${REF#refs/heads/}"

  # Skip tag pushes
  if [[ "$REF" == refs/tags/* ]]; then
    echo "Tag push detected, skipping"
    exit 0
  fi

  local commit_count=0
  if [ -n "${COMMITS_JSON:-}" ] && [ "$COMMITS_JSON" != "null" ]; then
    commit_count=$(echo "$COMMITS_JSON" | jq 'length' 2>/dev/null || echo 0)
  fi

  # New branch with no commits
  if [ "$commit_count" -eq 0 ]; then
    local title
    title=$(escape_json "📌 ${REPO_NAME}: 新分支 ${branch}")
    local payload
    payload=$(cat <<ENDJSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "${title}"},
      "template": "turquoise"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**创建者**: ${PUSHER_NAME:-${ACTOR:-unknown}}"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**分支**: \`${branch}\`"}},
      {"tag": "hr"},
      {"tag": "action", "actions": [
        {"tag": "button", "text": {"tag": "plain_text", "content": "查看仓库"}, "url": "https://github.com/${REPO_NAME}/tree/${branch}", "type": "primary"}
      ]}
    ]
  }
}
ENDJSON
)
    send_card "$payload"
    return
  fi

  # Normal push with commits
  local force_label=""
  if [ "${FORCED:-}" = "true" ]; then
    force_label="⚠️ Force Push | "
  fi

  local title
  title=$(escape_json "${force_label}${REPO_NAME}: ${commit_count} commit(s) → ${branch}")
  title=$(truncate_str "$title" 60)

  # Build commit list (max 5)
  local commit_lines=""
  local show_count=5
  if [ "$commit_count" -lt "$show_count" ]; then
    show_count="$commit_count"
  fi

  for i in $(seq 0 $((show_count - 1))); do
    local sha msg
    sha=$(echo "$COMMITS_JSON" | jq -r ".[$i].id[:7]")
    msg=$(echo "$COMMITS_JSON" | jq -r ".[$i].message" | head -1)
    msg=$(truncate_str "$msg" 80)
    msg=$(escape_json "$msg")
    commit_lines="${commit_lines}\\n- \`${sha}\` ${msg}"
  done

  local remaining=$((commit_count - show_count))
  if [ "$remaining" -gt 0 ]; then
    commit_lines="${commit_lines}\\n- ... 还有 ${remaining} 条提交"
  fi

  local payload
  payload=$(cat <<ENDJSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "${title}"},
      "template": "orange"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**推送者**: ${PUSHER_NAME:-${ACTOR:-unknown}}"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**分支**: \`${branch}\`"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**提交记录**:${commit_lines}"}},
      {"tag": "hr"},
      {"tag": "action", "actions": [
        {"tag": "button", "text": {"tag": "plain_text", "content": "查看变更"}, "url": "${COMPARE_URL}", "type": "primary"}
      ]}
    ]
  }
}
ENDJSON
)
  send_card "$payload"
}

build_pr_opened_card() {
  local draft_label=""
  if [ "${PR_DRAFT:-}" = "true" ]; then
    draft_label="[Draft] "
  fi

  local action_label="新建"
  if [ "${EVENT_ACTION:-}" = "reopened" ]; then
    action_label="重新打开"
  fi

  local title
  title=$(escape_json "${draft_label}${action_label} PR #${PR_NUMBER}: ${PR_TITLE}")
  title=$(truncate_str "$title" 60)

  local body="${PR_BODY:-无描述}"
  body=$(truncate_str "$body" 200)
  body=$(escape_json "$body")

  local pr_head_escaped pr_base_escaped pr_author_escaped
  pr_head_escaped=$(escape_json "${PR_HEAD}")
  pr_base_escaped=$(escape_json "${PR_BASE}")
  pr_author_escaped=$(escape_json "${PR_AUTHOR}")

  local payload
  payload=$(cat <<ENDJSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "${title}"},
      "template": "blue"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**作者**: ${pr_author_escaped}"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**分支**: \`${pr_head_escaped}\` → \`${pr_base_escaped}\`"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**描述**:\\n${body}"}},
      {"tag": "hr"},
      {"tag": "action", "actions": [
        {"tag": "button", "text": {"tag": "plain_text", "content": "查看 PR"}, "url": "${PR_URL}", "type": "primary"}
      ]}
    ]
  }
}
ENDJSON
)
  send_card "$payload"
}

build_pr_merged_card() {
  local title
  title=$(escape_json "✅ PR #${PR_NUMBER} 已合并: ${PR_TITLE}")
  title=$(truncate_str "$title" 60)

  local merged_by="${PR_MERGED_BY:-${ACTOR:-unknown}}"
  merged_by=$(escape_json "$merged_by")

  local pr_head_escaped pr_base_escaped
  pr_head_escaped=$(escape_json "${PR_HEAD}")
  pr_base_escaped=$(escape_json "${PR_BASE}")

  local payload
  payload=$(cat <<ENDJSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "${title}"},
      "template": "green"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**合并者**: ${merged_by}"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**分支**: \`${pr_head_escaped}\` → \`${pr_base_escaped}\`"}},
      {"tag": "hr"},
      {"tag": "action", "actions": [
        {"tag": "button", "text": {"tag": "plain_text", "content": "查看 PR"}, "url": "${PR_URL}", "type": "primary"}
      ]}
    ]
  }
}
ENDJSON
)
  send_card "$payload"
}

build_pr_closed_card() {
  local title
  title=$(escape_json "❌ PR #${PR_NUMBER} 已关闭: ${PR_TITLE}")
  title=$(truncate_str "$title" 60)

  local actor_escaped
  actor_escaped=$(escape_json "${ACTOR:-unknown}")

  local payload
  payload=$(cat <<ENDJSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "${title}"},
      "template": "red"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**关闭者**: ${actor_escaped}"}},
      {"tag": "hr"},
      {"tag": "action", "actions": [
        {"tag": "button", "text": {"tag": "plain_text", "content": "查看 PR"}, "url": "${PR_URL}", "type": "primary"}
      ]}
    ]
  }
}
ENDJSON
)
  send_card "$payload"
}

build_pr_updated_card() {
  local title
  title=$(escape_json "🔄 PR #${PR_NUMBER} 有新提交: ${PR_TITLE}")
  title=$(truncate_str "$title" 60)

  local actor_escaped
  actor_escaped=$(escape_json "${ACTOR:-unknown}")

  local payload
  payload=$(cat <<ENDJSON
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "${title}"},
      "template": "wathet"
    },
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**推送者**: ${actor_escaped}"}},
      {"tag": "div", "text": {"tag": "lark_md", "content": "**分支**: \`${PR_HEAD}\` → \`${PR_BASE}\`"}},
      {"tag": "hr"},
      {"tag": "action", "actions": [
        {"tag": "button", "text": {"tag": "plain_text", "content": "查看 PR"}, "url": "${PR_URL}", "type": "primary"}
      ]}
    ]
  }
}
ENDJSON
)
  send_card "$payload"
}

# --- Main Dispatch ---

case "${EVENT_NAME}" in
  push)
    build_push_card
    ;;
  pull_request)
    case "${EVENT_ACTION}" in
      opened|reopened)
        build_pr_opened_card
        ;;
      closed)
        if [ "${PR_MERGED}" = "true" ]; then
          build_pr_merged_card
        else
          build_pr_closed_card
        fi
        ;;
      synchronize)
        build_pr_updated_card
        ;;
      *)
        echo "Unknown PR action: ${EVENT_ACTION}, skipping"
        ;;
    esac
    ;;
  *)
    echo "Unknown event: ${EVENT_NAME}, skipping"
    ;;
esac
