import { cloneElement, isValidElement, type ReactNode } from "react";
import { type EntryData, type MemoryTime, type Profile, unknownTime } from "../../api/crm";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="crm-field">
      <span>{label}</span>
      {isValidElement<{ "aria-label"?: string }>(children) &&
      typeof children.type === "string" &&
      ["input", "textarea", "select"].includes(children.type)
        ? cloneElement(children, { "aria-label": label })
        : children}
    </label>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="crm-error">
      {message}
    </div>
  ) : null;
}
export function displayTime(time: MemoryTime): string {
  return time.value
    ? `${time.value}${time.timezone ? ` · ${time.timezone}` : ""}${time.original ? `（${time.original}）` : ""}`
    : "时间未知";
}
export function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MemoryTime;
  onChange: (t: MemoryTime) => void;
}) {
  return (
    <Field label={label}>
      <div className="crm-row">
        <select
          aria-label={`${label}精度`}
          value={value.precision}
          onChange={(e) =>
            onChange({
              value: e.target.value === "unknown" ? null : "",
              precision: e.target.value as MemoryTime["precision"],
            })
          }
        >
          <option value="unknown">时间未知</option>
          <option value="year">年</option>
          <option value="month">月</option>
          <option value="day">日期</option>
          <option value="minute">分钟</option>
          <option value="second">秒</option>
        </select>
        {value.precision !== "unknown" && (
          <input
            aria-label={label}
            type={
              value.precision === "day" ? "date" : value.precision === "month" ? "month" : "text"
            }
            placeholder={value.precision === "year" ? "2026" : "2026-10-03T19:07:00+08:00"}
            value={value.value ?? ""}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
          />
        )}
      </div>
    </Field>
  );
}

