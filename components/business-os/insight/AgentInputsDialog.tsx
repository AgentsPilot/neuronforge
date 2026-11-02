'use client';

/**
 * The questions an agent has to have answered before it is created.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASKED FIRST, NOT AFTERWARDS.
 *
 * Most agents in the catalogue need nothing but a schedule, and the card
 * installs those with one press. An agent that reads a spreadsheet is
 * different: created without knowing which one, it is active, scheduled, and
 * unable to do anything, with nothing on screen explaining why. So the press
 * opens this instead, and the agent is created only once it can work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONNECTING HAPPENS HERE, NOT SOMEWHERE ELSE.
 *
 * The first version sent an owner whose Sheets was not connected off to the
 * plugin settings page and left them to find their own way back. That is the
 * worst moment to hand somebody a navigation problem: they have just said what
 * they want and the answer was "go elsewhere first".
 *
 * So a missing or expired connection is reported INSIDE the dialog with its
 * own Connect button, through `usePluginRepair` — the same hook the readiness
 * line uses, which tries a silent token refresh before a full OAuth round trip.
 * When it succeeds the plugin list refreshes, the prompt disappears and the
 * dropdowns fill in, with the dialog never closing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT FETCHES ITS OWN OPTIONS
 *
 * The usual path derives a field's dropdown from the agent's own plan, which is
 * no help here: there is no agent yet, and the whole point is to collect
 * answers before there is one. `/api/plugins/fetch-options` wants a plugin, an
 * action and a parameter and takes no agent id, so the catalogue entry states
 * that triple per field and this asks directly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY ONE FIELD WAITS FOR ANOTHER
 *
 * "Which tab" cannot be answered before "which spreadsheet", and asking Google
 * for the tabs of nothing returns nothing — which on screen is an empty
 * dropdown that looks broken rather than one that is waiting. A field with
 * `dependsOn` stays disabled until those values exist, sends them as
 * `dependentValues`, and reloads whenever they change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check } from 'lucide-react';

import { useAuth } from '@/components/UserProvider';
import { usePluginRepair } from '@/hooks/usePluginRepair';
import { PluginIcon } from '@/components/PluginIcon';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface AgentInput {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  options?: {
    plugin: string;
    action: string;
    parameter: string;
    dependsOn?: string[];
  };
}

interface Choice {
  value: string;
  label: string;
}

export function AgentInputsDialog({
  open,
  agentName,
  inputs,
  plugins,
  connectEither,
  busy,
  onCancel,
  onConfirm,
  t,
}: {
  open: boolean;
  agentName: string;
  inputs: AgentInput[];
  /** Everything the plan calls. `business-os` is ours and never connected. */
  plugins: string[];
  /**
   * ANY ONE OF THESE WILL DO, so the owner is asked which rather than told.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Some agents exist once per provider — drafting replies reads a mailbox, and
   * Gmail and Outlook are the same job through different APIs. The owner is
   * offered one row, and which provider it means normally follows whatever they
   * have connected.
   *
   * When they have connected NEITHER there is nothing to follow, and before
   * this the dialog simply named one of them: an owner who runs their business
   * on Outlook was told to connect Gmail, with no way in this dialog to say
   * otherwise. They had to leave, find the plugins page, and come back.
   *
   * So the question is asked here instead. Each entry carries the
   * `automationId` its provider implies, and connecting one IS choosing it —
   * one act, not a choice followed by a connection. Absent whenever something
   * is already connected, because then it is not a question.
   * ───────────────────────────────────────────────────────────────────────────
   */
  connectEither?: { plugin: string; automationId: string; connected: boolean }[];
  busy: boolean;
  onCancel: () => void;
  /** The chosen variant, when the dialog asked. Absent means the row's own. */
  onConfirm: (values: Record<string, string>, automationId?: string) => void;
  t: (key: string) => string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, Choice[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  /*
   * Plugins this owner has not connected, learned from the options endpoint
   * rather than guessed. It answers 404 with "No active connection found" and
   * swallowing that gave an empty dropdown — which reads as "you have no
   * spreadsheets" when the truth is "we were never allowed to look".
   */
  const [notConnected, setNotConnected] = useState<Record<string, boolean>>({});

  /*
   * Which provider the owner picked, learned from what they CONNECTED rather
   * than from a radio button they also have to press. Stays null when the
   * dialog never asked, and the install then uses the row's own automation.
   */
  const [chosen, setChosen] = useState<string | null>(null);

  const { connectedPlugins, refreshPlugins } = useAuth();
  const { repairing, repair } = usePluginRepair();

  const isLive = (key: string) =>
    Boolean(connectedPlugins?.[key]) && !connectedPlugins?.[key]?.is_expired;

  /*
   * THE EITHER-OR, SETTLED BY WHATEVER IS LIVE.
   *
   * Read from the live plugin map rather than from the answer the server gave
   * when the dialog opened, so connecting one inside the dialog satisfies it
   * immediately — the same refresh that shrinks `needed` closes this too, with
   * no second round trip. A provider connected in another tab counts as well,
   * which is correct and free.
   */
  const either = connectEither ?? [];

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * NOTHING IS PRE-SELECTED, AND THAT IS THE CORRECTION.
   *
   * A first version defaulted to whichever mailbox was already connected, so
   * the owner "did not have to think about it". That assumed a connection
   * means consent, and it does not: PLUGIN CONNECTIONS ARE SHARED ACROSS THE
   * WHOLE PLATFORM. A business may have connected Gmail for the website
   * enquiry channel, or a workflow, or last year's experiment, while their
   * actual client correspondence runs through Outlook. Gmail being connected
   * says the agent COULD read it, never that it should.
   *
   * Getting this wrong is not a cosmetic default either. The agent reads a
   * mailbox, works out who is a client and drafts replies — pointed at the
   * wrong one it reads correspondence the owner never offered it, and drafts
   * nothing useful. So the question is asked, and `isLive` only tells them
   * which answer costs an extra step.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const selected = either.find(c => c.automationId === chosen);
  const eitherOpen = either.length > 0 && !(selected && isLive(selected.plugin));

  /*
   * What still has to be connected before any of this can be answered.
   *
   * Two states, one answer. A plugin absent from the map was never connected;
   * one present with `is_expired` was connected and lapsed. The owner does the
   * same thing about both, and `repair` handles the difference — a silent
   * token refresh first, OAuth only if that is dead too.
   *
   * `business-os` is excluded: it is us, it has no vendor and nothing to
   * connect, and counting it would block every agent on the platform.
   */
  const needed = useMemo(
    () =>
      plugins
        .filter(p => p !== 'business-os')
        /*
         * MINUS THE EITHER-OR SET, or the row's own provider would be demanded
         * outright and the choice below would be decoration: `plugins` names
         * the default variant's mailbox, so leaving it here would tell an
         * Outlook owner to connect Gmail in one block while the next block
         * offered them Outlook. The requirement is real but it is "one of
         * these", which `eitherOpen` carries instead.
         */
        .filter(p => !either.some(c => c.plugin === p))
        .filter(p => !connectedPlugins?.[p] || connectedPlugins[p]?.is_expired),
    [plugins, connectedPlugins, connectEither]
  );

  /* `google-sheets` reads badly in a sentence. The connected entry carries a
     real name; for one that was never connected there is nothing to read, so
     the key is tidied rather than left as a slug. */
  const nameOf = (key: string) =>
    connectedPlugins?.[key]?.displayName ||
    connectedPlugins?.[key]?.name ||
    key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  /* A fresh dialog each time. Left alone, the spreadsheet chosen for one agent
     would still be selected when a different one is opened. */
  useEffect(() => {
    if (!open) {
      setValues({});
      setChoices({});
      setNotConnected({});
    }
  }, [open]);

  const load = useCallback(
    async (field: AgentInput, dependentValues: Record<string, string>) => {
      if (!field.options) return;

      setLoading(prev => ({ ...prev, [field.name]: true }));
      try {
        const response = await fetch('/api/plugins/fetch-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plugin: field.options.plugin,
            action: field.options.action,
            parameter: field.options.parameter,
            dependentValues,
          }),
        });

        if (!response.ok) {
          /*
           * 404 here means one specific thing and the route says so: no active
           * connection for this plugin. It is the only failure the owner can
           * act on, and the action is a button, so it is told apart from every
           * other way a fetch can fail.
           */
          if (response.status === 404) {
            setNotConnected(prev => ({ ...prev, [field.options!.plugin]: true }));
          }
          setChoices(prev => ({ ...prev, [field.name]: [] }));
          return;
        }

        setNotConnected(prev => ({ ...prev, [field.options!.plugin]: false }));

        const body = await response.json();
        /*
         * Three shapes, because the endpoint serves many plugins and they do
         * not agree. Normalised here rather than in each caller, and anything
         * unrecognised becomes an empty list — which the field reports as "we
         * could not read your list", not as "you have none".
         */
        const raw: unknown[] = body.options ?? body.data?.options ?? body.data ?? [];
        setChoices(prev => ({
          ...prev,
          [field.name]: raw
            .map(o => {
              if (typeof o === 'string') return { value: o, label: o };
              const r = o as Record<string, unknown>;
              const value = String(r.value ?? r.id ?? '');
              return { value, label: String(r.label ?? r.name ?? r.title ?? value) };
            })
            .filter(o => o.value),
        }));
      } catch {
        setChoices(prev => ({ ...prev, [field.name]: [] }));
      } finally {
        setLoading(prev => ({ ...prev, [field.name]: false }));
      }
    },
    []
  );

  /*
   * Load every field whose dependencies are satisfied, and reload one the
   * moment they change. A field with no `dependsOn` loads as soon as the dialog
   * opens; a dependent one waits, then follows its parent.
   */
  useEffect(() => {
    if (!open) return;
    /* Nothing to ask Google for until we are allowed to ask. Once `needed`
       empties — which happens by itself after a successful connect, because
       `refreshPlugins` updates the map this is keyed on — every field loads. */
    if (needed.length > 0) return;

    for (const field of inputs) {
      if (!field.options) continue;

      const deps = field.options.dependsOn ?? [];
      const satisfied = deps.every(d => values[d]);
      if (!satisfied) continue;

      const dependentValues = Object.fromEntries(deps.map(d => [d, values[d]]));
      load(field, dependentValues);
    }
    // Keyed on the dependency VALUES, so picking a spreadsheet reloads the tabs
    // and picking a different one reloads them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inputs, load, needed.length, JSON.stringify(inputs.map(f => (f.options?.dependsOn ?? []).map(d => values[d])))]);

  const choose = (name: string, value: string) => {
    setValues(prev => {
      const next = { ...prev, [name]: value };
      /*
       * Clear anything downstream. A tab chosen from the old spreadsheet is not
       * a tab of the new one, and leaving it selected submits a pairing that
       * does not exist.
       */
      for (const field of inputs) {
        if (field.options?.dependsOn?.includes(name)) delete next[field.name];
      }
      return next;
    });
  };

  const missing = inputs.filter(f => f.required && !values[f.name]);
  /* Nothing to submit while a plugin is missing: the answers cannot exist. */
  const blocked =
    needed.length > 0 || eitherOpen || Object.values(notConnected).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="sm:max-w-[26rem]">
        <DialogHeader>
          <DialogTitle>{agentName}</DialogTitle>
          <DialogDescription>
            {t('automation.inputs_intro') || 'A couple of things it needs to know first.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/*
            WHICH MAILBOX, ASKED ONCE AND ONLY WHEN IT IS A QUESTION.

            Shown when the agent accepts either provider and the owner has
            connected neither. Connecting one answers both halves at once — it
            is the connection the agent needs AND the choice of which plan to
            install — so there is no radio button to press and nothing to get
            out of step with.
          */}
          {either.length > 1 && (
            <div
              className="flex flex-col gap-2 rounded-lg p-2.5"
              style={{
                background: eitherOpen ? 'var(--v2-status-warning-bg)' : 'var(--v2-bg)',
                border: `1px solid ${eitherOpen ? 'var(--v2-status-warning-border)' : 'var(--v2-border)'}`,
              }}
            >
              <div
                className="text-xs"
                style={{ color: eitherOpen ? 'var(--v2-status-warning-text)' : 'var(--v2-text-secondary)' }}
              >
                {t('automation.connect_which_mailbox') ||
                  'Which mailbox does this business use? Connect it and this agent will read that one.'}
              </div>

              {/*
                A CHOICE, NOT TWO CONNECT BUTTONS.

                It was the latter, and that made the second plan unreachable
                for anybody who already had the first mailbox connected: the
                only control was "connect this", so an owner with Gmail live
                could not say that their client mail goes through Outlook.

                Each option is pressable. A connected one is selected and done.
                Picking an unconnected one selects it and reveals its Connect
                button, which is the only thing still owed before Activate.
              */}
              {either.map(choice => {
                const live = isLive(choice.plugin);
                const isChosen = selected?.automationId === choice.automationId;

                return (
                  <div key={choice.plugin} className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setChosen(choice.automationId)}
                      aria-pressed={isChosen}
                      className="flex flex-1 min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors"
                      style={{
                        background: isChosen ? 'var(--v2-surface)' : 'transparent',
                        border: `1px solid ${isChosen ? 'var(--v2-primary)' : 'transparent'}`,
                        color: 'var(--v2-text-primary)',
                      }}
                    >
                      <PluginIcon pluginId={choice.plugin} className="w-[18px] h-[18px]" alt="" />
                      <span className="flex-1 min-w-0 text-xs font-semibold">
                        {nameOf(choice.plugin)}
                      </span>
                      {live && (
                        <Check
                          className="w-3.5 h-3.5"
                          style={{ color: 'var(--v2-status-success-text)' }}
                        />
                      )}
                    </button>

                    {/* Owed only for the one they picked, and only if it is not
                        already live. A Connect button beside an option nobody
                        selected is an invitation to connect something they do
                        not want. */}
                    {isChosen && !live && (
                      <button
                        type="button"
                        disabled={repairing === choice.plugin}
                        onClick={async () => {
                          const ok = await repair(choice.plugin);
                          if (ok) await refreshPlugins();
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg disabled:opacity-60"
                        style={{
                          background: 'var(--v2-surface)',
                          color: 'var(--v2-text-primary)',
                          border: '1px solid var(--v2-border)',
                        }}
                      >
                        {repairing === choice.plugin ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          t('automation.connect_plugin') || 'Connect'
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/*
            CONNECT FIRST, IN PLACE. One line per plugin still to connect, with
            the button beside it. On success `repair` refreshes the plugin list
            and this whole block disappears on its own, so the owner never
            leaves the dialog or has to find their way back to it.
          */}
          {needed.map(key => (
            <div
              key={key}
              className="flex items-center gap-2.5 rounded-lg p-2.5"
              style={{
                background: 'var(--v2-status-warning-bg)',
                border: '1px solid var(--v2-status-warning-border)',
              }}
            >
              <PluginIcon pluginId={key} className="w-[18px] h-[18px]" alt="" />
              <div className="flex-1 min-w-0 text-xs" style={{ color: 'var(--v2-status-warning-text)' }}>
                {(t('automation.connect_first') || 'Connect {plugin} first, then come back').replace(
                  '{plugin}',
                  nameOf(key)
                )}
              </div>
              <button
                type="button"
                disabled={repairing === key}
                onClick={async () => {
                  const ok = await repair(key);
                  /* The refresh is what makes this silent: the map updates,
                     `needed` shrinks, and the fields load themselves. */
                  if (ok) await refreshPlugins();
                }}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg disabled:opacity-60"
                style={{
                  background: 'var(--v2-surface)',
                  color: 'var(--v2-text-primary)',
                  border: '1px solid var(--v2-border)',
                }}
              >
                {repairing === key ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  t('automation.connect_plugin') || 'Connect'
                )}
              </button>
            </div>
          ))}

          {/* Said once, quietly, when there was something to fix and it is
              fixed. Without it a prompt simply vanishes and the owner is left
              wondering whether the press worked. */}
          {needed.length === 0 && !eitherOpen && plugins.some(p => p !== 'business-os') && (
            <div
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--v2-status-success-text)' }}
            >
              <Check className="w-3.5 h-3.5" />
              {(t('automation.connected_ok') || '{plugin} is connected').replace(
                '{plugin}',
                /*
                 * The mailbox that SETTLED the either-or, not the one the row
                 * happened to arrive naming. Saying "Gmail is connected" to an
                 * owner who just connected Outlook is worse than saying
                 * nothing: it is the dialog disagreeing with what they did.
                 */
                [
                  ...plugins.filter(p => p !== 'business-os' && !either.some(c => c.plugin === p)),
                  ...(selected ? [selected.plugin] : []),
                ]
                  .map(nameOf)
                  .join(', ')
              )}
            </div>
          )}

          {inputs.map(field => {
            const deps = field.options?.dependsOn ?? [];
            const waiting = deps.some(d => !values[d]);
            const list = choices[field.name] ?? [];
            const isLoading = loading[field.name];
            const needsConnecting = !!(field.options && notConnected[field.options.plugin]);

            return (
              <div key={field.name}>
                <div
                  className="text-xs font-semibold mb-1"
                  style={{ color: 'var(--v2-text-secondary)' }}
                >
                  {t(`automation.input.${field.name}`) || field.description || field.name}
                </div>

                {/*
                  The platform's own Select, not a native one. A bare
                  `<select>` is drawn by the operating system: it ignores the
                  V2 tokens, cannot be styled in dark mode, and sat in a dialog
                  built entirely from Radix looking like it came from a
                  different product.

                  The placeholder moves onto `SelectValue`, because a Radix
                  `SelectItem` may not carry an empty value — it throws — so
                  "choose one" cannot be an option the way it was.
                */}
                <Select
                  value={values[field.name] ?? undefined}
                  disabled={waiting || isLoading || busy || needsConnecting || list.length === 0}
                  onValueChange={value => choose(field.name, value)}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        waiting
                          ? t('automation.input_waiting') || 'Pick the one above first'
                          : isLoading
                            ? t('automation.input_loading') || 'Loading…'
                            : t('automation.input_choose') || 'Choose one'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {list.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Told apart on purpose: nothing to choose from is a different
                    problem from not having looked yet, and only one of them is
                    worth the owner acting on. */}
                {/*
                  THREE DIFFERENT EMPTY STATES, and conflating them is how an
                  owner concludes the feature is broken. Not connected is the
                  only one they can act on, and it gets a link. Nothing to
                  choose from means we looked and the account really is empty.
                  Loading is neither.
                */}
                {needsConnecting ? (
                  <div className="text-xs mt-1" style={{ color: 'var(--v2-status-warning-text)' }}>
                    {(t('automation.connect_first') || 'Connect {plugin} first, then come back').replace(
                      '{plugin}',
                      field.options!.plugin
                    )}{' '}
                    <a
                      href="/settings?tab=plugins"
                      className="underline"
                      style={{ color: 'var(--v2-primary)' }}
                    >
                      {t('automation.connect_plugin') || 'Connect'}
                    </a>
                  </div>
                ) : !waiting && !isLoading && list.length === 0 ? (
                  <div className="text-xs mt-1" style={{ color: 'var(--v2-text-muted)' }}>
                    {t('automation.input_empty') || 'Nothing to choose from here'}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors hover:bg-[var(--v2-bg)]"
            style={{
              background: 'transparent',
              color: 'var(--v2-text-secondary)',
              border: '1px solid var(--v2-border)',
            }}
          >
            {t('automation.cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            /*
             * The variant the owner chose by connecting, when they were asked.
             * `eitherSettled` covers the case they connected it in another tab
             * rather than on this button, which `chosen` would miss.
             */
            onClick={() => onConfirm(values, selected?.automationId)}
            disabled={missing.length > 0 || busy || blocked}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors hover:bg-[var(--v2-bg)] disabled:opacity-60"
            style={{
              background: 'transparent',
              color: 'var(--v2-primary)',
              border: '1px solid var(--v2-primary)',
            }}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              t('automation.switch_on') || 'Switch it on'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
