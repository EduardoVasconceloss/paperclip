import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ComposerModelPickerPreview } from "../prototypes/composer-model-picker/ComposerModelPickerPreview";

const meta = {
  title: "Tasks/Composer/Model and effort picker",
  component: ComposerModelPickerPreview,
  parameters: {
    layout: "fullscreen",
    options: { showPanel: false },
    docs: { description: { component:
      "Interactive design proposal for choosing a model beside the agent in the task composer. The agent determines the harness and catalog; changing agents clears per-message overrides. Effort uses model-specific choices only where known. Custom IDs are accepted for harnesses that support them, while OpenRouter requires openrouter/provider/model. Fast mode appears only for supported known Codex models. These stories use local fixture state; composer selections are not wired to task execution yet."
    } },
  },
  args: { agentId: "codex", initialPanel: "closed" },
  render: (args) => <ComposerModelPickerPreview key={JSON.stringify(args)} {...args} />,
} satisfies Meta<typeof ComposerModelPickerPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultComposer: Story = {
  name: "01 · Agent and model side by side",
};
export const EffortSlider: Story = {
  name: "02 · Codex effort slider",
  args: { initialPanel: "settings", initialEffort: "high" },
};
export const ExactEffort: Story = {
  name: "02b · Select an exact effort",
  args: { initialPanel: "settings" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getAllByText("Extra High", { exact: true }).at(-1)!);
    await expect(screen.getByTestId("selected-effort")).toHaveTextContent("Extra High");
  },
};
export const ExactModelList: Story = {
  name: "03 · Search exact Codex models",
  args: { initialPanel: "models" },
};
export const AstraFastMode: Story = {
  name: "04 · Astra · six efforts and fast mode",
  args: { initialModel: "gpt-6-astra", initialEffort: "ultra", initialFast: true, initialPanel: "settings" },
};
export const FastModeUnavailable: Story = {
  name: "05 · Model without fast mode",
  args: { initialModel: "gpt-5.4-mini", initialPanel: "settings" },
};
export const CodexCustomUnknown: Story = {
  name: "05b · Custom Codex ID · capabilities unknown",
  args: { initialModel: "my-private-codex-model", initialPanel: "settings" },
};
export const ResetToAgentDefault: Story = {
  name: "06 · Reset model and effort",
  args: { initialModel: "gpt-6-astra", initialEffort: "ultra", initialFast: true, initialPanel: "settings" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole("button", { name: "Reset model and effort to agent default" }));
    await expect(screen.getByTestId("selected-effort")).toHaveTextContent("Default");
    await expect(screen.getByRole("button", { name: "Choose exact model" })).toHaveTextContent("GPT-5.6 Sol");
    await expect(screen.getByRole("checkbox", { name: "Fast mode" })).not.toBeChecked();
  },
};
export const Claude: Story = {
  name: "07 · Claude Code · low to high",
  args: { agentId: "claude", initialPanel: "settings", initialEffort: "medium" },
};
export const OpenRouterSearch: Story = {
  name: "08 · OpenRouter · search this provider",
  args: { agentId: "openrouter", initialPanel: "models", initialSearch: "deepseek" },
};
export const OpenRouterCustomId: Story = {
  name: "09 · OpenRouter · pasted custom ID",
  args: { agentId: "openrouter", initialModel: "openrouter/qwen/qwen3-coder-next", initialPanel: "settings" },
};
export const OpenRouterManualEntry: Story = {
  name: "10 · OpenRouter · type exact model",
  args: { agentId: "openrouter", initialPanel: "models", initialSearch: "openrouter/qwen/qwen3-coder-next" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole("button", { name: /Use exact ID/ }));
    await expect(screen.getByRole("button", { name: "Choose exact model" })).toHaveTextContent("openrouter/qwen/qwen3-coder-next");
    await expect(screen.getByTestId("effort-unavailable")).toHaveTextContent("model default");
  },
};
export const OpenRouterPasteProposal: Story = {
  name: "10b · OpenRouter · paste proposal",
  args: { agentId: "openrouter", initialPanel: "models", initialSearch: "openrouter/qwen/qwen3-coder-next" },
};
export const OpenRouterInvalidId: Story = {
  name: "10c · OpenRouter · invalid ID guidance",
  args: { agentId: "openrouter", initialPanel: "models", initialSearch: "anthropic/claude-sonnet-4.6" },
};
export const PiThinking: Story = {
  name: "11 · Pi · thinking levels",
  args: { agentId: "pi", initialPanel: "settings", initialEffort: "high" },
};
export const KimiSupported: Story = {
  name: "12 · Kimi K3 · low, high, max",
  args: { agentId: "kimi", initialPanel: "settings", initialEffort: "high" },
};
export const KimiModelDefault: Story = {
  name: "13 · Kimi K2.7 · no effort override",
  args: { agentId: "kimi", initialModel: "kimi-code/kimi-for-coding", initialPanel: "settings" },
};
export const GeminiModelOnly: Story = {
  name: "14 · Gemini · model only",
  args: { agentId: "gemini", initialPanel: "settings" },
};
export const CursorModelOnly: Story = {
  name: "15 · Cursor · model only",
  args: { agentId: "cursor", initialPanel: "settings" },
};
export const CursorCloudManual: Story = {
  name: "15b · Cursor Cloud · manual model ID",
  args: { agentId: "cursor-cloud", initialPanel: "models" },
};
export const RunnerCodexProfile: Story = {
  name: "16 · Runner · Codex profile",
  args: { agentId: "runner", initialPanel: "models" },
};
export const GrokModelOnly: Story = {
  name: "17 · Grok · model only",
  args: { agentId: "grok", initialPanel: "settings" },
};
export const HermesManual: Story = {
  name: "17b · Hermes CLI · manual model ID",
  args: { agentId: "hermes", initialPanel: "models" },
};
export const ProcessNoModel: Story = {
  name: "18 · Process · no model setting",
  args: { agentId: "process" },
};
export const HttpNoModel: Story = {
  name: "18b · HTTP · remote model",
  args: { agentId: "http" },
};
export const GatewayNoModel: Story = {
  name: "19 · OpenClaw · remote model",
  args: { agentId: "openclaw" },
};
export const HermesGatewayNoModel: Story = {
  name: "19b · Hermes Gateway · remote model",
  args: { agentId: "hermes-gateway" },
};
export const AgentMenu: Story = {
  name: "20 · Choose agent, keep harness",
  args: { initialPanel: "agents" },
};
export const AgentSwitchClearsOverrides: Story = {
  name: "20b · Switching agents resets overrides",
  args: { initialModel: "gpt-6-astra", initialEffort: "ultra", initialFast: true, initialPanel: "agents" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole("option", { name: /Nora/ }));
    await userEvent.click(screen.getByRole("button", { name: "Select model and effort" }));
    await expect(screen.getByRole("button", { name: "Choose exact model" })).toHaveTextContent("Claude Sonnet 4.6");
    await expect(screen.getByTestId("effort-unavailable")).toHaveTextContent("model default");
    await expect(screen.queryByRole("checkbox", { name: "Fast mode" })).toBeNull();
  },
};
export const Mobile: Story = {
  name: "21 · Mobile · picker above composer",
  args: { agentId: "codex", initialPanel: "settings", compact: true },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
export const Light: Story = {
  name: "22 · Light theme",
  args: { agentId: "claude", initialPanel: "settings" },
  globals: { theme: "light" },
};
