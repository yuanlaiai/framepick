import { describe, expect, it } from "vitest";

import { assetUrl, captionText, fmtCount, fmtDuration, fmtSize, prettyEngine } from "./format";

describe("format", () => {
  it("格式化时长", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(65)).toBe("1:05");
    expect(fmtDuration(3661)).toBe("1:01:01");
  });

  it("格式化文件体积", () => {
    expect(fmtSize(undefined)).toBe("");
    expect(fmtSize(512)).toBe("512 B");
    expect(fmtSize(204800)).toBe("200 KB");
    expect(fmtSize(1048576)).toBe("1.0 MB");
  });

  it("格式化互动数据", () => {
    expect(fmtCount(980)).toBe("980");
    expect(fmtCount(12345)).toBe("1.2 万");
    expect(fmtCount(0)).toBe("");
    expect(fmtCount(null)).toBe("");
  });

  it("转换引擎名称", () => {
    expect(prettyEngine("whisper-small")).toBe("Whisper small");
    expect(prettyEngine("platform-subtitles")).toBe("平台字幕");
    expect(prettyEngine("")).toBe("");
  });

  it("拼接发布文案并补全话题井号", () => {
    expect(captionText("标题", "描述", ["测试", "#视频"])).toBe("标题\n\n描述\n\n#测试 #视频");
    expect(captionText("标题", "", [])).toBe("标题");
  });

  it("下载地址强制走附件", () => {
    expect(assetUrl("abc", "audio")).toBe("/api/tasks/abc/asset/audio?download=1");
  });
});
