import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CrmProvider, proposeRecord } from "../crm/extract.js";
import {
  ApplySchema,
  CaptureSchema,
  CorrectionSchema,
  CreatePersonSchema,
  IdSchema,
  ProposalSchema,
  TimelineSchema,
  UpdatePersonSchema,
} from "../crm/schemas.js";
import { CrmError, CrmStore } from "../crm/store.js";
import type { SqlExecutor } from "../store/sql-executor.js";

export function registerCrmTools(
  server: McpServer,
  db: SqlExecutor,
  options: { readOnly?: boolean; crmProvider?: CrmProvider },
): void {
  const store = new CrmStore(db);
  function add<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    readOnly: boolean,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ): void {
    if (!readOnly && options.readOnly) return;
    const described: z.ZodRawShape = Object.fromEntries(
      Object.entries(shape).map(([key, schema]) => [
        key,
        schema.describe(
          `CRM ${key.replaceAll("_", " ")}; see tool description for required semantics.`,
        ),
      ]),
    );
    server.registerTool(
      name,
      {
        title: name.replaceAll("_", " "),
        description,
        inputSchema: described,
        annotations: { readOnlyHint: readOnly, destructiveHint: false },
      },
      async (args) => {
        try {
          const result = await handler(args as z.infer<z.ZodObject<S>>);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          const payload = {
            error: {
              code:
                error instanceof CrmError
                  ? error.code
                  : error instanceof z.ZodError
                    ? "INVALID_ARGUMENT"
                    : "INTERNAL_ERROR",
              message:
                error instanceof CrmError || error instanceof z.ZodError
                  ? error.message
                  : "CRM operation failed",
            },
          };
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          };
        }
      },
    );
  }
  add(
    "crm_list_people",
    "Find structured person profiles. Names and aliases are search hints, never proof of identity.",
    {
      query: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    true,
    (a) => store.listPeople(a.query, a.limit, a.offset),
  );
  add(
    "crm_get_person",
    "Read a stable person ID, structured profile and revision. Use crm_timeline for memories.",
    { person_id: IdSchema },
    true,
    (a) => store.getPerson(a.person_id),
  );
  add(
    "crm_create_person",
    "Create a distinct person, even for an existing name. Explicit page_slug adopts a selected legacy person page.",
    CreatePersonSchema.shape,
    false,
    (a) => store.createPerson(a),
  );
  add(
    "crm_update_person",
    "Save an explicitly reviewed full profile. Supply the last revision and a correction reason.",
    { person_id: IdSchema, ...UpdatePersonSchema.shape },
    false,
    ({ person_id, ...a }) => store.updatePerson(person_id, a),
  );
  add(
    "crm_capture_record",
    "Save immutable text before extraction. captured_at is the original capture time with offset; timezone is IANA. Preserve original times during import. Audio devices pass transcribed text.",
    CaptureSchema.shape,
    false,
    (a) => store.capture(a),
  );
  add(
    "crm_list_records",
    "List source records by original capture time, optionally for a person.",
    {
      person_id: IdSchema.optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    true,
    (a) => store.listRecords(a.person_id, a.limit, a.offset),
  );
  add(
    "crm_get_record",
    "Read exact original source, original capture time, ingestion time and editable proposals.",
    { record_id: z.string().min(1) },
    true,
    async (a) => ({
      record: await store.getRecord(a.record_id),
      proposals: await store.listProposals(a.record_id),
    }),
  );
  add(
    "crm_create_proposal",
    "Produce an unapplied proposal. Supply data for manual organization, otherwise use configured AI. Quotes must match source verbatim. Never apply until the user has reviewed identities, times, roles, plans and facts.",
    { record_id: z.string().min(1), data: ProposalSchema.optional() },
    false,
    (a) =>
      a.data
        ? store.saveProposal(a.record_id, a.data)
        : proposeRecord(store, a.record_id, options.crmProvider),
  );
  add(
    "crm_apply_proposal",
    "Apply a reviewed proposal atomically and idempotently. Confirm every temporary person key with a stable ID plus current revision, or an explicitly reviewed new profile. Never resolve a name silently.",
    { proposal_id: z.string().min(1), ...ApplySchema.shape },
    false,
    ({ proposal_id, ...a }) => store.applyProposal(proposal_id, a),
  );
  add(
    "crm_timeline",
    "Recall interactions, facts and relationships. axis=occurred filters actual event/validity time; axis=captured filters original source time. Unknown dates stay unknown. Date-only filters are UTC; offset datetimes support local boundaries. Results include plans and explicit status, role and precision.",
    TimelineSchema.shape,
    true,
    (a) => store.timeline(a),
  );
  add(
    "crm_correct_entry",
    "Correct structured memory with audit history. Person references in saved entries are numeric stable IDs encoded as strings; quote must still match source. Raw source is unchanged.",
    { entry_id: z.string().min(1), ...CorrectionSchema.shape },
    false,
    ({ entry_id, ...a }) => store.correctEntry(entry_id, a),
  );
  add(
    "crm_history",
    "Read all revisions and reasons for a person profile or memory entry.",
    { entity_type: z.enum(["person", "entry"]), entity_id: z.string().min(1) },
    true,
    (a) => store.history(a.entity_type, a.entity_id),
  );
}
