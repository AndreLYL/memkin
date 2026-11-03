# Memkin Voice P0：本地录音到人物记忆

P0 在现有 Person CRM 上增加文件入口：录音原件 → 本地转写 → 带时间戳的源记录 → 记忆提案 → 人工确认身份 → 人物时间线。录音和转写稿默认只保存在本机。此版本不实现 Watch 客户端、自动 iCloud 导出、自动说话人分离或跨会话声纹识别。

## 数据与模型边界

- ASR 使用独立 Python 进程中的 faster-whisper；模型下载是单独命令。处理命令只接受已下载模型目录，并开启离线模式。
- faster-whisper **不提供说话人分离**。输出 `diarization: none` 和 `speaker: null`。不能把所有话标记为用户本人。
- 可以导入人工核对过、与音频 SHA256 绑定的结构化 transcript（`diarization: manual`）；标签只是本次录音的 S1/S2，不能代替 CRM 人物身份。
- 自动记忆提取仅显式连接本机 Ollama。不会读取 Memkin 的云端 LLM 凭证或自动调用其默认 provider。禁止外部地址、重定向、cloud 模型及 `/api/show` 返回远端配置的模型。
- Ollama 服务本身请用 `OLLAMA_NO_CLOUD=1` 启动，并先下载本地模型。也可完全不用 LLM，使用人工 proposal JSON。
- P0 写入的是现有 CRM 的待审核提案；只有 `voice apply --review` 中明确选择人物 ID 或新建人物后，才写入人物记忆。
- 音频原件存储在本地普通文件中，P0 没有额外应用层加密；测试建议使用 FileVault/BitLocker 保护的本地目录。放入同步目录本身会导致文件被该同步软件上传，因此本地测试不要把 archive 放在 iCloud/OneDrive 中。

## 安装和构建

需要 Node.js（建议 22 或 24）、项目依赖，以及 Python 3.11+。在仓库目录执行：

```sh
npm install
npm run build
# 首次从源码安装且需要现有 Web UI 时，再执行：
npm --prefix web install
npm --prefix web run build
python3 -m venv .venv-voice
.venv-voice/bin/python -m pip install -r services/voice/requirements.txt
.venv-voice/bin/python services/voice/worker.py download-model \
  --model small --output .voice-models/small
```

模型获取需要联网，只下载权重，不读取录音。正式转写命令不会联网下载权重。Mac M4 首轮使用 CPU/int8，先确认效果；此实现不提供 Metal 加速。PyAV 提供音频解码，通常无需额外安装 ffmpeg。Windows 的 Python 路径为 `.venv-voice/Scripts/python.exe`。

这里使用 Node.js 源码构建运行。`bun build --compile` 的单文件产物尚未包含 Python worker，P0 不支持这种打包方式。

依赖和模型目录不提交到 Git。需要更强中文识别时，另行下载 medium/large-v3 并在同一组样本上评测；不要用 tiny 的英文测试结果推断真实 Watch 中文对话质量。

## 创建隔离的本地测试配置

先将 `services/voice/local.example.yaml` 复制到仓库根目录为 `voice-p0.yaml`（不要复用唯一一份正式数据库）。其主要配置如下：

```yaml
store:
  engine: pglite
  data_dir: ./.memkin/voice-p0-db
embedding:
  provider: ollama
  base_url: http://127.0.0.1:11434
  model: nomic-embed-text
  dimensions: 768
  sweep_interval_secs: 0
llm:
  provider: mock
  model: disabled
sources:
  claude-code:
    enabled: false
  codex:
    enabled: false
  hermes:
    enabled: false
  feishu:
    enabled: false
server:
  host: 127.0.0.1
  http_port: 3937
```

`mock` 在这里用于禁止既有 CRM 的默认自动模型入口，不会生成假提案。Voice 命令有独立、显式的本地模型参数。Voice 命令本身不执行嵌入、采集器或后台同步。

PGlite 一次只允许一个进程打开。在 CLI 导入/确认时关闭使用同一测试库的 Memkin 服务；不要绕过数据库锁。完成后可用同一配置启动现有 UI 查看“随手记”和“人物档案”。复用已运行服务的 HTTP 接入属于下一阶段。

## 导入一段录音

```sh
node bin/memkin.mjs voice import /absolute/path/conversation.m4a \
  --config voice-p0.yaml \
  --captured-at '2026-11-04T14:00:00+08:00' --timezone Asia/Shanghai \
  --python .venv-voice/bin/python --model-dir .voice-models/small --language zh
```

使用真实的原始录制时间，不要把示例日期照搬到历史录音。命令输出 session ID、状态及 CRM record ID。`--language auto` 可以自动检测语种。

默认归档路径是配置所在目录的 `.memkin/voice/<session-id>/`：

