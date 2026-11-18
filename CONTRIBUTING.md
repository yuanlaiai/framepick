# 参与贡献

感谢你愿意改进帧采！无论是 Issue、文档修正还是一个平台适配，都非常欢迎。

## 开发环境

```bash
git clone <repo-url> framepick
cd framepick

python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install ruff

./run.sh
```

依赖说明：

- `ffmpeg` / `ffprobe`：转码、提取音频、截帧；
- Google Chrome：抖音、小红书免登录解析；
- 首次转写会下载 Whisper 模型（约 460 MB，`small`）。

## 目录速览

| 文件 | 职责 |
| --- | --- |
| `app/main.py` | FastAPI 路由、素材与打包下载、静态资源 |
| `app/tasks.py` | 任务队列、进度、持久化、删除清理 |
| `app/pipeline.py` | 链接 → 视频 / 音频 / 封面 → 文案 |
| `app/scrapers.py` | 抖音、小红书免登录页面解析（Playwright + Chrome） |
| `app/asr.py` | ffmpeg 解码 + faster-whisper 转写 |
| `app/subtitles.py` | 平台字幕下载与 VTT / SRT / JSON3 解析 |
| `app/textproc.py` | 标点、断句、分段与导出格式 |
| `app/platforms.py` | 链接识别与平台判断 |
| `static/` | 无构建步骤的前端 |

## 新增一个平台

1. 先确认 `yt-dlp` 是否已支持：`yt-dlp --list-extractors | grep -i 平台名`。
2. 如果支持，只需在 `app/platforms.py` 补平台识别与展示名。
3. 如果只能通过网页接口获取（如抖音、小红书），在 `app/scrapers.py` 增加一个 `xxx_info(url)`，返回统一的 info 字典：
   - 必填：`title`、`_direct_url`（视频直链）、`_headers`（UA / Referer）；
   - 建议：`description`、`tags`、`uploader`、`thumbnail`、`duration`、`*_count`、`platform_label`。
4. 在 `app/pipeline.py` 的 `fetch_info` 中接入。
5. 本地跑完整链路：解析 → 视频/音频/封面 → 转写 → 导出。

## 代码风格

- Python 3.10+，使用类型标注；逻辑尽量拆小函数，错误信息面向用户、用中文。
- 运行 `ruff check app`（配置见 `pyproject.toml`）。
- 前端保持零构建：原生 HTML/CSS/JS，不引入打包器。
- 不要提交 `data/`、模型文件、cookies、测试素材。

## 提交前自测

- [ ] `ruff check app` 通过
- [ ] `python -m compileall -q app` 通过
- [ ] 三种输入都验证：平台链接、本地视频、本地音频
- [ ] 导出 TXT / SRT / MD / ZIP 正常
- [ ] 抖音链接走通（Chrome 可用时）
- [ ] 删除任务后 `data/assets/<id>/` 被清理

## 提交 PR

1. Fork 并新建分支：`feat/xxx`、`fix/xxx`、`docs/xxx`。
2. 提交信息建议使用 Conventional Commits：`feat: 支持小红书图文笔记`。
3. PR 描述写清：改了什么、为什么、如何验证、截图（界面改动）。
4. 尽量一个 PR 只做一件事。

## 安全与隐私

- 不要在 Issue / PR 里贴完整 cookies、私人链接或未脱敏的手机号；
- 新增网络请求时优先直连，遵循现有的代理回退逻辑；
- 素材默认只落本机 `data/`，不要默认上传到第三方服务。

## 行为准则

保持友善、就事论事。对平台解析逻辑的讨论请聚焦技术实现，不鼓励绕过付费或版权限制的用法。
