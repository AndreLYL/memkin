# Memkin Voice：Mac mini M4 与 Apple Watch S11 测试准备

## 现在可以完成的准备

1. 在 Mac 上记录 macOS 版本，在 iPhone/手表的“设置 → 通用 → 关于本机”记录 iOS/watchOS 版本。Mac mini M4 可作为开发机，Xcode 版本要与三者匹配。
2. 安装完整 Xcode，首次打开接受许可并安装所需组件。仅安装 Command Line Tools 不够编译 Watch App。在 Xcode 的 Components/Platforms 中安装 iOS 与 watchOS 支持。
3. 在 Xcode Settings → Accounts 登录自己的 Apple Account。后续工程选 Automatically manage signing 和自己的 Team。基础真机试验可先用免费 Personal Team；免费签名有 7 天到期等限制。iCloud 能力和 TestFlight 等需另核对开发者会员资格。
4. 将配对 S11 的 iPhone 用数据线连接 Mac，解锁并“信任此电脑”。按 Xcode 提示配对。先配对 iPhone，再确认 Watch 出现在运行目标中；设备在附近且网络允许相互发现。
5. 在 iPhone 和 Apple Watch 中开启 Developer Mode（设置 → 隐私与安全性），按提示重启并确认。若入口尚未出现，先发起 Xcode 配对。不同 Xcode 版本的设备入口可能叫 Devices and Simulators 或 Device Hub。
6. 准备 Watch 充电器，记录电池健康、开始电量、屏幕常亮设置和系统版本。测试续航时安装好程序后脱离调试器运行，避免把调试状态下的结果当日常续航。

不需要为了 P0 升级到 beta。实际 Xcode/macOS 对照以 [苹果系统要求表](https://developer.apple.com/xcode/system-requirements/)为准。设备配对参考 [苹果说明](https://developer.apple.com/documentation/xcode/pairing-your-devices-with-your-mac)，开发者模式参考 [苹果说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)，免费账户限制参考 [开发者账户说明](https://developer.apple.com/help/account/basics/about-your-developer-account)。

## 第一条录音样本不必等待自研 Watch App

在 S11 的语音备忘录录制一段 3～5 分钟测试讲话；如果涉及其他人，使用已告知并同意的测试对话。导出实际 `.m4a` 到 Mac 的普通本地文件夹，再按 [P0 使用说明](memkin-voice-p0.md)导入。

用户选择了“先不上传录音”，因此先核对语音备忘录的 iCloud 同步设置。如果启用，该系统 App 可能自动同步到 iCloud。若此次测试要求音频完全不进入云端，使用关闭相应同步的本地录制/有线导出流程，或等自研本地录音探针；不要为了测试在未知影响下批量更改/删除现有云端录音。

通过现有 App 取得样本只验证麦克风音质和后端处理，不证明我们自己的 Watch 客户端后台运行可靠。

## S11 真机测试表

| 场景 | 记录什么 |
|---|---|
| 10 分钟基础录音 | 是否完整、是否清晰、文件时长和钟表是否一致 |
| 1/4/8 小时阶梯测试 | 起止电量、发热、录音缺口、文件数量、实际录制时长 |
| 熄屏、回表盘、切其他 App | 录音是否继续；中断的准确时间 |
| 来电、Siri、耳机连接变化 | 中断原因、能否恢复、是否需要手动恢复 |
| 手机离开、断网、重新连接 | 原件是否留在手表、传输延迟、有无漏传或重复 |
| 存储不足、低电量、App 重启 | 是否有明确失败状态，已有片段能否恢复 |

WatchConnectivity 文件传输必须用真实配对设备验证，模拟器不支持完整 `transferFile` 验证。[苹果文档](https://developer.apple.com/documentation/watchconnectivity/wcsession/transferfile(_:metadata:))

P0 软件交付不包含已经编译签名的 Watch App。自研采集探针需要在这台 Mac 上构建和实测；Windows 上通过的后端测试不能替代这一步。

## 可选：只读检查脚本

在仓库中运行 `bash scripts/voice-mac-preflight.sh` 可输出芯片架构、macOS/Xcode/Node/Python 版本及 watchOS SDK 状态。脚本不修改系统、不下载内容、不输出设备序列号。iPhone/watchOS 实际版本仍需在设备上查看。