```text
audio.m4a          原始字节，不转码、不删除
session.json      校验值、原始录制时间、状态、CRM IDs、证据链接
transcript.json   完整结构化转写及毫秒时间戳
transcript.txt    可读转写；长录音按发言边界拆成多条 CRM source
proposals.json    后续提取出的待确认/已确认提案
review-template.json  身份确认模板；复制为 review.json 后再编辑
summary.txt       记忆提案中的交流摘要/事实及原文依据，明确标注待确认状态
```

`source_name` 仅用于展示；内部路径由安全的 session ID 和受限扩展名生成。会话 ID 基于音频 SHA256、原始录制时间及其时区生成。改文件名不会重复导入；改变原始时间或时区会成为新会话。

## 生成人物记忆提案

可选本机 Ollama（模型需已下载，支持足够上下文和 JSON 输出）：

```sh
node bin/memkin.mjs voice propose SESSION_ID \
  --config voice-p0.yaml --model YOUR_DOWNLOADED_LOCAL_MODEL
```

本地模型是否准确需另做评测。命令将长文字拆成较小 source，再复用 `proposeRecord` 的原文证据校验；提案不会自动确认人物。`summary.txt` 是这些提案的可读导出，不是额外调用另一家服务生成的摘要。

没有本地语言模型时，按 `proposals-manual.json` 提交人工整理内容（对象键替换为导入返回的真实 record ID；证据必须逐字存在于转写稿）：

```json
{
  "RECORD_ID": {
    "people": [{"key": "p1", "name": "待确认的说话人"}],
    "entries": [{
      "kind": "interaction",
      "summary": "讨论下周的测试报告安排",
      "people": [{"ref": "p1", "role": "participant"}],
      "topics": ["测试报告"],
      "status": "planned",
      "time": {"value": null, "precision": "unknown"},
      "evidence": {"quote": "从实际转写稿逐字复制的发言"}
    }]
  }
}
```

```sh
node bin/memkin.mjs voice propose SESSION_ID --config voice-p0.yaml \
  --from-json proposals-manual.json
```

## 审核并保存到人物时间线

先检查 `proposals.json` 的内容和依据，再复制 `review-template.json` 为 `review.json`。为每个临时人物 key 明确选择：

```json
{"person_id": 42, "expected_revision": 1}
```

或者确实需要新增人物时：

```json
{"new_person": {"name": "测试参与者甲"}}
```

同一人跨 source 应选择同一个已有 ID；不要在每一部分都新建同名人物。可在现有“人物档案”先建立人物，再填写 ID。`null` 或缺失的身份映射会被拒绝。

```sh
node bin/memkin.mjs voice apply SESSION_ID --config voice-p0.yaml --review review.json
node bin/memkin.mjs voice status SESSION_ID --config voice-p0.yaml
node bin/memkin.mjs serve --config voice-p0.yaml --port 3937
```

`apply` 对每条 CRM proposal 是事务性、幂等的。长录音跨多条 proposal 时不构成单一大事务；中途失败可能已有部分完成，重新执行会继续并复用已应用结果。人物发生并发修改时，需要核对最新 revision 后重新确认。

## 恢复和证据

- 转写失败：原件已保存，`last_error` 记录失败；修好模型后重跑相同 import 命令。
- CRM 已保存而本地确认落盘失败：重跑会利用稳定 external ID 找回原记录，不再次转写、不重复产生源记录。
- LLM 不可用或输出不合法：停留在已保存的文字稿，不创建假记忆；可以改用人工整理。
- 同一个 archive 只允许一个写入者。活动 PID 的锁不按时长被抢占；同主机已退出进程的锁可在下次运行中回收。损坏/不完整锁需人工核查后恢复。
- 原始音频与 transcript 有 SHA256 校验。P0 不支持覆盖已入库转写；需要修改转写时先在导入前人工校对。已有 transcript 与新传入的 reviewed transcript 不一致会报错。
- 每条提案的证据在 `session.json` 中关联到 segment IDs，segment 中有起止时间；重复短句保留所有候选位置，不随意认定第一次出现就是唯一出处。P0 没有 Web 内嵌音频播放器。
- 归档与 CRM 数据库需成套备份。已有 CRM 原文不可删除策略保持不变；完整个人数据删除通道是正式开放前必须完成的后续工作。

## 验收范围

自动化测试使用明确标识的确定性 transcript 和合成 WAV，覆盖真实 PGlite/CRM、人工身份确认、重复导入、ASR/CRM 失败恢复、提案恢复、校验和、并发写入与本地模型边界。它们验证工程行为，不验证 ASR/声纹/摘要准确率。

首轮真实样本建议：单人中文、两人轮流讲话、三人打断、走路衣物摩擦、安静会议各一段。记录：人名/术语错误、关键事实遗漏、错归人物、时间戳偏移、处理时间。S11 的 1/4/8 小时测试另见 [Mac 与真机准备](memkin-voice-mac-setup.md)。

参考：[faster-whisper](https://github.com/SYSTRAN/faster-whisper)、[Ollama Chat API](https://docs.ollama.com/api/chat)、[现有 Person CRM](person-crm.md)。
