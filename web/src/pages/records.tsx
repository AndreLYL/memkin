import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { crm } from "../api/crm";
import { ErrorNotice, Field } from "../components/crm/forms";
import "../components/crm/crm.css";

function localInstant(): string {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const local = new Date(now.getTime() + offset * 60000).toISOString().slice(0, 19);
  return `${local}${offset >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

export function RecordsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [content, setContent] = useState("");
  const [source, setSource] = useState("manual");
  const [captured, setCaptured] = useState(localInstant);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [externalId, setExternalId] = useState("");
  const [selected, setSelected] = useState<number[]>(() =>
    params.get("person_id") ? [Number(params.get("person_id"))] : [],
  );
  const people = useQuery({ queryKey: ["crm-people", ""], queryFn: () => crm.people() });
  const records = useInfiniteQuery({
    queryKey: ["crm-records"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => crm.records(undefined, pageParam),
    getNextPageParam: (last, pages) => (last.length === 100 ? pages.length * 100 : undefined),
  });
  const recordItems = records.data?.pages.flat() ?? [];
  const save = useMutation({
    mutationFn: () =>
      crm.capture({
        content,
        source,
        captured_at: captured,
        timezone,
        person_ids: selected,
        ...(externalId ? { external_id: externalId } : {}),
      }),
    onSuccess: (r) => {
      void cache.invalidateQueries({ queryKey: ["crm-records"] });
      navigate(`/records/${r.id}`);
    },
  });
  return (
    <div className="crm-page crm-stack">
      <div>
        <div className="crm-muted">CAPTURE & REMEMBER</div>
        <h1>随手记</h1>
        <p className="crm-muted">先把原话记下来。整理成档案的过程，可以现在做，也可以稍后再做。</p>
      </div>
      <form
        className="crm-card crm-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="刚刚聊了什么？">
          <textarea
            required
            rows={7}
            placeholder="例如：今晚和小林吃饭。他说下个月准备搬家，最近正在看杭州的工作机会……"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <Field label="先关联到人物（可不选）">
          <select
            multiple
            aria-label="关联人物"
            value={selected.map(String)}
            onChange={(e) =>
              setSelected(Array.from(e.target.selectedOptions, (o) => Number(o.value)))
            }
          >
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.profile.name} · {p.profile.aliases.join(" / ") || `档案 ${p.id}`}
              </option>
            ))}
          </select>
        </Field>
        <div className="crm-grid">
          <Field label="记录来源">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="manual">手动输入 / 口述</option>
              <option value="voice">录音转写文本</option>
              <option value="import">导入历史文本</option>
            </select>
          </Field>
          <Field label="原始记录时间（含时区偏移）">
            <input
              required
              value={captured}
              onChange={(e) => setCaptured(e.target.value)}
              placeholder="2026-10-03T19:07:00+08:00"
            />
          </Field>
        </div>
        <details>
          <summary>时区与导入标识</summary>
          <div className="crm-grid">
            <Field label="记录发生地的时区">
              <input
                required
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Shanghai"
              />
            </Field>
            <Field label="外部记录标识（可选，用于避免重复导入）">
              <input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </Field>
          </div>
        </details>
        <p className="crm-muted">
          导入时请填写当时的记录时间。事情实际发生的时间会在下一步单独整理。录音请先转成文字后粘贴。
        </p>
        <ErrorNotice message={save.error?.message ?? people.error?.message ?? ""} />
        <div className="crm-row">
          <button className="crm-btn" disabled={save.isPending}>
            {save.isPending ? "正在保存…" : "保存原文，继续整理"}
          </button>
          <Link className="crm-link" to="/people">
            查看人物档案
          </Link>
        </div>
      </form>
      <h2>最近记录</h2>
      <ErrorNotice message={records.error?.message ?? ""} />
      {records.isPending ? (
        <p className="crm-muted">正在读取记录…</p>
      ) : (
        recordItems.map((r) => (
          <Link key={r.id} className="crm-card crm-card-link crm-stack" to={`/records/${r.id}`}>
            <p>{r.content.slice(0, 240)}</p>
            <span className="crm-muted">
              {r.captured_at_input} · {r.timezone} ·{" "}
              {{ manual: "手动记录", voice: "录音转写", import: "导入" }[r.source]}
            </span>
          </Link>
        ))
      )}
      {records.hasNextPage && (
        <button
          className="crm-btn crm-secondary"
          disabled={records.isFetchingNextPage}
          onClick={() => records.fetchNextPage()}
        >
          {records.isFetchingNextPage ? "正在读取…" : "读取更早的记录"}
        </button>
      )}
      {!records.isPending && recordItems.length === 0 && (
        <div className="crm-empty">你的第一条记忆，从上面开始。</div>
      )}
    </div>
  );
}
