import { useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Plus, RotateCcw, Search, SlidersHorizontal, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { composerAgents, effortChoices, effortLabels, fastModeAvailable, modelLabel, type ComposerAgent } from "./fixtures";
import "./picker.css";

export type ComposerModelPickerPreviewProps = {
  agentId?: string;
  initialModel?: string;
  initialEffort?: string;
  initialFast?: boolean;
  initialPanel?: "closed" | "settings" | "models" | "agents";
  initialSearch?: string;
  compact?: boolean;
};

type SentMessage = { text: string; agent: string; model: string | null; effort: string | null; fast: boolean };

function AgentMark({ agent }: { agent: ComposerAgent }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground" aria-hidden>{agent.name.slice(0, 1)}</span>;
}

function ModelRow({ option, selected, onSelect }: {
  option: { id: string; label: string; detail?: string };
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={() => onSelect(option.id)}
      className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{option.label}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{option.id}</span>
      </span>
      {option.detail ? <span className="shrink-0 text-xs text-muted-foreground">{option.detail}</span> : null}
      {selected ? <Check className="composer-picker-accent size-4 shrink-0" aria-hidden /> : null}
    </button>
  );
}

export function ComposerModelPickerPreview({
  agentId = "codex", initialModel, initialEffort, initialFast = false,
  initialPanel = "closed", initialSearch = "", compact = false,
}: ComposerModelPickerPreviewProps) {
  const [agent, setAgent] = useState<ComposerAgent>(composerAgents.find((item) => item.id === agentId) ?? composerAgents[0]);
  const [modelOverride, setModelOverride] = useState<string | null>(initialModel ?? null);
  const [effortOverride, setEffortOverride] = useState<string | null>(initialEffort ?? null);
  const [fast, setFast] = useState(initialFast);
  const [agentOpen, setAgentOpen] = useState(initialPanel === "agents");
  const [pickerOpen, setPickerOpen] = useState(initialPanel === "settings" || initialPanel === "models");
  const [view, setView] = useState<"settings" | "models">(initialPanel === "models" ? "models" : "settings");
  const [search, setSearch] = useState(initialSearch);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<SentMessage[]>([]);

  const model = modelOverride ?? agent.defaultModel ?? "";
  const choices = effortChoices(agent, model);
  const effectiveEffort = effortOverride && choices.includes(effortOverride) ? effortOverride : null;
  const effortIndex = effectiveEffort ? choices.indexOf(effectiveEffort) + 1 : 0;
  const effortLabel = effectiveEffort ? effortLabels[effectiveEffort] ?? effectiveEffort : "Default";
  const fastAvailable = fastModeAvailable(agent, model);
  const customModel = Boolean(model && !agent.models.some((option) => option.id === model));
  const modelAvailable = Boolean(agent.defaultModel || agent.models.length || agent.manualPattern);
  const query = search.trim();
  const filtered = agent.models.filter((option) =>
    `${option.label} ${option.id} ${option.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const exactCatalogMatch = agent.models.some((option) => option.id.toLowerCase() === query.toLowerCase());
  const manualValid = query.length > 0 && !/\s/.test(query)
    && (agent.provider !== "OpenRouter" || query.startsWith("openrouter/"));

  function reset() {
    setModelOverride(null);
    setEffortOverride(null);
    setFast(false);
  }

  function chooseModel(next: string | null) {
    setModelOverride(next);
    setEffortOverride(null);
    setFast(false);
    setSearch("");
    setView("settings");
  }

  function chooseAgent(next: ComposerAgent) {
    setAgent(next);
    reset();
    setSearch("");
    setAgentOpen(false);
    setPickerOpen(false);
  }

  function send() {
    if (!draft.trim()) return;
    setMessages((current) => [...current, {
      text: draft.trim(), agent: agent.name, model: model || null,
      effort: effectiveEffort, fast: fast && fastAvailable,
    }]);
    setDraft("");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className={cn("mx-auto flex min-h-screen w-full flex-col px-4 py-6 sm:px-8", compact ? "max-w-md" : "max-w-4xl")}>
        <header className="flex items-center gap-3 border-b border-border pb-4">
          <span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Bot className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Agent conversation</span>
            <span className="block text-xs text-muted-foreground">Model and effort can be chosen for the next message</span>
          </span>
        </header>

        <main className="flex flex-1 flex-col justify-end gap-5 py-8">
          <div className="max-w-prose space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{agent.name} · {agent.role}</p>
            <p className="text-sm leading-relaxed">I can take the next step. Pick the model and effort you want me to use, then send your instructions.</p>
          </div>
          {messages.map((message, index) => (
            <div key={index} className="ml-auto max-w-prose rounded-xl bg-secondary px-4 py-3">
              <p className="text-sm">{message.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">To {message.agent}{message.model ? ` · ${message.model}` : ""}{message.effort ? ` · ${effortLabels[message.effort] ?? message.effort}` : ""}{message.fast ? " · Fast" : ""}</p>
            </div>
          ))}
        </main>

        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
            placeholder={`Message ${agent.name} — describe what you want done…`}
            aria-label="Message" rows={2}
            className="block min-h-16 w-full resize-y bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground" />
          <div className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-border/50 pt-3">
            <button type="button" aria-label="Attach file (preview only)" title="Attach file (preview only)" className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"><Plus className="size-4" aria-hidden /></button>
            <span className="hidden rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground sm:inline-flex">Auto mode</span>
            <span className="hidden min-w-0 flex-1 sm:block" />

            <Popover open={agentOpen} onOpenChange={(open) => { setAgentOpen(open); if (open) setPickerOpen(false); }}>
              <PopoverTrigger asChild>
                <button type="button" aria-label="Select agent" className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="hidden sm:inline-flex"><AgentMark agent={agent} /></span>
                  <span className="max-w-20 truncate">{agent.name}</span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-80 p-2" data-testid="composer-agent-menu">
                <div className="px-2 py-1.5">
                  <p className="text-xs font-semibold">Choose agent</p>
                  <p className="text-xs text-muted-foreground">Each agent keeps its configured harness.</p>
                </div>
                <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="Agents">
                  {composerAgents.map((item) => <button type="button" role="option" aria-selected={agent.id === item.id} key={item.id} onClick={() => chooseAgent(item)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                    <AgentMark agent={item} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.role}</span></span>
                    <span className="text-xs text-muted-foreground">{item.harness}</span>
                    {agent.id === item.id ? <Check className="composer-picker-accent size-3.5" aria-hidden /> : null}
                  </button>)}
                </div>
              </PopoverContent>
            </Popover>

            {modelAvailable ? (
              <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (open) setAgentOpen(false); else { setView("settings"); setSearch(""); } }}>
                <PopoverTrigger asChild>
                  <button type="button" aria-label="Select model and effort" className="flex h-8 min-w-0 max-w-48 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="composer-model-trigger">
                    {fast && fastAvailable ? <Zap className="composer-picker-accent size-3.5 shrink-0" aria-hidden /> : <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 truncate">{modelLabel(agent, model)}</span>
                    {effectiveEffort ? <span className="hidden shrink-0 text-muted-foreground sm:inline">{effortLabel}</span> : null}
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" sideOffset={8} className="w-80 max-w-full p-0 shadow-sm" data-testid="composer-model-popover">
                  {view === "settings" ? (
                    <div className="p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">Run settings</p>
                          <p className="truncate text-xs text-muted-foreground">{agent.harness}{agent.provider ? ` · ${agent.provider}` : ""}</p>
                        </div>
                        <button type="button" onClick={reset} aria-label="Reset model and effort to agent default" title="Reset to agent default" disabled={!modelOverride && !effortOverride && !fast} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"><RotateCcw className="size-3.5" aria-hidden /></button>
                      </div>
                      <button type="button" onClick={() => setView("models")} className="mt-3 flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Choose exact model">
                        <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">Model</span><span className="block truncate text-sm font-medium">{modelLabel(agent, model)}</span></span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                      {choices.length ? (
                        <div className="mt-4 border-t border-border pt-3">
                          <div className="flex items-center justify-between gap-2">
                            <label htmlFor="composer-effort" className="text-xs text-muted-foreground">{agent.adapterType === "pi_local" ? "Thinking" : "Effort"}</label>
                            <span className="composer-picker-accent text-sm font-medium" data-testid="selected-effort">{effortLabel}</span>
                          </div>
                          <input id="composer-effort" type="range" min={0} max={choices.length} step={1} value={effortIndex}
                            aria-valuetext={effortLabel} onChange={(event) => setEffortOverride(Number(event.target.value) === 0 ? null : choices[Number(event.target.value) - 1])}
                            className="composer-effort-range mt-4 w-full" style={{ "--fill": `${(effortIndex / choices.length) * 100}%` } as CSSProperties} />
                          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>Default</span><span>{effortLabels[choices[choices.length - 1]] ?? choices[choices.length - 1]}</span></div>
                          <div className="mt-2 flex flex-wrap gap-1" aria-label="Available effort levels">
                            {choices.map((choice) => <button key={choice} type="button" onClick={() => setEffortOverride(choice)} aria-pressed={effectiveEffort === choice} className={cn("rounded-md px-1.5 py-1 text-xs hover:bg-accent", effectiveEffort === choice ? "bg-primary text-primary-foreground hover:bg-primary" : "text-muted-foreground")}>{effortLabels[choice] ?? choice}</button>)}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="effort-unavailable">
                          {agent.adapterType === "kimi_local" ? "This Kimi model does not advertise effort levels. It will use its own default." : agent.adapterType === "opencode_local" ? "Effort levels are not advertised for this OpenRouter model. It will use the model default." : customModel ? "Effort levels are unknown for this custom model. It will use the model default." : "This harness does not expose a per-message effort setting."}
                        </div>
                      )}
                      {fastAvailable ? <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-border pt-3 text-sm"><Zap className="composer-picker-accent size-4" aria-hidden /><span className="min-w-0 flex-1"><span className="block text-xs font-medium">Fast mode</span><span className="block text-xs text-muted-foreground">Faster responses · higher usage</span></span><input type="checkbox" checked={fast} onChange={(event) => setFast(event.target.checked)} aria-label="Fast mode" className="composer-picker-checkbox size-4" /></label> : null}
                      {(modelOverride || effortOverride || fast) ? <p className="mt-3 text-xs text-muted-foreground">These settings apply to the next message. <button type="button" onClick={reset} className="font-medium text-foreground underline underline-offset-2">Reset to agent default</button></p> : null}
                    </div>
                  ) : (
                    <div className="p-2">
                      <div className="flex items-center gap-2 px-1 py-1.5"><button type="button" onClick={() => { setView("settings"); setSearch(""); }} aria-label="Back to run settings" className="grid size-7 place-items-center rounded-md hover:bg-accent"><ArrowLeft className="size-4" aria-hidden /></button><div className="min-w-0"><p className="text-xs font-semibold">Choose model</p><p className="truncate text-xs text-muted-foreground">{agent.harness}{agent.provider ? ` · ${agent.provider}` : ""}</p></div></div>
                      <div className="relative mt-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden /><input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && manualValid && !exactCatalogMatch) chooseModel(query); }} placeholder="Search or paste a model ID" aria-label="Search or paste a model ID" className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /></div>
                      <div className="mt-2 max-h-60 overflow-y-auto" role="listbox" aria-label={`${agent.harness} models`}>
                        {!query ? <button type="button" role="option" aria-selected={modelOverride === null} onClick={() => chooseModel(null)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"><span className="min-w-0 flex-1"><span className="block text-sm font-medium">Use agent default</span><span className="block truncate text-xs text-muted-foreground">{modelLabel(agent, agent.defaultModel ?? "")}</span></span>{modelOverride === null ? <Check className="composer-picker-accent size-4" aria-hidden /> : null}</button> : null}
                        {filtered.map((option) => <ModelRow key={option.id} option={option} selected={modelOverride === option.id} onSelect={(id) => chooseModel(id)} />)}
                        {!filtered.length && query ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No catalog match.</p> : null}
                      </div>
                      {query && !exactCatalogMatch ? <div className="mt-2 border-t border-border pt-2"><button type="button" disabled={!manualValid} onClick={() => chooseModel(query)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"><Plus className="size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate">Use exact ID <span className="font-mono font-semibold">{query}</span></span></button>{!manualValid ? <p className="px-2.5 text-xs text-destructive">{agent.provider === "OpenRouter" ? "Use openrouter/provider/model with no spaces." : "Model IDs cannot contain spaces."}</p> : null}</div> : null}
                      <p className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">{agent.manualPattern ? `Custom IDs: ${agent.manualPattern}. Provider access is checked when the run starts.` : "Only models for this harness are shown."}</p>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : <span className="hidden max-w-40 truncate rounded-full bg-muted px-2.5 py-1.5 text-xs text-muted-foreground sm:inline-flex" title={agent.noModelReason}>Model set by harness</span>}
            <button type="button" onClick={send} disabled={!draft.trim()} aria-label="Send message" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp className="size-4" aria-hidden /></button>
          </div>
        </div>
        {!modelAvailable ? <p className="mt-2 text-right text-xs text-muted-foreground">{agent.noModelReason}</p> : null}
      </div>
    </div>
  );
}
