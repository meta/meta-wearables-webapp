---
name: ai-glasses-webapp-webmcp
description: "Design and build Meta AI voice interactions for a Meta Ray-Ban Display web app by exposing app state and actions as WebMCP tools. Use when the wearer should ask Meta AI to read app state or perform actions in the app, or for WebMCP, model context, tool registration, agentic web apps, or hands-free control."
argument-hint: "[app-directory] [example-utterance]"
---

# Design Meta AI voice interactions for a web app

The wearer asks Meta AI for something, Meta AI calls tools your app registers
through WebMCP, and the app does the work while the screen updates. Your app
does not implement speech recognition or voice activation. Build the app with
`ai-glasses-webapp-build` first: voice is another way to use it, so every task
must still work without the assistant.

## Start from what the wearer says

Before designing tools, inspect the app's screens and features and write down:

- Five to ten requests as a wearer would say them aloud, including follow-ups:
  "add coffee, sugar, and cream", "what's in my cart?", "remove the sugar",
  "add another one", "start over".
- What Meta AI should say back to each one, and what the screen should show.

Derive the tool set from these requests, basing them on what the app already
does. If inspecting the app does not reveal the main things a wearer would ask
for, ask the user for example requests.

## Turn intents into a small tool set

- Make one tool per user goal, not per button: `cart_add_items`, not
  `tap_add_button`.
- When a request names several items for the same action, accept the whole
  list in one call. That saves round trips and avoids partial updates.
- Provide a read-only state tool that reports what is on screen, what is
  selected, and what changed last. Meta AI can use it to orient itself and to
  resolve "this" and "that one".
- Name and describe tools in the wearer's vocabulary. A description says when
  to use the tool, not how it works. Keep descriptions short.
- Keep the set small and focused on what the wearer actually asks for.

## Design each turn

The wearer hears a short reply and sees the screen. Design both.

- Let the voice acknowledge and the screen carry the detail. Return a
  one-sentence `summary` of what happened along with the new state, and
  collapse long lists ("Added 6 items"). Meta AI may not use your wording
  verbatim, so listen to the actual replies when testing.
- Make every change visible. Update through the same state and actions the UI
  uses, and highlight or scroll to what changed. The reply should never say
  "done" before the screen shows it.
- Show progress for anything slower than instant. A tool call has a 10-second
  deadline; for longer work, start it, return that it is in progress, show
  progress on screen, and let the state tool report completion.
- Return what actually changed, with short stable item IDs, so the next turn
  can refer to it.
- Finish tool work before the final reply. A suggestion field in a result is a
  hint Meta AI may use, not a guarantee of what it does next.

## Expose only what should be said aloud

Everything a tool returns goes to Meta AI, even when it is never spoken, and
replies may be spoken aloud in public. Keep results, especially the state
tool's, to what the task needs. Never return credentials, tokens, or personal
data the request does not require, and read sensitive information only when
the wearer asks for it.

## Help wearers discover what they can ask

Show a few example requests in the app, for instance in an empty state or a
help screen. Only suggest requests your tools actually handle.

## Build it

Register each tool through its own guarded call, so one failed registration
does not block the others, and tie registrations to the screen's lifetime.

```ts
// Problems the wearer can fix are returned as data, not thrown.
function problem(message: string, suggestion: string) {
  return JSON.stringify({error: true, message, suggestion});
}

async function safeRegister(ctx: ModelContext, tool: ModelContextTool, signal?: AbortSignal) {
  try {
    await ctx.registerTool(tool, signal ? {signal} : undefined);
  } catch (err) {
    if (signal?.aborted && err === signal.reason) return; // unmounted while registering
    console.error(`${tool.name} registration failed`, err);
  }
}

export function registerCartTools(ctx: ModelContext, signal?: AbortSignal) {
  return safeRegister(ctx, {
    name: 'cart_add_items',
    description: 'Add one or more menu items to the cart. Pass every item the wearer named in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Item names from the menu.',
          items: {type: 'string'},
          minItems: 1,
        },
      },
      required: ['items'],
    },
    execute: async (input: Record<string, unknown>) => {
      const items = input.items;
      if (!Array.isArray(items) || items.length === 0 ||
          items.some(item => typeof item !== 'string' || !item.trim())) {
        return problem('No item names were given.', 'Ask the wearer which items to add.');
      }
      const names = items.map(item => item.trim());
      const unknown = names.filter(name => !isKnownItem(name));
      if (unknown.length) {
        return problem(
          `Not on the menu: ${unknown.join(', ')}.`,
          `Offer the closest options and let the wearer choose: ${closestItems(unknown).slice(0, 3).join(', ')}.`,
        );
      }
      // The same action the Add buttons use, so the screen updates. It returns
      // the updated state rather than queuing it, so the reply is never stale.
      const {cart, total} = addItems(names);
      return JSON.stringify({
        summary: names.length > 3 ? `Added ${names.length} items.` : `Added ${names.join(', ')}.`,
        added: names,
        cart, // items with stable IDs, so "remove that" can refer to them
        total,
      });
    },
  }, signal);
}
```

```tsx
// React: the effect owns the tools' lifetime; aborting unregisters them.
useEffect(() => {
  const ctx = document.modelContext;
  if (!ctx?.registerTool) return; // no WebMCP: the app still works without voice
  const ac = new AbortController();
  void registerCartTools(ctx, ac.signal);
  return () => ac.abort();
}, []);
```

These facts fail silently, so check them:

- WebMCP is off by default and enabled per device, for example through
  Developer Mode. Feature-detect `document.modelContext?.registerTool`, and
  relaunch the app after enabling WebMCP before retesting.
- Read app state when the tool runs, from a store, ref, or getter. A tool
  registered once from a React effect that closes over `useState` values will
  report and change stale state while the screen shows something else.
- Serve the app over HTTPS. Do not add a library that defines its own
  `document.modelContext`; tools registered there never reach Meta AI.
- A resolved `registerTool()` means the page accepted the tool, not that Meta
  AI can call it. Reserved names (`openUrl`, `goBack`, `goForward`, `reload`,
  `getCurrentUrl`, `getPageTitle`, `getPageText`) are rejected without any
  error on the page, and `getTools()` lists only the page's own tools.
- Scalar `enum`, bounds, and defaults do not reach Meta AI. State allowed
  values in the description, and validate every argument in the tool.
- Always return a value; `undefined` is reported as a failure. `isError` is not
  treated as a failure flag. Return problems the wearer can fix as data, and
  throw only for real errors.
- Forward the call's `signal` to `fetch` and other long work. A call is
  cancelled at the deadline or when the wearer leaves the app. Cancellation
  does not undo work already done.

## Test conversations on glasses

- Script five to ten spoken sessions and run them on glasses: multi-step
  requests, an unknown item, and a cancellation. A session passes when the
  screen ends in the right state and the spoken replies make sense.
- Tools are available only while the app is in front, so keep it open and the
  glasses awake while testing.
- Run `ai-glasses-webapp-test` for the app itself; it does not exercise Meta
  AI. Also check the app with no assistant and with no WebMCP surface.
