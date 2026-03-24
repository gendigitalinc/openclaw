/**
 * Regression tests for sticky block/cancel semantics in hook mergers.
 *
 * Validates that once a higher-priority handler sets block: true (before_tool_call)
 * or cancel: true (message_sending), lower-priority handlers cannot clear it.
 *
 * See: https://github.com/openclaw/openclaw/security/advisories (hook merge override)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createHookRunner } from "./hooks.js";
import { addTestHook } from "./hooks.test-helpers.js";
import { createEmptyPluginRegistry, type PluginRegistry } from "./registry.js";
import type {
  PluginHookBeforeToolCallResult,
  PluginHookMessageSendingResult,
  PluginHookRegistration,
} from "./types.js";

function addBeforeToolCallHook(
  registry: PluginRegistry,
  pluginId: string,
  handler: () => PluginHookBeforeToolCallResult | Promise<PluginHookBeforeToolCallResult>,
  priority?: number,
) {
  addTestHook({
    registry,
    pluginId,
    hookName: "before_tool_call",
    handler: handler as PluginHookRegistration["handler"],
    priority,
  });
}

function addMessageSendingHook(
  registry: PluginRegistry,
  pluginId: string,
  handler: () => PluginHookMessageSendingResult | Promise<PluginHookMessageSendingResult>,
  priority?: number,
) {
  addTestHook({
    registry,
    pluginId,
    hookName: "message_sending",
    handler: handler as PluginHookRegistration["handler"],
    priority,
  });
}

const toolCtx = { toolName: "Bash" };
const toolEvent = { toolName: "Bash", params: { command: "echo hello" } };
const msgCtx = { channelId: "test-channel" };
const msgEvent = { to: "user", content: "hello" };

describe("before_tool_call sticky block semantics", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createEmptyPluginRegistry();
  });

  it("high-priority block is not overridden by low-priority { block: false }", async () => {
    addBeforeToolCallHook(registry, "sage", () => ({ block: true, blockReason: "dangerous" }), 100);
    addBeforeToolCallHook(registry, "other-plugin", () => ({ block: false }), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(toolEvent, toolCtx);

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toBe("dangerous");
  });

  it("blockReason from the blocking handler is preserved", async () => {
    addBeforeToolCallHook(
      registry,
      "sage",
      () => ({ block: true, blockReason: "rm -rf detected" }),
      100,
    );
    addBeforeToolCallHook(
      registry,
      "other-plugin",
      () => ({ block: false, blockReason: "looks safe" }),
      0,
    );

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(toolEvent, toolCtx);

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toBe("rm -rf detected");
  });

  it("params from lower-priority handler are ignored when blocked", async () => {
    addBeforeToolCallHook(
      registry,
      "sage",
      () => ({ block: true, blockReason: "blocked", params: { original: true } }),
      100,
    );
    addBeforeToolCallHook(
      registry,
      "other-plugin",
      () => ({ block: false, params: { injected: true } }),
      0,
    );

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(toolEvent, toolCtx);

    expect(result?.block).toBe(true);
    expect(result?.params).toEqual({ original: true });
  });

  it("low-priority block is respected when no higher-priority handler blocks", async () => {
    addBeforeToolCallHook(registry, "high-plugin", () => ({}), 100);
    addBeforeToolCallHook(registry, "low-plugin", () => ({ block: true, blockReason: "risky" }), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(toolEvent, toolCtx);

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toBe("risky");
  });

  it("no block when neither handler blocks", async () => {
    addBeforeToolCallHook(registry, "plugin-a", () => ({}), 100);
    addBeforeToolCallHook(registry, "plugin-b", () => ({}), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(toolEvent, toolCtx);

    expect(result?.block).toBeUndefined();
  });

  it("handler returning undefined block does not clear a prior block", async () => {
    addBeforeToolCallHook(registry, "sage", () => ({ block: true, blockReason: "blocked" }), 100);
    addBeforeToolCallHook(registry, "passive-plugin", () => ({}), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(toolEvent, toolCtx);

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toBe("blocked");
  });
});

describe("message_sending sticky cancel semantics", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = createEmptyPluginRegistry();
  });

  it("high-priority cancel is not overridden by low-priority { cancel: false }", async () => {
    addMessageSendingHook(registry, "guard", () => ({ cancel: true }), 100);
    addMessageSendingHook(registry, "other-plugin", () => ({ cancel: false }), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runMessageSending(msgEvent, msgCtx);

    expect(result?.cancel).toBe(true);
  });

  it("content from lower-priority handler is ignored when cancelled", async () => {
    addMessageSendingHook(registry, "guard", () => ({ cancel: true, content: "original" }), 100);
    addMessageSendingHook(
      registry,
      "other-plugin",
      () => ({ cancel: false, content: "replaced" }),
      0,
    );

    const runner = createHookRunner(registry);
    const result = await runner.runMessageSending(msgEvent, msgCtx);

    expect(result?.cancel).toBe(true);
    expect(result?.content).toBe("original");
  });

  it("low-priority cancel is respected when no higher-priority handler cancels", async () => {
    addMessageSendingHook(registry, "high-plugin", () => ({}), 100);
    addMessageSendingHook(registry, "low-plugin", () => ({ cancel: true }), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runMessageSending(msgEvent, msgCtx);

    expect(result?.cancel).toBe(true);
  });

  it("no cancel when neither handler cancels", async () => {
    addMessageSendingHook(registry, "plugin-a", () => ({}), 100);
    addMessageSendingHook(registry, "plugin-b", () => ({}), 0);

    const runner = createHookRunner(registry);
    const result = await runner.runMessageSending(msgEvent, msgCtx);

    expect(result?.cancel).toBeUndefined();
  });
});
