import { INTERNAL_MESSAGE_CHANNEL, isInternalMessageChannel } from "../utils/message-channel.js";
import { callGatewayTool } from "./tools/gateway.js";

type ExecApprovalFollowupParams = {
  approvalId: string;
  sessionKey?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
  resultText: string;
};

export function buildExecApprovalFollowupPrompt(resultText: string): string {
  return [
    "An async command the user already approved has completed.",
    "Do not run the command again.",
    "",
    "Exact completion details:",
    resultText.trim(),
    "",
    "Reply to the user in a helpful way.",
    "If it succeeded, share the relevant output.",
    "If it failed, explain what went wrong.",
  ].join("\n");
}

export async function sendExecApprovalFollowup(
  params: ExecApprovalFollowupParams,
): Promise<boolean> {
  const sessionKey = params.sessionKey?.trim();
  const resultText = params.resultText.trim();
  if (!sessionKey || !resultText) {
    return false;
  }

  const channel = params.turnSourceChannel?.trim();
  const to = params.turnSourceTo?.trim();
  const threadId =
    params.turnSourceThreadId != null && params.turnSourceThreadId !== ""
      ? String(params.turnSourceThreadId)
      : undefined;

  // Webchat (internal channel) has no outbound delivery route — the gateway would
  // try to remap it to a configured external channel and fail. Skip delivery for
  // internal channels and explicitly route the agent run to the internal channel.
  const hasExternalDeliveryPair = Boolean(channel && to) && !isInternalMessageChannel(channel);

  await callGatewayTool(
    "agent",
    { timeoutMs: 60_000 },
    {
      sessionKey,
      message: buildExecApprovalFollowupPrompt(resultText),
      deliver: hasExternalDeliveryPair,
      bestEffortDeliver: true,
      channel: hasExternalDeliveryPair
        ? channel
        : isInternalMessageChannel(channel)
          ? INTERNAL_MESSAGE_CHANNEL
          : undefined,
      to: hasExternalDeliveryPair ? to : undefined,
      accountId: hasExternalDeliveryPair
        ? params.turnSourceAccountId?.trim() || undefined
        : undefined,
      threadId: hasExternalDeliveryPair ? threadId : undefined,
      idempotencyKey: `exec-approval-followup:${params.approvalId}`,
    },
    { expectFinal: true },
  );

  return true;
}
