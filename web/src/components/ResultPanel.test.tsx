import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ResultPanel } from "./ResultPanel";
import { sampleResult } from "../test/fixtures";

describe("ResultPanel", () => {
  it("渲染标题、统计、文案与音频", () => {
    render(<ResultPanel result={sampleResult} onDelete={vi.fn()} toast={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("测试视频");
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("这是一段发布文案 #测试")).toBeInTheDocument();
    expect(screen.getByText("#视频")).toBeInTheDocument();

    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("/api/tasks/task-1/asset/audio");
  });

  it("可以在纯文本与时间轴之间切换", async () => {
    const user = userEvent.setup();
    render(<ResultPanel result={sampleResult} onDelete={vi.fn()} toast={vi.fn()} />);

    expect(screen.getByText("第一句话。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "时间轴" }));

    // 时间轴视图会显示每条段落的时间戳
    expect(screen.getAllByText("0:00").length).toBeGreaterThan(0);
    expect(screen.getByText("0:05")).toBeInTheDocument();
  });
});
