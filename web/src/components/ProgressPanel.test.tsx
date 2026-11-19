import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProgressPanel } from "./ProgressPanel";

describe("ProgressPanel", () => {
  it("显示进度、阶段与步骤状态", () => {
    render(
      <ProgressPanel
        status="running"
        progress={72}
        stage="语音识别"
        message="转写进度 72%"
        upload={null}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("转写进度 72%")).toBeInTheDocument();
    // 4 个步骤始终渲染，当前阶段对应「语音识别」
    expect(screen.getAllByText("语音识别").length).toBeGreaterThan(0);
  });

  it("排队中显示队列提示", () => {
    render(
      <ProgressPanel
        status="queued"
        progress={0}
        stage="排队中"
        message="等待 Worker"
        upload={null}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("排队中")).toBeInTheDocument();
    expect(screen.getByText("正在处理其他任务，马上轮到你…")).toBeInTheDocument();
  });
});
