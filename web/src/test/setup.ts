import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 每个用例结束后卸载组件，避免 DOM 在用例之间互相污染
afterEach(() => {
  cleanup();
  localStorage.clear();
});
