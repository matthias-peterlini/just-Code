import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { complete, ghostText, type CompleteContext, type Suggestion } from '../core/complete.js';
import { C } from './theme.js';

const KIND_ICON: Record<Suggestion['kind'], string> = { command: '', arg: '›', file: '@', history: '↺', prompt: '✦' };

/**
 * Prompt with autocomplete:
 *  - Tab accepts the highlighted suggestion (or the dimmed ghost text)
 *  - ↑/↓ move in the list; with no list they walk through the prompt history
 *  - Enter submits, or accepts the suggestion if you picked one with the arrows
 *  - Esc closes the list
 */
export function PromptInput({
  ctx,
  starters,
  turbo,
  onSubmit,
}: {
  ctx: CompleteContext;
  starters: string[];
  turbo: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValueRaw] = useState('');
  // Remounting TextInput moves its cursor to the end after a programmatic change.
  const [inputKey, setInputKey] = useState(0);
  const [sel, setSel] = useState(0);
  const [picked, setPicked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [histPos, setHistPos] = useState(-1);

  const typed = (v: string) => {
    setValueRaw(v);
    setSel(0);
    setPicked(false);
    setHidden(false);
    setHistPos(-1);
  };
  const setValue = (v: string) => {
    typed(v);
    setInputKey((k) => k + 1);
  };

  const suggestions: Suggestion[] = useMemo(() => {
    if (hidden) return [];
    if (!value) return starters.map((s) => ({ value: s, label: s, kind: 'prompt' as const }));
    return complete(value, ctx);
  }, [value, ctx, starters, hidden]);

  useEffect(() => {
    if (sel >= suggestions.length) setSel(0);
  }, [suggestions.length, sel]);

  const accept = (s: Suggestion | undefined) => {
    if (s) setValue(s.value);
  };

  useInput((_ch, key) => {
    if (key.tab) {
      accept(suggestions[sel]);
      return;
    }
    if (key.escape && suggestions.length) {
      setHidden(true);
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (suggestions.length && (value || picked || key.downArrow)) {
        const n = suggestions.length;
        setSel((i) => (key.upArrow ? (i - 1 + n) % n : (i + 1) % n));
        setPicked(true);
        return;
      }
      // prompt history
      const h = ctx.history;
      if (!h.length) return;
      const pos = key.upArrow ? (histPos < 0 ? h.length - 1 : Math.max(0, histPos - 1)) : histPos < 0 ? -1 : histPos + 1;
      if (pos < 0 || pos >= h.length) {
        setValue('');
        return;
      }
      setValueRaw(h[pos]);
      setInputKey((k) => k + 1);
      setHistPos(pos);
      setHidden(true);
    }
  });

  const submit = (v: string) => {
    if (picked && suggestions[sel]) {
      accept(suggestions[sel]);
      return;
    }
    if (!v.trim()) return;
    setValue('');
    onSubmit(v);
  };

  const ghost = ghostText(value, suggestions[sel]);
  const isStarters = !value && suggestions.length > 0;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={turbo ? C.orange : C.dim} paddingX={1}>
        <Text color={C.orange} bold>
          {'❯ '}
        </Text>
        <TextInput
          key={inputKey}
          value={value}
          onChange={typed}
          onSubmit={submit}
          placeholder="Ask just-Code to build something…  (/ for commands, @ for files)"
        />
        {ghost ? <Text color={C.dim}>{ghost}</Text> : null}
      </Box>
      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {isStarters && <Text color={C.dim}>{'  suggestions — ↓ to pick, Tab to use'}</Text>}
          {suggestions.map((s, i) => {
            const on = i === sel && (!isStarters || picked);
            return (
              <Text key={s.value + i} wrap="truncate-end">
                <Text color={on ? C.orange : C.dim}>{on ? ' ❯ ' : '   '}</Text>
                {KIND_ICON[s.kind] ? <Text color={C.dim}>{KIND_ICON[s.kind]} </Text> : null}
                <Text color={on ? C.white : s.kind === 'command' ? C.orange : C.gray} bold={on}>
                  {s.kind === 'command' ? s.label.padEnd(15) : s.label}
                </Text>
                {s.hint ? <Text color={C.dim}>{'  ' + s.hint}</Text> : null}
              </Text>
            );
          })}
          <Text color={C.dim}>{'  Tab accept · ↑↓ move · Esc hide'}</Text>
        </Box>
      )}
    </Box>
  );
}
