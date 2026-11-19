import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Extractor } from "./Extractor";
import { sampleSettings } from "../test/fixtures";

function setup() {
  const onSubmit = vi.fn();
  const onUpload = vi.fn();
  const toast = vi.fn();
  render(
    <Extractor busy={false} settings={sampleSettings} onSubmit={onSubmit} onUpload={onUpload} toast={toast} />,
  );
  return { onSubmit, onUpload, toast };
}

describe("Extractor", () => {
  it("提交链接时携带表单选项", async () => {
    const user = userEvent.setup();
    const { onSubmit, toast } = setup();

    await user.type(screen.getByPlaceholderText(/粘贴视频链接/), "https://www.bilibili.com/video/BV1test");
    await user.click(screen.getByRole("button", { name: /开始提取/ }));

    expect(toast).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe("https://www.bilibili.com/video/BV1test");
    expect(onSubmit.mock.calls[0][1]).toMatchObject({
      model: "standard",
      language: "auto",
      quality: "720",
      prefer_subtitles: true,
      download_media: true,
    });
  });

  it("空链接给出提示而不提交", async () => {
    const user = userEvent.setup();
    const { onSubmit, toast } = setup();

    await user.click(screen.getByRole("button", { name: /开始提取/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("先粘贴一个视频链接吧");
  });

  it("切换到上传文件并选择文件", async () => {
    const user = userEvent.setup();
    const { onUpload } = setup();

    await user.click(screen.getByRole("tab", { name: "上传文件" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(["demo"], "sample.wav", { type: "audio/wav" });
    await user.upload(input!, file);

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBe(file);
  });

  it("超过上限的文件直接被拦截", async () => {
    const user = userEvent.setup();
    const { onUpload, toast } = setup();

    await user.click(screen.getByRole("tab", { name: "上传文件" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const big = new File(["x"], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: sampleSettings.max_upload_mb * 1024 * 1024 + 1 });
    await user.upload(input, big);

    expect(onUpload).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("文件超过"));
  });
});
