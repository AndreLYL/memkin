export interface MemoryTime {
  value: string | null;
  precision: "unknown" | "year" | "month" | "day" | "minute" | "second";
  timezone?: string;
  original?: string;
}
export interface Profile {
  name: string;
  aliases: string[];
  birthday: {
    calendar: "gregorian" | "lunar";
    year?: number;
    month: number;
    day?: number;
    leap_month: boolean;
  } | null;
  gender: string;
  contacts: { kind: "phone" | "email" | "wechat" | "other"; value: string; label: string }[];
  addresses: { label: string; value: string; valid_from?: MemoryTime; valid_until?: MemoryTime }[];
  notes: string;
}
export interface Person {
  id: number;
  slug: string;
  profile: Profile;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface SourceRecord {
  id: string;
  content: string;
  source: "manual" | "voice" | "import";
  captured_at: string;
  captured_at_input: string;
  timezone: string;
  external_id: string | null;
  ingested_at: string;
  person_ids: number[];
}
interface Evidence {
  quote: string;
}
export type EntryData =
  | {
      kind: "interaction";
      summary: string;
      detail: string;
      people: { ref: string; role: "participant" | "mentioned" }[];
      topics: string[];
      time: MemoryTime;
      status: "happened" | "planned" | "cancelled";
      evidence: Evidence;
    }
  | {
      kind: "fact";
      subject: string;
      predicate: string;
      value: string;
      status: "current" | "past" | "planned" | "uncertain";
      valid_from: MemoryTime;
      valid_until: MemoryTime;
      evidence: Evidence;
    }
  | {
      kind: "relationship";
      subject: string;
      object: string;
      relation: string;
      status: "current" | "past" | "planned" | "uncertain";
      valid_from: MemoryTime;
      valid_until: MemoryTime;
      evidence: Evidence;
    };
export interface Entry {
  id: string;
  record_id: string;
  data: EntryData;
  revision: number;
  captured_at_input: string;
  timezone: string;
  ingested_at: string;
}
export interface ProposalData {
  people: { key: string; name: string; profile_patch?: Partial<Profile>; evidence?: Evidence }[];
  entries: EntryData[];
}
export interface Proposal {
  id: string;
  record_id: string;
  data: ProposalData;
  origin: "manual" | "ai";
  status: "pending" | "applied";
  result: { person_ids: number[]; entry_ids: string[] } | null;
}
export interface Revision {
  revision: number;
  before_data: unknown;
  after_data: unknown;
  reason: string;
  recorded_at: string;
}

export const emptyProfile = (name = ""): Profile => ({
  name,
  aliases: [],
  birthday: null,
  gender: "",
  contacts: [],
  addresses: [],
  notes: "",
});
export const unknownTime = (): MemoryTime => ({ value: null, precision: "unknown" });
export async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(`/api/crm${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `请求失败 (${response.status})`);
  return data as T;
}
export const crm = {
  people: (q = "") => request<Person[]>(`/people?q=${encodeURIComponent(q)}&limit=200`),
  person: (id: number) => request<Person>(`/people/${id}`),
  createPerson: (profile: Profile, page_slug?: string) =>
    request<Person>("/people", { profile, ...(page_slug ? { page_slug } : {}) }),
  updatePerson: (p: Person, profile: Profile, reason: string) =>
    request<Person>(`/people/${p.id}`, { profile, expected_revision: p.revision, reason }, "PUT"),
  records: (id?: number) => request<SourceRecord[]>(`/records${id ? `?person_id=${id}` : ""}`),
  record: (id: string) => request<SourceRecord>(`/records/${id}`),
  capture: (body: unknown) => request<SourceRecord>("/records", body),
  proposals: (id: string) => request<Proposal[]>(`/records/${id}/proposals`),
  propose: (id: string, data: ProposalData) => request<Proposal>(`/records/${id}/proposals`, data),
  extract: (id: string) => request<Proposal>(`/records/${id}/extract`, {}),
  apply: (id: string, identities: Record<string, unknown>) =>
    request(`/proposals/${id}/apply`, { identities }),
  timeline: (params: Record<string, string>) =>
    request<Entry[]>(`/timeline?${new URLSearchParams(params)}`),
  correct: (e: Entry, entry: EntryData, reason: string) =>
    request<Entry>(`/entries/${e.id}`, { entry, expected_revision: e.revision, reason }, "PUT"),
  history: (type: "person" | "entry", id: string) => request<Revision[]>(`/history/${type}/${id}`),
};
