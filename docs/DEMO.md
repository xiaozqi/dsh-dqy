# DQY 实验结果（2026-11-07）

> 一台真机 + 一个 DSH 插件：读通知、做决策、动手操作手机、开口说话，全程有硬闸门。

## 1. 环境

| 项 | 值 |
|---|---|
| 手机 | Huawei VCE-AL00（Android 10，1080×2310） |
| QQ | 9.3.75 |
| 抖音 | 41.0.0 |
| 插件 | `dsh-dqy` 0.3.0（commit `0367126`，`link:` 安装，热加载） |
| 模型 | DSH 宿主模型通道（插件不持有 apiKey） |
| 中文输入 | ADBKeyBoard（`com.android.adbkeyboard`，已装并授权） |
| 连接 | 无线 adb `192.168.137.195:5555`（断线可自愈） |

## 2. 跑通的四件事（原始输出）

### 2.1 刷抖音
```
fish_douyin_feed(videos=3, watchMs=2500)
→ watched 3 videos, liked 2
```
真机打开抖音、连续滑 3 条、点赞 2 条；返回的是执行后的计数。

### 2.2 把视频分享给好友
```
fish_douyin_interact(action=forward, target=东隅桑榆)
→ forward done: shared with 东隅桑榆
```
分享面板是两步流程（先选人、再点「发送」）；实现里补了二次确认与「面板关闭 + 无错误提示」的校验，点不出去就报失败，不会假成功。

### 2.3 中文主动发 QQ
```
fish_app_run(app=qq, capability=message, action=sendMessage,
             params={peer:"蓝色大杂鱼", text:"演示链路自检：…09:55"})
→ ok - message sent to 蓝色大杂鱼, sent=true
```
`uiautomator dump` 独立核对：气泡文本 `09:55` 在界面中唯一出现一次（`demo/qq-send.png`）。

### 2.4 自动回 QQ 未读（值守闭环）
```
fish_qq_reply(maxConversations=2)
→ 爱上对方过后就哭了: sent -> 快了快了，就差最后一点，别急哈～
→ 爱上对方过后就哭了: sent -> 行行行，马上就好，你再等等我嘛
```
链路：识别未读红点 → 进会话 → 读消息 → 宿主模型生成中文 → 白名单放行 → ADBKeyBoard 注入 → 点发送 → 「输入框清空 + 新气泡」校验。

### 2.5 夜间自主运行
心跳默认 30 分钟一圈，LLM 决策后按动作分级；对外动作全部进确认收件箱（只读、带 TTL），示例：

```
cf_mw531u3j_805150e4 bilibili/feed/browseFeed  args {"count":3}
cf_mw533nu4_e2e5eec5 xiaohongshu/feed/browseFeed args {"count":3}
```

即：她会在没人看着的时候自己醒来、判断、提出要做什么，但**不会自己批准**，需要主人 `/confirm approve <id>`。

### 2.6 自主目标执行（不是预设脚本）

```
fish_goal("打开抖音，向上滑两条视频（每条停留两秒左右），
           然后按 Home 回到桌面，最后用一句话汇报你做了什么。")
→ completed after 7 steps: 打开抖音，向上滑了两条视频并各停留约两秒，
  然后按 Home 回到桌面，并口头汇报完成情况。
```

这是**逐屏看 + 自己决定下一步**的闭环：每一步先 `observe` 拿 UI 树，再让模型输出一个动作（tap/swipe/press_key/…），执行后再观察，直到 `finish`。7 步完成，没有人工干预。

> 演示这里顺手修了一个真实 bug：模型偶尔会在 JSON 前后带说明文字或第二个对象，旧解析器取「第一个 `{` 到最后一个 `}`」会报 `Unexpected non-whitespace character after JSON`。现在按括号配对取第一个完整对象，并加了 2 条回归测试。

## 3. 复现步骤

1. 手机开 USB 调试、连上 adb；QQ/抖音已登录。
2. DSH 里装插件：`plugin_manager install_bundle` 指向本仓库目录。
3. 配置（profile 的 `cordis.patch.yml`）：

