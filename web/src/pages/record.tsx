import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import {
  crm,
  emptyProfile,
  type EntryData,
  type Profile,
  type Proposal,
  type ProposalData,
} from "../api/crm";
import {
  EntryFields,
  ErrorNotice,
  Field,
  KIND,
  ProfileFields,
  newEntry,
} from "../components/crm/forms";
import { describeSnapshot } from "../components/crm/entry-card";
import "../components/crm/crm.css";

export function RecordPage() {
  const id = useParams().id!;
  const cache = useQueryClient();
  const record = useQuery({ queryKey: ["crm-record", id], queryFn: () => crm.record(id) });
  const people = useQuery({ queryKey: ["crm-people", ""], queryFn: () => crm.people() });
  const proposals = useQuery({ queryKey: ["crm-proposals", id], queryFn: () => crm.proposals(id) });
  const [draft, setDraft] = useState<ProposalData | null>(null);
  const [original, setOriginal] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [newProfiles, setNewProfiles] = useState<Record<string, Profile>>({});
  const [profileConfirmed, setProfileConfirmed] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState("");
  const [addPerson, setAddPerson] = useState("");
  const [appliedPeople, setAppliedPeople] = useState<number[] | null>(null);
  useEffect(() => {
    setDraft(null);
    setOriginal(null);
    setSelected({});
    setAppliedPeople(null);
  }, [id]);
  useEffect(() => {
    if (draft || !record.data || !people.data) return;
    const initialPeople = people.data.filter((p) => record.data!.person_ids.includes(p.id));
    setDraft({
      people: initialPeople.map((p) => ({ key: `p${p.id}`, name: p.profile.name })),
      entries: [],
    });
    setSelected(Object.fromEntries(initialPeople.map((p) => [`p${p.id}`, String(p.id)])));
  }, [record.data, people.data, draft]);
  function openProposal(p: Proposal) {
    setOriginal(p);
    setDraft(structuredClone(p.data));
    setSelected({});
    setProfileConfirmed({});
    setAppliedPeople(p.result?.person_ids ?? null);
    setNewProfiles(
      Object.fromEntries(
        p.data.people.map((x) => [x.key, { ...emptyProfile(x.name), ...x.profile_patch }]),
      ),
    );
  }
  const extract = useMutation({
    mutationFn: () => crm.extract(id),
    onSuccess: (p) => {
      openProposal(p);
      void cache.invalidateQueries({ queryKey: ["crm-proposals", id] });
    },
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (!draft?.people.length || !draft.entries.length)
        throw new Error("请先选择涉及的人物，并添加至少一条记忆。");
      const identities: Record<string, unknown> = {};
      for (const proposed of draft.people) {
        const chosen = selected[proposed.key];
        if (!chosen) throw new Error(`请确认「${proposed.name}」对应哪个人物。`);
        if (chosen === "new")
          identities[proposed.key] = {
            new_person: newProfiles[proposed.key] ?? emptyProfile(proposed.name),
          };
        else {
          const person = people.data?.find((p) => String(p.id) === chosen);
          if (!person) throw new Error("人物档案已变化，请刷新后重新选择。");
          identities[proposed.key] = {
            person_id: person.id,
            expected_revision: person.revision,
            apply_profile: !!profileConfirmed[proposed.key],
          };
        }
      }
      const proposal =
        original &&
        original.status === "pending" &&
        JSON.stringify(original.data) === JSON.stringify(draft)
          ? original
          : await crm.propose(id, draft);
      return (await crm.apply(proposal.id, identities)) as { person_ids: number[] };
    },
    onSuccess: (result) => {
      setAppliedPeople(result.person_ids);
      void cache.invalidateQueries({ queryKey: ["crm-proposals", id] });
      void cache.invalidateQueries({ queryKey: ["crm-timeline"] });
      void cache.invalidateQueries({ queryKey: ["crm-people"] });
      void cache.invalidateQueries({ queryKey: ["crm-records"] });
    },
  });
  const updateEntry = (index: number, entry: EntryData) =>
    setDraft({ ...draft!, entries: draft!.entries.map((d, i) => (i === index ? entry : d)) });
  const startNew = () => {
    setDraft({ people: [], entries: [] });
    setOriginal(null);
    setSelected({});
    setAppliedPeople(null);
    apply.reset();
    extract.reset();
  };
  if (record.error)
    return (
      <div className="crm-page">
        <ErrorNotice message={record.error.message} />
      </div>
    );
  if (!record.data || !draft) return <div className="crm-page crm-muted">正在读取原始记录…</div>;
  const r = record.data;
  return (
    <div className="crm-page crm-stack">
      <Link className="crm-link" to="/records">
        ← 随手记
      </Link>
      <div>
        <h1>把这次交流，放进记忆里</h1>
        <p className="crm-muted">原文已保存。你可以手动整理，或让 AI 给出一份待确认的建议。</p>
      </div>
      <section className="crm-card crm-stack">
        <h2>原始记录</h2>
        <blockquote className="crm-quote">{r.content}</blockquote>
        <div className="crm-muted">
          记录于 {r.captured_at_input} · {r.timezone}
          <br />
          入库于 {new Date(r.ingested_at).toLocaleString()} ·{" "}
          {{ manual: "手动记录", voice: "录音转写", import: "历史导入" }[r.source]}
        </div>
      </section>
      <div className="crm-row">
        <button
          className="crm-btn crm-secondary"
          disabled={extract.isPending}
          onClick={() => extract.mutate()}
        >
          {extract.isPending ? "正在整理建议…" : "让 AI 提取建议"}
        </button>
        <button className="crm-link" onClick={startNew}>
          开始新的手动整理
        </button>
      </div>
      <ErrorNotice
        message={extract.error?.message ?? people.error?.message ?? proposals.error?.message ?? ""}
      />
      {proposals.data && proposals.data.length > 0 && (
        <details>
          <summary>查看已保存的整理建议（{proposals.data.length}）</summary>
          <div className="crm-row">
            {proposals.data.map((p, i) => (
              <button className="crm-btn crm-secondary" key={p.id} onClick={() => openProposal(p)}>
                建议 {i + 1} · {p.origin === "ai" ? "AI" : "手动"} ·{" "}
                {p.status === "applied" ? "已应用" : "待确认"}
              </button>
            ))}
          </div>
        </details>
      )}
      {appliedPeople ? (
        <section className="crm-card crm-stack" role="status">
          <h2>已整理进人物档案</h2>
          <p className="crm-muted">
            原文保留不变。以后可以在人物时间线中检索，也可以更正已整理的记忆。
          </p>
          <div className="crm-row">
            {appliedPeople.map((personId) => (
              <Link className="crm-btn" key={personId} to={`/people/${personId}`}>
                {people.data?.find((p) => p.id === personId)?.profile.name ?? "查看人物档案"} →
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <form
          className="crm-stack"
          onSubmit={(e) => {
            e.preventDefault();
            apply.mutate();
          }}
        >
          <section className="crm-card crm-stack">
            <h2>1. 确认涉及的人物</h2>
            <p className="crm-muted">
              同名的人可能不是同一个人。请为每个名字选择档案，或明确新建。
            </p>
            <div className="crm-row">
              <Field label="添加已有档案">
                <select value={addPerson} onChange={(e) => setAddPerson(e.target.value)}>
                  <option value="">选择人物</option>
                  {people.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.profile.name} · 档案 {p.id}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="crm-btn crm-secondary"
                onClick={() => {
                  const p = people.data?.find((x) => String(x.id) === addPerson);
                  if (!p) return;
                  const key = `p${p.id}`;
                  if (draft.people.some((x) => x.key === key)) return;
                  setDraft({ ...draft, people: [...draft.people, { key, name: p.profile.name }] });
                  setSelected({ ...selected, [key]: String(p.id) });
                  setAddPerson("");
                }}
              >
                添加
              </button>
            </div>
            <div className="crm-row">
              <Field label="记录中出现了新人物">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="姓名或称呼"
                />
              </Field>
              <button
                type="button"
                className="crm-btn crm-secondary"
                onClick={() => {
                  if (!newName.trim()) return;
                  const key = crypto.randomUUID();
                  setDraft({ ...draft, people: [...draft.people, { key, name: newName.trim() }] });
                  setNewName("");
                }}
              >
                添加名字
              </button>
            </div>
            {draft.people.map((p) => (
              <div className="crm-inset crm-stack" key={p.key}>
                <Field label={`「${p.name}」对应的档案`}>
                  <select
                    required
                    value={selected[p.key] ?? ""}
                    onChange={(e) => {
                      setSelected({ ...selected, [p.key]: e.target.value });
                      if (e.target.value === "new" && !newProfiles[p.key])
                        setNewProfiles({
                          ...newProfiles,
                          [p.key]: { ...emptyProfile(p.name), ...p.profile_patch },
                        });
                    }}
                  >
                    <option value="">请确认身份</option>
                    {people.data?.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.profile.name} ·{" "}
                        {person.profile.aliases.join(" / ") || `档案 ${person.id}`}
                      </option>
                    ))}
                    <option value="new">新建一位人物</option>
                  </select>
                </Field>
                {selected[p.key] === "new" && (
                  <ProfileFields
                    value={newProfiles[p.key] ?? emptyProfile(p.name)}
                    onChange={(profile) => setNewProfiles({ ...newProfiles, [p.key]: profile })}
                  />
                )}
                {p.profile_patch && selected[p.key] !== "new" && (
                  <div className="crm-stack">
                    <h3>建议补充的资料</h3>
                    <p className="crm-muted">{describeSnapshot(p.profile_patch)}</p>
                    <blockquote className="crm-quote">{p.evidence?.quote}</blockquote>
                    <label className="crm-check">
                      <input
                        type="checkbox"
                        checked={!!profileConfirmed[p.key]}
                        onChange={(e) =>
                          setProfileConfirmed({ ...profileConfirmed, [p.key]: e.target.checked })
                        }
                      />
                      确认用这些内容替换档案中的对应字段
                    </label>
                  </div>
                )}
                <button
                  type="button"
                  className="crm-link"
                  onClick={() => {
                    if (draft.entries.length) {
                      window.alert("请先删除涉及此人物的记忆，或开始新的手动整理。");
                      return;
                    }
                    setDraft({ ...draft, people: draft.people.filter((x) => x.key !== p.key) });
                  }}
                >
                  移除这个名字
                </button>
              </div>
            ))}
          </section>
          <section className="crm-card crm-stack">
            <h2>2. 整理交流、近况与关系</h2>
            <p className="crm-muted">
              时间拿不准就保留未知。未来的打算请选择“计划中”，原话会作为每条记忆的依据。
            </p>
            {draft.entries.map((entry, i) => (
              <div className="crm-inset crm-stack" key={i}>
                <EntryFields
                  value={entry}
                  onChange={(d) => updateEntry(i, d)}
                  people={draft.people}
                />
                <button
                  type="button"
                  className="crm-link"
                  onClick={() =>
                    setDraft({ ...draft, entries: draft.entries.filter((_, j) => j !== i) })
                  }
                >
                  删除这条建议
                </button>
              </div>
            ))}
            <div className="crm-row">
              {(["interaction", "fact", "relationship"] as const).map((kind) => (
                <button
                  type="button"
                  className="crm-btn crm-secondary"
                  key={kind}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      entries: [
                        ...draft.entries,
                        newEntry(kind, draft.people[0]?.key ?? "", r.content.slice(0, 10000)),
                      ],
                    })
                  }
                >
                  ＋ {KIND[kind]}
                </button>
              ))}
            </div>
          </section>
          <ErrorNotice message={apply.error?.message ?? ""} />
          <div className="crm-row">
            <button
              className="crm-btn"
              disabled={apply.isPending || !draft.people.length || !draft.entries.length}
            >
              {apply.isPending ? "正在保存…" : "确认以上内容，保存到人物档案"}
            </button>
            <span className="crm-muted">以后可以更正，修订记录会保留。</span>
          </div>
        </form>
      )}
    </div>
  );
}
