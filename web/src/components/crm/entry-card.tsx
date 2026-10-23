import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { crm, type Entry, type Person } from "../../api/crm";
import { EntryFields, ErrorNotice, Field, KIND, STATUS, displayTime } from "./forms";

export function describeSnapshot(value: unknown): string {
  if (value === null || value === undefined) return "未记录";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(describeSnapshot).join("；");
  const v = value as Record<string, unknown>;
  if (v.kind === "interaction")
    return `${STATUS[String(v.status)]} · ${v.summary} · ${describeSnapshot(v.time)} · ${describeSnapshot(v.topics)}`;
  if (v.kind === "fact")
    return `${STATUS[String(v.status)]} · ${v.predicate}：${v.value} · ${describeSnapshot(v.valid_from)}`;
  if (v.kind === "relationship")
    return `${STATUS[String(v.status)]} · ${v.subject} ${v.relation} ${v.object} · ${describeSnapshot(v.valid_from)}`;
  const labels: Record<string, string> = {
    name: "姓名",
    aliases: "别名",
    birthday: "生日",
    year: "年",
    month: "月",
    day: "日",
    calendar: "历法",
    leap_month: "闰月",
    gender: "性别",
    contacts: "联系方式",
    addresses: "住址",
    notes: "备注",
    kind: "类型",
    value: "内容",
    label: "备注",
    valid_from: "开始",
    valid_until: "结束",
    precision: "时间精度",
    timezone: "时区",
    original: "原话",
  };
  return Object.entries(v)
    .map(([k, val]) => `${labels[k] ?? k}：${describeSnapshot(val)}`)
    .join("；");
}

export function EntryCard({ entry: e, people }: { entry: Entry; people: Person[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.data);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const cache = useQueryClient();
  const history = useQuery({
    queryKey: ["crm-history", e.id],
    queryFn: () => crm.history("entry", e.id),
    enabled: showHistory,
  });
  const correct = useMutation({
    mutationFn: () => crm.correct(e, draft, reason),
    onSuccess: () => {
      setEditing(false);
      void cache.invalidateQueries({ queryKey: ["crm-timeline"] });
      void cache.invalidateQueries({ queryKey: ["crm-records"] });
      void cache.invalidateQueries({ queryKey: ["crm-history", e.id] });
    },
  });
  const d = e.data;
  const name = (id: string) =>
    people.find((p) => String(p.id) === id)?.profile.name ?? `人物 ${id}`;
  const personLink = (id: string) => (
    <Link className="crm-link" to={`/people/${id}`}>
      {name(id)}
    </Link>
  );
  return (
    <article className="crm-entry crm-stack">
      <div className="crm-row">
        <span className="crm-tag">{KIND[d.kind]}</span>
        <span className={`crm-tag crm-status-${d.status}`}>{STATUS[d.status]}</span>
        <span className="crm-muted">
          {displayTime(d.kind === "interaction" ? d.time : d.valid_from)}
        </span>
      </div>
      <h3>
        {d.kind === "interaction" ? (
          d.summary
        ) : d.kind === "fact" ? (
          `${d.predicate}：${d.value}`
        ) : (
          <>
            {personLink(d.subject)} 与 {personLink(d.object)} · {d.relation}
          </>
        )}
      </h3>
      {d.kind === "interaction" ? (
        <>
          <p className="crm-muted">{d.detail}</p>
          <div className="crm-row">
            {d.people.map((p) => (
              <span className="crm-muted" key={`${p.ref}:${p.role}`}>
                {personLink(p.ref)} · {p.role === "participant" ? "参与交流" : "被提及"}
              </span>
            ))}
            {d.topics.map((topic, i) => (
              <span className="crm-tag" key={`${topic}:${i}`}>
                #{topic}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="crm-muted">
          关于 {personLink(d.subject)} · 有效期结束：{displayTime(d.valid_until)}
        </p>
      )}
      <div className="crm-muted">
        原始记录：{e.captured_at_input} · {e.timezone}
      </div>
      <details>
        <summary>查看原话和来源</summary>
        <blockquote className="crm-quote">{d.evidence.quote}</blockquote>
        <p className="crm-muted">入库：{new Date(e.ingested_at).toLocaleString()}</p>
        <Link className="crm-link" to={`/records/${e.record_id}`}>
          查看完整原始记录 →
        </Link>
      </details>
      <div className="crm-row">
        <button
          className="crm-link"
          onClick={() => {
            setDraft(e.data);
            setEditing(!editing);
          }}
        >
          更正这条记忆
        </button>
        <button className="crm-link" onClick={() => setShowHistory(!showHistory)}>
          修订历史
        </button>
      </div>
      {editing && (
        <form
          className="crm-card crm-stack"
          onSubmit={(ev) => {
            ev.preventDefault();
            correct.mutate();
          }}
        >
          <EntryFields
            value={draft}
            onChange={setDraft}
            people={people.map((p) => ({ key: String(p.id), name: p.profile.name }))}
          />
          <Field label="更正原因">
            <input required value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Field>
          <ErrorNotice message={correct.error?.message ?? ""} />
          <div className="crm-row">
            <button className="crm-btn" disabled={correct.isPending}>
              保存更正
            </button>
            <button type="button" className="crm-link" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      {showHistory && (
        <div className="crm-inset crm-stack">
          <ErrorNotice message={history.error?.message ?? ""} />
          {history.data?.map((r) => (
            <div key={r.revision}>
              <strong>
                第 {r.revision} 版 · {r.reason}
              </strong>
              <p className="crm-muted">{new Date(r.recorded_at).toLocaleString()}</p>
              {r.before_data !== null && (
                <p className="crm-muted">更正前：{describeSnapshot(r.before_data)}</p>
              )}
              <p className="crm-muted">保存后：{describeSnapshot(r.after_data)}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
