import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { crm, type Profile } from "../api/crm";
import { ErrorNotice, Field, ProfileFields, displayTime } from "../components/crm/forms";
import { EntryCard, describeSnapshot } from "../components/crm/entry-card";
import "../components/crm/crm.css";

export function PersonPage() {
  const id = Number(useParams().id);
  const cache = useQueryClient();
  const person = useQuery({ queryKey: ["crm-person", id], queryFn: () => crm.person(id) });
  const people = useQuery({ queryKey: ["crm-people", ""], queryFn: () => crm.people() });
  const [draft, setDraft] = useState<Profile | null>(null);
  const [reason, setReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [axis, setAxis] = useState("occurred");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [topic, setTopic] = useState("");
  const [role, setRole] = useState("");
  const params: Record<string, string> = { person_id: String(id), axis };
  if (from) params.from = new Date(`${from}T00:00:00`).toISOString();
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    params.to = end.toISOString();
  }
  if (topic) params.topic = topic;
  if (role) params.role = role;
  const timeline = useQuery({
    queryKey: ["crm-timeline", params],
    queryFn: () => crm.timeline(params),
  });
  const records = useQuery({ queryKey: ["crm-records", id], queryFn: () => crm.records(id) });
  const history = useQuery({
    queryKey: ["crm-person-history", id],
    queryFn: () => crm.history("person", String(id)),
    enabled: historyOpen,
  });
  const save = useMutation({
    mutationFn: () => crm.updatePerson(person.data!, draft!, reason),
    onSuccess: () => {
      setDraft(null);
      void cache.invalidateQueries({ queryKey: ["crm-person", id] });
      void cache.invalidateQueries({ queryKey: ["crm-people"] });
      void cache.invalidateQueries({ queryKey: ["crm-person-history", id] });
    },
  });
  if (person.error)
    return (
      <div className="crm-page">
        <ErrorNotice message={person.error.message} />
        <Link to="/people" className="crm-link">
          返回人物列表
        </Link>
      </div>
    );
  if (!person.data) return <div className="crm-page crm-muted">正在读取档案…</div>;
  const p = person.data.profile;
  return (
    <div className="crm-page crm-stack">
      <Link to="/people" className="crm-link">
        ← 人物档案
      </Link>
      <div className="crm-row" style={{ justifyContent: "space-between" }}>
        <div className="crm-row">
          <span className="crm-avatar">{p.name.slice(0, 1)}</span>
          <div>
            <h1>{p.name}</h1>
            <p className="crm-muted">
              {p.aliases.join(" · ") || "每一段关系，都有值得记住的细节。"}
            </p>
          </div>
        </div>
        <Link className="crm-btn" to={`/records?person_id=${id}`}>
          ＋ 记一次交流
        </Link>
      </div>
      <section className="crm-card crm-stack">
        <div className="crm-row" style={{ justifyContent: "space-between" }}>
          <h2>人物资料</h2>
          <div className="crm-row">
            <button className="crm-link" onClick={() => setDraft(draft ? null : p)}>
              编辑资料
            </button>
            <button className="crm-link" onClick={() => setHistoryOpen(!historyOpen)}>
              资料修订历史
            </button>
          </div>
        </div>
        {draft ? (
          <form
            className="crm-stack"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <ProfileFields value={draft} onChange={setDraft} />
            <Field label="修改原因">
              <input required value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <ErrorNotice message={save.error?.message ?? ""} />
            <div className="crm-row">
              <button className="crm-btn" disabled={save.isPending}>
                保存资料
              </button>
              <button type="button" className="crm-link" onClick={() => setDraft(null)}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="crm-grid">
              <div>
                <p className="crm-muted">生日</p>
                <p>
                  {p.birthday
                    ? `${p.birthday.calendar === "lunar" ? "农历" : "公历"} ${p.birthday.year ? `${p.birthday.year} 年 ` : ""}${p.birthday.leap_month ? "闰" : ""}${p.birthday.month} 月${p.birthday.day ? ` ${p.birthday.day} 日` : ""}`
                    : "尚未记录"}
                </p>
              </div>
              <div>
                <p className="crm-muted">性别</p>
                <p>{p.gender || "尚未记录"}</p>
              </div>
            </div>
            {p.contacts.length > 0 && (
              <div>
                <h3>联系方式</h3>
                {p.contacts.map((c, i) => (
                  <p className="crm-muted" key={i}>
                    {{ phone: "电话", email: "邮箱", wechat: "微信", other: "其他" }[c.kind]} ·{" "}
                    {c.value}
                    {c.label ? `（${c.label}）` : ""}
                  </p>
                ))}
              </div>
            )}
            {p.addresses.length > 0 && (
              <div>
                <h3>住址与历史住址</h3>
                {p.addresses.map((a, i) => (
                  <div key={i}>
                    <p>
                      {a.value}
                      {a.label ? ` · ${a.label}` : ""}
                    </p>
                    <p className="crm-muted">
                      {a.valid_from ? displayTime(a.valid_from) : "开始时间未知"} →{" "}
                      {a.valid_until ? displayTime(a.valid_until) : "结束时间未知"}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {p.notes && <p className="crm-quote">{p.notes}</p>}
          </>
        )}
        {historyOpen && (
          <div className="crm-inset crm-stack">
            <ErrorNotice message={history.error?.message ?? ""} />
            {history.data?.map((r) => (
              <div key={r.revision}>
                <strong>
                  第 {r.revision} 版 · {r.reason}
                </strong>
                <p className="crm-muted">{new Date(r.recorded_at).toLocaleString()}</p>
                {r.before_data !== null && (
                  <p className="crm-muted">修改前：{describeSnapshot(r.before_data)}</p>
                )}
                <p className="crm-muted">保存后：{describeSnapshot(r.after_data)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="crm-card crm-stack">
        <h2>我们的记忆时间线</h2>
        <p className="crm-muted">
          按事情发生的时间回顾，也可以切换到当时记录下来的顺序。时间未知的记忆会单独保留。
        </p>
        <div className="crm-row">
          <Field label="查看顺序">
            <select value={axis} onChange={(e) => setAxis(e.target.value)}>
              <option value="occurred">事情发生时间</option>
              <option value="captured">原始记录时间</option>
            </select>
          </Field>
          <Field label="起始日期（本地）">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="结束日期（本地）">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="crm-row">
          <Field label="筛选话题">
            <input
              placeholder="如：工作、搬家"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </Field>
          <Field label="在记录中的角色">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">所有角色</option>
              <option value="participant">参与交流</option>
              <option value="mentioned">被提及</option>
              <option value="subject">信息主体</option>
              <option value="related">关系另一方</option>
            </select>
          </Field>
        </div>
        <ErrorNotice message={timeline.error?.message ?? ""} />
        {timeline.isPending ? (
          <p className="crm-muted">正在读取记忆…</p>
        ) : timeline.data?.length ? (
          timeline.data.map((e) => (
            <EntryCard key={e.id} entry={e} people={people.data ?? [person.data!]} />
          ))
        ) : (
          <div className="crm-empty">
            还没有符合条件的记忆。可以先记一条，再把其中的信息整理进档案。
          </div>
        )}
      </section>
      <section className="crm-card crm-stack">
        <h2>相关原始记录</h2>
        <ErrorNotice message={records.error?.message ?? ""} />
        {records.data?.map((r) => (
          <Link key={r.id} to={`/records/${r.id}`} className="crm-inset crm-stack">
            <p>{r.content.slice(0, 160)}</p>
            <span className="crm-muted">
              {r.captured_at_input} · {r.timezone}
            </span>
          </Link>
        ))}
        {records.data?.length === 0 && <p className="crm-muted">尚未关联原始记录。</p>}
      </section>
    </div>
  );
}
