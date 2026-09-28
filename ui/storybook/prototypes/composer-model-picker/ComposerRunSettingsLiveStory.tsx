import { useState } from "react";
import { ArrowUp, Bot } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { ComposerRunSettingsPicker } from "@/components/task-chat/ComposerRunSettingsPicker";
import { DEFAULT_COMPOSER_RUN_SETTINGS, mergeComposerRunSettings, type ComposerRunSettings } from "@/components/task-chat/composer-run-settings";
import { composerAgents } from "./fixtures";

const agents = new Map(composerAgents.map((fixture) => [fixture.id, {
  id: fixture.id, companyId: "storybook", name: fixture.name, role: fixture.role,
  adapterType: fixture.adapterType, adapterConfig: { ...(fixture.defaultModel ? { model: fixture.defaultModel } : {}), ...(fixture.provider === "OpenRouter" ? { provider: "openrouter" } : {}) },
  defaultEnvironmentId: null,
} as Agent]));
const options = composerAgents.map((item) => ({
  id: `agent:${item.id}`, label: item.name,
  searchText: `${item.name} ${item.role} ${item.harness} ${item.provider ?? ""}`,
}));

export interface LiveStoryProps {
  agentId?: string;
  initialModel?: string;
  initialEffort?: string;
  initialFast?: boolean;
  mobile?: boolean;
}

export function ComposerRunSettingsLiveStory({
  agentId = "codex", initialModel, initialEffort, initialFast = false, mobile = false,
}: LiveStoryProps) {
  const [assignee, setAssignee] = useState(`agent:${agentId}`);
  const [settings, setSettings] = useState<ComposerRunSettings | null>(
    initialModel || initialEffort || initialFast
      ? { model: initialModel ?? null, effort: initialEffort ?? null, fast: initialFast }
      : null,
  );
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<Array<{ body: string; agent: string; overrides: unknown }>>([]);
  const selectedAgent = composerAgents.find((item) => `agent:${item.id}` === assignee) ?? null;
  const selectedConfig = settings ?? DEFAULT_COMPOSER_RUN_SETTINGS;
  const overrides = selectedAgent ? mergeComposerRunSettings(null, selectedAgent.adapterType, selectedConfig) : null;
  return <div className="min-h-screen bg-background text-foreground">
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-8">
      <header className="flex items-center gap-3 border-b border-border pb-4"><span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Bot className="size-5" /></span><span><span className="block text-sm font-semibold">Task conversation</span><span className="block text-xs text-muted-foreground">Production composer settings control</span></span></header>
      <main className="flex flex-1 flex-col justify-end gap-5 py-8"><p className="max-w-prose text-sm">Choose the assignee, model, and effort for the task. The controls below are the real component used by the task composer.</p>{sent.map((message, index) => <div key={index} className="ml-auto max-w-prose rounded-xl bg-secondary px-4 py-3"><p className="text-sm">{message.body}</p><p className="mt-1 text-xs text-muted-foreground">To {message.agent} · {JSON.stringify(message.overrides ?? "agent default")}</p></div>)}</main>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm"><textarea aria-label="Message" placeholder={`Message ${selectedAgent?.name ?? "the task"}…`} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} className="block min-h-16 w-full resize-y bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground" />
        <div className="mt-3 flex min-w-0 items-center justify-end gap-2 border-t border-border pt-3">
          <ComposerRunSettingsPicker companyId="storybook" assigneeValue={assignee} currentAssigneeValue={assignee} options={options} agents={agents} settings={settings} onSettingsChange={setSettings} onAssigneeChange={(value) => { setAssignee(value); setSettings(null); }} mobile={mobile}
            modelOptionsOverride={selectedAgent?.models.map(({ id, label }) => ({ id, label })) ?? []} />
          <button type="button" aria-label="Send message" disabled={!draft.trim()} onClick={() => { setSent((current) => [...current, { body: draft.trim(), agent: selectedAgent?.name ?? "No assignee", overrides }]); setDraft(""); }} className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp className="size-4" /></button>
        </div>
      </div>
    </div>
  </div>;
}
