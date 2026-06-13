import type { IFeishuHttpClient } from "../http-client.js";
import type { FeishuDriveFile } from "../types.js";
import { driveFileToCandidate } from "./candidate.js";
import type { DocCandidate, DocSourceOrigin } from "./types.js";

/**
 * Recursively walk a drive folder. docx files → candidates; folders → recurse
 * while depth budget remains. `source` describes the origin for emitted
 * candidates; `parentPath` is the human-readable breadcrumb.
 * ⚠️ CALIBRATE: file.type === "folder" / "docx" against Task 1.
 */
export async function* walkDriveFolder(
  client: IFeishuHttpClient,
  folderToken: string,
  source: DocSourceOrigin,
  parentPath: string,
  maxDepth: number,
): AsyncGenerator<DocCandidate> {
  for await (const page of client.paginate<FeishuDriveFile>("/open-apis/drive/v1/files", {
    folder_token: folderToken,
    page_size: "50",
  })) {
    for (const file of page.items) {
      if (file.type === "folder") {
        if (maxDepth > 0) {
          yield* walkDriveFolder(
            client,
            file.token,
            source,
            `${parentPath}${file.name}/`,
            maxDepth - 1,
          );
        }
        continue;
      }
      if (file.type !== "docx") continue;
      yield driveFileToCandidate(file, source, parentPath);
    }
  }
}