export function ProfileFields({
  value: p,
  onChange,
}: {
  value: Profile;
  onChange: (p: Profile) => void;
}) {
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch });
  return (
    <div className="crm-stack">
      <div className="crm-grid">
        <Field label="姓名">
          <input required value={p.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="称呼 / 别名（逗号分隔）">
          <input
            value={p.aliases.join(",")}
            onChange={(e) => set({ aliases: e.target.value.split(/[,，]/) })}
            onBlur={() => set({ aliases: p.aliases.map((x) => x.trim()).filter(Boolean) })}
          />
        </Field>
        <Field label="性别">
          <input value={p.gender} onChange={(e) => set({ gender: e.target.value })} />
        </Field>
        <Field label="生日历法">
          <select
            value={p.birthday?.calendar ?? "unknown"}
            onChange={(e) =>
              set({
                birthday:
                  e.target.value === "unknown"
                    ? null
                    : {
                        calendar: e.target.value as "gregorian" | "lunar",
                        month: p.birthday?.month ?? 1,
                        day: p.birthday?.day,
                        year: p.birthday?.year,
                        leap_month: false,
                      },
              })
            }
          >
            <option value="unknown">未知</option>
            <option value="gregorian">公历</option>
            <option value="lunar">农历</option>
          </select>
        </Field>
      </div>
      {p.birthday && (
        <div className="crm-row">
          <Field label="出生年份（可留空）">
            <input
              type="number"
              min="1"
              max="9999"
              value={p.birthday.year ?? ""}
              onChange={(e) =>
                set({
                  birthday: {
                    ...p.birthday!,
                    year: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
          </Field>
          <Field label="月份">
            <input
              type="number"
              min="1"
              max="12"
              value={p.birthday.month}
              onChange={(e) => set({ birthday: { ...p.birthday!, month: Number(e.target.value) } })}
            />
          </Field>
          <Field label="日期（可留空）">
            <input
              type="number"
              min="1"
              max="31"
              value={p.birthday.day ?? ""}
              onChange={(e) =>
                set({
                  birthday: {
                    ...p.birthday!,
                    day: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
          </Field>
          {p.birthday.calendar === "lunar" && (
            <label className="crm-check">
              <input
                type="checkbox"
                checked={p.birthday.leap_month}
                onChange={(e) =>
                  set({ birthday: { ...p.birthday!, leap_month: e.target.checked } })
                }
              />
              闰月
            </label>
          )}
        </div>
      )}
      <div className="crm-row">
        <h3>联系方式</h3>
        <button
          type="button"
          className="crm-link"
          onClick={() =>
            set({ contacts: [...p.contacts, { kind: "phone", value: "", label: "" }] })
          }
        >
          ＋ 添加联系方式
        </button>
      </div>
      {p.contacts.map((c, i) => (
        <div className="crm-row" key={i}>
          <select
            aria-label={`联系方式 ${i + 1} 类型`}
            value={c.kind}
            onChange={(e) =>
              set({
                contacts: p.contacts.map((x, j) =>
                  j === i ? { ...x, kind: e.target.value as typeof c.kind } : x,
                ),
              })
            }
          >
            <option value="phone">电话</option>
            <option value="email">邮箱</option>
            <option value="wechat">微信</option>
            <option value="other">其他</option>
          </select>
          <input
            aria-label={`联系方式 ${i + 1}`}
            required
            placeholder="号码 / 账号"
            value={c.value}
            onChange={(e) =>
              set({
                contacts: p.contacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
              })
            }
          />
          <input
            aria-label={`联系方式 ${i + 1} 备注`}
            placeholder="备注"
            value={c.label}
            onChange={(e) =>
              set({
                contacts: p.contacts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
              })
            }
          />
          <button
            type="button"
            className="crm-link"
            aria-label={`删除联系方式 ${i + 1}`}
            onClick={() => set({ contacts: p.contacts.filter((_, j) => j !== i) })}
          >
            删除
          </button>
        </div>
      ))}
      <div className="crm-row">
        <h3>住址与历史住址</h3>
        <button
          type="button"
          className="crm-link"
          onClick={() =>
            set({
              addresses: [
                ...p.addresses,
                { value: "", label: "", valid_from: unknownTime(), valid_until: unknownTime() },
              ],
            })
          }
        >
          ＋ 添加住址
        </button>
      </div>
      {p.addresses.map((a, i) => (
        <div className="crm-inset crm-stack" key={i}>
          <Field label={`住址 ${i + 1}`}>
            <input
              required
              value={a.value}
              onChange={(e) =>
                set({
                  addresses: p.addresses.map((x, j) =>
                    j === i ? { ...x, value: e.target.value } : x,
                  ),
                })
              }
            />
          </Field>
          <Field label="备注（如：目前居住、老家）">
            <input
              value={a.label}
              onChange={(e) =>
                set({
                  addresses: p.addresses.map((x, j) =>
                    j === i ? { ...x, label: e.target.value } : x,
                  ),
                })
              }
            />
          </Field>
          <div className="crm-grid">
            <TimeInput
              label="开始居住时间"
              value={a.valid_from ?? unknownTime()}
              onChange={(t) =>
                set({
                  addresses: p.addresses.map((x, j) => (j === i ? { ...x, valid_from: t } : x)),
                })
              }
            />
            <TimeInput
              label="结束居住时间"
              value={a.valid_until ?? unknownTime()}
              onChange={(t) =>
                set({
                  addresses: p.addresses.map((x, j) => (j === i ? { ...x, valid_until: t } : x)),
                })
              }
            />
          </div>
          <button
            type="button"
            className="crm-link"
            onClick={() => set({ addresses: p.addresses.filter((_, j) => j !== i) })}
          >
            删除住址
          </button>
        </div>
      ))}
      <Field label="人物备注">
        <textarea rows={3} value={p.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

export const STATUS: Record<string, string> = {
  happened: "已发生",
  planned: "计划中",
  cancelled: "已取消",
  current: "当前情况",
  past: "过去情况",
  uncertain: "待确认",
};
export const KIND: Record<string, string> = {
  interaction: "往来",
  fact: "近况 / 信息",
  relationship: "人物关系",
};
export function newEntry(kind: EntryData["kind"], ref: string, quote: string): EntryData {
  const common = { evidence: { quote } };
  return kind === "interaction"
    ? {
        ...common,
        kind,
        summary: "",
        detail: "",
        people: ref ? [{ ref, role: "participant" }] : [],
        topics: [],
        time: unknownTime(),
        status: "happened",
      }
    : kind === "fact"
      ? {
          ...common,
          kind,
          subject: ref,
          predicate: "",
          value: "",
          status: "uncertain",
          valid_from: unknownTime(),
          valid_until: unknownTime(),
        }
      : {
          ...common,
          kind,
          subject: ref,
          object: "",
          relation: "朋友",
          status: "uncertain",
          valid_from: unknownTime(),
          valid_until: unknownTime(),
        };
}

export function EntryFields({
  value: d,
  onChange,
  people,
}: {
  value: EntryData;
  onChange: (d: EntryData) => void;
  people: { key: string; name: string }[];
}) {
  const personSelect = (value: string, set: (s: string) => void, label: string) => (
    <Field label={label}>
      <select required value={value} onChange={(e) => set(e.target.value)}>
        <option value="">选择人物</option>
        {people.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="crm-stack">
      <div className="crm-row">
        <strong>{KIND[d.kind]}</strong>
        <Field label="状态">
          <select
            value={d.status}
            onChange={(e) => onChange({ ...d, status: e.target.value } as EntryData)}
          >
            {(d.kind === "interaction"
              ? ["happened", "planned", "cancelled"]
              : ["uncertain", "current", "past", "planned"]
            ).map((s) => (
              <option key={s} value={s}>
                {STATUS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {d.kind === "interaction" ? (
        <>
          <Field label="交流内容 / 发生了什么">
            <input
              required
              value={d.summary}
              onChange={(e) => onChange({ ...d, summary: e.target.value })}
            />
          </Field>
          <Field label="更多细节">
            <textarea
              value={d.detail}
              rows={2}
              onChange={(e) => onChange({ ...d, detail: e.target.value })}
            />
          </Field>
          <Field label="话题（逗号分隔）">
            <input
              value={d.topics.join(",")}
              onChange={(e) => onChange({ ...d, topics: e.target.value.split(/[,，]/) })}
              onBlur={() =>
                onChange({ ...d, topics: d.topics.map((x) => x.trim()).filter(Boolean) })
              }
            />
          </Field>
          <TimeInput
            label="事情发生时间"
            value={d.time}
            onChange={(time) => onChange({ ...d, time })}
          />
          <fieldset>
            <legend>参与者与被提及的人</legend>
            <div className="crm-stack">
              {people.map((p) => {
                const role = d.people.find((x) => x.ref === p.key)?.role ?? "";
                return (
                  <div className="crm-row" key={p.key}>
                    <span>{p.name}</span>
                    <select
                      aria-label={`${p.name}在这次往来中的角色`}
                      value={role}
                      onChange={(e) =>
                        onChange({
                          ...d,
                          people: [
                            ...d.people.filter((x) => x.ref !== p.key),
                            ...(e.target.value
                              ? [
                                  {
                                    ref: p.key,
                                    role: e.target.value as "participant" | "mentioned",
                                  },
                                ]
                              : []),
                          ],
                        })
                      }
                    >
                      <option value="">不涉及</option>
                      <option value="participant">参与了交流</option>
                      <option value="mentioned">只是被提及</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </>
      ) : (
        <>
          {personSelect(d.subject, (subject) => onChange({ ...d, subject }), "关于谁")}
          {d.kind === "fact" ? (
            <div className="crm-grid">
              <Field label="信息类别（如：工作、爱好）">
                <input
                  required
                  value={d.predicate}
                  onChange={(e) => onChange({ ...d, predicate: e.target.value })}
                />
              </Field>
              <Field label="具体内容">
                <input
                  required
                  value={d.value}
                  onChange={(e) => onChange({ ...d, value: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <div className="crm-grid">
              {personSelect(d.object, (object) => onChange({ ...d, object }), "与谁的关系")}
              <Field label="关系（如：朋友、同事）">
                <input
                  required
                  value={d.relation}
                  onChange={(e) => onChange({ ...d, relation: e.target.value })}
                />
              </Field>
            </div>
          )}
          <div className="crm-grid">
            <TimeInput
              label="信息开始有效时间"
              value={d.valid_from}
              onChange={(valid_from) => onChange({ ...d, valid_from })}
            />
            <TimeInput
              label="信息结束有效时间"
              value={d.valid_until}
              onChange={(valid_until) => onChange({ ...d, valid_until })}
            />
          </div>
        </>
      )}
      <Field label="依据的原话">
        <textarea
          required
          rows={2}
          value={d.evidence.quote}
          onChange={(e) => onChange({ ...d, evidence: { quote: e.target.value } })}
        />
      </Field>
    </div>
  );
}
