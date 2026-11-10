# 合成合同样例

这些 JSON 只包含虚构人物、发言和时间。它们用于 schema 和证据映射核对，不是录音、不代表真实事件，也不是可以直接执行的正式写入包。

| 文件 | 用途 |
| --- | --- |
| [transcript.synthetic.json](transcript.synthetic.json) | PR #141 TranscriptSchema v1：none/null speaker、毫秒分段、虚构内容 |
| [core-capture.synthetic.json](core-capture.synthetic.json) | main CaptureSchema，content 与上述 transcriptParts 的渲染结果一致 |
| [core-proposal.synthetic.json](core-proposal.synthetic.json) | main ProposalSchema：planned fact，证据逐字来自 capture.content |

`audio_sha256` 为 64 个 a 的占位值，没有配套音频；全零 session ID 和由此组成的 external_id 也只是示意。不能凭这些值宣称校验了真实文件，不能将其导入正式数据库。需要端到端测试时，在本机生成纯合成音频，计算真实 hash，采用真实导入返回的 session/record/proposal/person IDs。

这些文件使用现有严格 schema，不加入 `_comment`、`speaker_id` 或 UI 审核字段。样例没有 review.json：review 必须在用户实际读过将应用的 proposal 后，按 CLI 导出的 review-template.json 填写；不能预置为自动批准。

预期检查：

- transcript 的所有 start/end 在 duration_ms 内、IDs 唯一，none 下 speaker 为 null。
- 使用该分支的 transcriptParts(transcript)，输出与 capture.content 一致。
- proposal 的 evidence.quote 是 capture.content 的逐字子串。
- 计划保持 planned，valid_from/valid_until 为 unknown，不推测下周的具体日期。
- person key p1 是临时引用，不是 CRM ID；没有自动人物映射或正式 apply。

与真实代码的校验应针对 [SPEC](../SPEC.md) 中列出的固定 commit；Mac 分支变化时重新核对，不复制一套新 schema 取代源码。
