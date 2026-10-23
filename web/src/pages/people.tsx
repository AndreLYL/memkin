import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Users, Plus, Search, ArrowUpRight } from "lucide-react";
import { crm, emptyProfile } from "../api/crm";
import { ErrorNotice, Field, ProfileFields } from "../components/crm/forms";
import "../components/crm/crm.css";

export function PeoplePage() {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [profile, setProfile] = useState(emptyProfile());
  const navigate = useNavigate();
  const cache = useQueryClient();
  const people = useQuery({ queryKey: ["crm-people", query], queryFn: () => crm.people(query) });
  const create = useMutation({
    mutationFn: () => crm.createPerson(profile),
    onSuccess: (p) => {
      void cache.invalidateQueries({ queryKey: ["crm-people"] });
      navigate(`/people/${p.id}`);
    },
  });
  return (
    <div className="crm-page crm-stack">
      <div className="crm-row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="crm-muted">PERSON MEMORY</div>
          <h1>记住身边的人</h1>
          <p className="crm-muted">把聊过的话、最近的变化和共同经历，留在各自的记忆档案里。</p>
        </div>
        <button className="crm-btn" onClick={() => setCreating(!creating)}>
          <Plus size={16} />
          新建人物
        </button>
      </div>
      {creating && (
        <form
          className="crm-card crm-stack"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2>建立人物档案</h2>
          <p className="crm-muted">只填确定的信息。生日年份可以留空，同名的人也会各自建档。</p>
          <ProfileFields value={profile} onChange={setProfile} />
          <ErrorNotice message={create.error?.message ?? ""} />
          <div className="crm-row">
            <button className="crm-btn" disabled={create.isPending}>
              建立档案
            </button>
            <button type="button" className="crm-link" onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      <div className="crm-card">
        <Field label="查找人物">
          <div className="crm-row">
            <Search size={18} />
            <input
              placeholder="姓名、称呼或别名"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        </Field>
      </div>
      <ErrorNotice message={people.error?.message ?? ""} />
      {people.isPending ? (
        <p className="crm-muted">正在读取人物档案…</p>
      ) : (
        <>
          <div className="crm-row">
            <Users size={16} />
            <span className="crm-muted">{people.data?.length ?? 0} 位人物</span>
            <Link className="crm-link" to="/records">
              去随手记一条 →
            </Link>
          </div>
          <div className="crm-profile-list">
            {people.data?.map((p) => (
              <Link className="crm-card crm-card-link crm-stack" key={p.id} to={`/people/${p.id}`}>
                <div className="crm-row">
                  <span className="crm-avatar">{p.profile.name.slice(0, 1)}</span>
                  <div style={{ flex: 1 }}>
                    <h2>{p.profile.name}</h2>
                    <p className="crm-muted">
                      {p.profile.aliases.join(" · ") || "尚未添加其他称呼"}
                    </p>
                  </div>
                  <ArrowUpRight size={16} />
                </div>
                <p className="crm-muted">
                  {p.profile.notes.slice(0, 100) || "从一次交流开始，慢慢了解这个人。"}
                </p>
                {p.profile.birthday && (
                  <span className="crm-tag">
                    {p.profile.birthday.calendar === "lunar" ? "农历" : "公历"}{" "}
                    {p.profile.birthday.month} 月
                    {p.profile.birthday.day ? ` ${p.profile.birthday.day} 日` : ""}
                  </span>
                )}
              </Link>
            ))}
          </div>
          {!people.data?.length && (
            <div className="crm-card crm-empty">
              {query ? "还没有找到匹配的人物。" : "建立第一个人物档案，或先记下刚刚聊过的事情。"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