```yaml
- id: dqy
  name: 'dsh-dqy'
  config:
    dataDir: 'C:\Users\admin\.dsh\profiles\desktop\data\dqy'
    control:
      enabled: true
      dryRun: false
      allowedPeers:
        - com.tencent.mobileqq:你的QQ好友
        - com.ss.android.ugc.aweme:抖音好友
```

4. 在会话里依次触发：`fish_observe` → `fish_douyin_feed` → `fish_douyin_interact(forward)` → `fish_app_run(qq/sendMessage)`。

## 3.5 演示顺序与预期输出（约 3 分钟）

| 步骤 | 调用 | 预期输出 | 讲解点 |
|---|---|---|---|
| 1 | `fish_observe` | 当前前台 App + 屏幕文字 + 截图路径 | 她先看，再动 |
| 2 | `fish_douyin_feed(videos=3, watchMs=2500)` | `watched 3 videos, liked N` | 真机滑屏与点赞 |
| 3 | `fish_douyin_interact(forward, 东隅桑榆)` | `forward done: shared with 东隅桑榆` | 两步分享：选人→发送，失败会如实报 |
| 4 | `fish_app_run(qq/message/sendMessage, peer=…, text=中文)` | `ok - message sent to … , sent=true` | 中文走 ADBKeyBoard，发送有气泡校验 |
| 5 | `fish_qq_reply(maxConversations=2)` | `已读: sent -> 中文回复` 或 `no unread` | 只回真实未读；公众号被过滤 |
| 6 | `fish_goal("打开抖音，滑两条视频，回桌面并汇报")` | `completed after N steps` | 逐屏决策的自主闭环 |
| 7 | `fish_confirmations` | 发送模式 + 待批动作列表 | 对外动作要主人 `/confirm approve` |

**兜底话术**

- 第 5 步返回 `no unread`：正常，讲「没有红点就不会主动打扰别人」。
- 设备掉线：报 `DEVICE_TIMEOUT` / `NO_DEVICE`，讲「工具有超时、设备调用串行、无线重连会自动重解析串号」。
- 发送被拦：把错误原文展示出来，讲「白名单失败关闭 + 错误里直接给出要加的那一行」。

## 4. 安全边界（演示时可以讲）

- **一条出站闸**：工具、自主循环、值守管道都走 `RunMode.decide()`，`/halt` 真能拦住自主循环。
- **白名单失败关闭**：不在 `control.allowedPeers` 里的人/平台一律拒绝，错误信息直接给出该加的那一行。
- **只回真实未读**：没有红点就不回；公众号/服务号行会被过滤。
- **发送要证据**：输入框清空 + 新气泡才算发出；中文注入失败会报 `INPUT_TEXT_NOT_APPLIED`。
- **进程与设备有边界**：19 个工具都有超时；所有设备调用串行化；python/adb/scrcpy 子进程有 deadline 和杀进程树。
- **确认收件箱**：模型只能看不能批；只有主人能 `/confirm approve`。

## 5. 已知限制（如实说）

- 中文输入依赖手机上已安装 ADBKeyBoard；未安装时只能发 ASCII。
- 分享目标必须是白名单里的人；「分享到微信/QQ」这类平台目标无法判定收件人，会被拦。
- 回消息只在有未读时触发；「一次运行只回一条」的守卫已实现，但需要一条新未读才能实测。
- UI 版本敏感：QQ 9.3.75 / 抖音 41.0.0 已验证；升级后选择器可能需要校准。
- 微博 / 小红书适配器仍未做真机验证（编译通过，UI 流程未跑）。

## 6. 证据文件

- `docs/qq-send.png`：QQ 会话里那条中文气泡（09:55），已随仓库提交
- 抖音截图在演示机上：`G:\Users\admin\Documents\deepseek-harness\default-workspace\demo\douyin.png`（8.4 MB，未入库）
