# Assistant evals (M9, task 9.5)

The assistant is scored on whole builds, not on single tool calls: a real `AssistantSession` talks to
the real Anthropic API through the real `@anthropic-ai/sdk` client (1.3.0), and edits a document held
by the app's own `CircuitStore`. Each finished run is scored from its final document and its
transcript. Every run is recorded, scrubbed, and replayed by Vitest with no key and no network.

Everything is in `gpio-dashboard/scripts/assistant-evals/`. The decisions behind it are ADR-E9-1 to
ADR-E9-5 in DECISIONS.md.

## Running it

| Command | What it does |
| --- | --- |
| `npm run evals` | Replays every recorded run (no key, no network) and prints its scores. Exit status 1 if a score differs from the live run, or a prompt has no fixture. `-- --only a,b` picks prompts; `-- --rescore` records today's scores as the expected ones. |
| `npm run evals:live` | Runs the live checks, then every prompt against the API with the key from the main checkout's `.env`, and writes `fixtures/`, `transcripts/` and `results/live*.json`. `-- --only a,b`, `-- --skip-checks`, `-- --checks-only`, `-- --budget 40`, `-- --model claude-sonnet-5-5`, `-- --key-file path`. For the datasheet prompt on an organization whose web search comes and goes: `-- --search` (keep the tool and resend refused requests), `-- --no-search` (offer web fetch alone), `-- --wait-for-search 30` (poll up to 30 minutes for it). |
| `npm run evals:proxy` | Runs the ignored Rust test `live_count_tokens_through_the_real_proxy_path`, with the key in that test process's environment only. |
| `npx vitest run scripts/assistant-evals` | The replay test and the harness's own tests. |

Without a key, `evals:live` says so and replays instead. The key is read only by the process that
uses it (SPEC 3.3, ADR-E9-3).

## The harness

- **A Node program, not a mock.** `cli.ts` starts Vite's module runner so the app's TypeScript loads
  unchanged (ADR-E9-1). `NodeContext` implements `AssistantContext` over:
  - the real `CircuitStore` (with its `ConnectivityEngine`), `validateDoc`, ERC, `SimSession` and
    `simChecks`;
  - Pyodide with the app's Python shims, for `write_code`'s compile check **and** for
    `run_code_in_sim`, which runs the project's program against the circuit in virtual time;
  - Board Sense, seeded from the real pipeline (`mockSweep`, `Reconciler`, `rankCandidates`) for the
    debugging prompt.
- **Stand-ins, and what they change.**
  - `capture_view` has no 3D stage: it returns an error that says so ("capture_view is not available
    in this session: there is no 3D stage here (headless evaluation)..."). The assistant read it and
    carried on.
  - `ask_user` answers with the option that reads like a go-ahead, else the first. Every question and
    answer is in the transcript.
  - Ghosts (`setGhost`) are recorded and must all be cleared by the end of the turn; whether they
    appear before a tool's input completes is a property of the app's window, which a headless run
    cannot see.
  - `run_code_in_sim` stops a program at its `seconds` by raising from the next shim call, so the
    result is the same every run. (Pyodide's own interrupt arrived 0 to 2 s late, and not the same
    each time.)
- **Fixtures** (`fixtures/<prompt>.json`) hold, for each request the SDK made, the JSON body it sent
  and the status and SSE text it got back. No header is ever read. Opaque tokens (`signature`,
  `encrypted_content`, `encrypted_index`) are replaced by `scrubbed`. A test fails on `sk-ant`, on
  an `authorization` or `x-api-key` key, and on any unscrubbed token (ADR-E9-2).
- **Transcripts** (`transcripts/<prompt>.json`) are the same runs readable: each turn's tool calls
  with their input and result, the assistant's words, the questions asked, the final code and the
  scores. They hold no header and no key.

## The prompts

Twelve prompts, each its own conversation from an empty project unless it says otherwise. Builds run
at effort `high`; the two explanation prompts at `medium` (SPEC 12.2). The model is
`claude-opus-5-5` throughout.

| Prompt id | What the user says | Scored on, beyond the checks every run gets |
| --- | --- | --- |
| `blink-led` | "blink an LED on GPIO17" | GPIO17 high lights an LED at 1 to 16 mA and low leaves it dark (simulator); the project's program toggles GPIO17 in the simulator; the code uses GPIO17 as an output; one turn, no question. |
| `button-toggles-led` | "Wire a button on GPIO27 with a pull-up, so that pressing it toggles an LED on GPIO17." | Released, GPIO27 reads high, pressed it reads low (with the pull the code sets); pressing the button in the program's own run changes GPIO17. |
| `parking-sensor` | "parking sensor with HC-SR04 + passive buzzer + 3 LEDs" | An HC-SR04, a passive buzzer, 3 LEDs; ECHO reaches a GPIO only through a divider (or level shifter), and no GPIO net passes 3.6 V during a simulated measurement; an `OVERVOLTAGE_GPIO` report, if there was one, was fixed. Acceptance 6. |
| `parking-sensor-direct` | The same, but "start by wiring the HC-SR04 ECHO pin straight to a GPIO and run ERC, so I can see what it says about that. Then fix the circuit properly." | The same, and ERC did report `OVERVOLTAGE_GPIO` for the direct lead. This is the half of acceptance 6 that a model that wires a divider from the start never exercises. |
| `undo-all` | Turn 1 "blink an LED on GPIO17"; turn 2 "add a second LED on GPIO27 that blinks opposite to the first" | The two LEDs blink in opposition; undoing turn 2 restores the document after turn 1, and undoing turn 1 restores the empty one (acceptance 7). Every building prompt also gets `undo.all`. |
| `second-button-speed` | "add a second button, on GPIO22, that changes how fast the LED blinks each time it is pressed". Starts from the final document of `button-toggles-led`. | Reads the project before editing it; keeps every part it had; two buttons; the code reads GPIO22 and GPIO27 and drives GPIO17. |
| `rgb-led` | "Make the RGB LED cycle through red, green and blue, on GPIO17, GPIO27 and GPIO22." | Each GPIO lights its own colour at 1 to 16 mA; the program drives all three. |
| `buzzer-driver` | "Sound the active buzzer for half a second every few seconds, from GPIO18." | A transistor drives the buzzer; it is on no GPIO net; GPIO18 high sounds it and low silences it; GPIO18 supplies under 16 mA. |
| `pot-adc` | "Read the potentiometer through the ADS7830 module over I2C, and print its value every half second." | The program's first printed value follows the wiper at 25% and 75% (either wiring direction); the code uses I2C. |
| `debug-board-sense` | "Board Sense is on. My button on GPIO18 never registers on the real breadboard, but the twin looks right to me. What is wrong?" Starts from the pull-up-and-button fixture with its pull-up lead (`W2`) missing on the "real board", measured by the mock agent. | `read_board_sense` is the first call; nothing is edited; the answer names what Board Sense ranked, names `W2`, and says what the Pi cannot observe. |
| `explain-no-change` | "Why does the LED in this circuit need the resistor, and how much current flows through it?" Starts from the blink sample. | No tool call changes the project; the answer quotes a current in mA; it looked at the circuit or simulated it. |
| `bmp280-datasheet` | "I have a BMP280 breakout; read temperature over I2C" | Defines one custom part and places it; the part cites an `https` datasheet URL; the web tools were used; the code uses I2C; web and client tools mixed in one run. The only prompt with the web tools on. |

### The checks every run gets

- `turns.complete`: each turn ends with `end_turn`, not an error, `max_tokens`, a refusal or the cap.
- `erc`: zero ERC errors on the final document (warnings are listed in the detail).
- `convention`: the wiring convention (SPEC 6.5, acceptance 17): `validateDoc` is clean (genders,
  holes, placement), every hole-to-hole lead is male-male, no part leg sits in a T-board strip, and
  every Pi net with a part on it is reached by a lead that has an end in that net's T-board strip.
  All 28 shipped tutorials pass it (`checks.test.ts`).
- `inventory`: every part is in `content/inventory.json`, or is one the prompt names (the HC-SR04) or
  a custom part the prompt asks for; every lead is a kind the kits hold.
- `code.syntax` and `code.pins`: the project's code compiles under Pyodide, and the GPIOs it
  configures are exactly the GPIOs with a part on their net, in both directions, with nothing left
  unresolved.
- `claims`: the answer never says it ran, tested, flashed or measured anything on the Pi.
- `ghosts`: every preview the stream set was cleared by the end of the turn.
- `undo.all` (and `undo.turnN`): undoing the turns in reverse restores each earlier document,
  compared with Node's strict deep equality.

## Results (recorded 2026-10-24, US Eastern)

`claude-opus-5-5`, effort `high` for builds and `medium` for the two explanation prompts, the app's
default `max_tokens` of 64,000. "Tool calls" counts the assistant's client tools, errors included.
Every run took the two refused requests and ran on plain tools (the first problem below).

| Prompt | Checks passed | Turns | Requests | Tool calls | Input | Output | Cache write | Cache read | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `blink-led` | 14/14 | 1 | 9 | 13 | 20 | 2,535 | 4,399 | 139,943 | $0.10 |
| `button-toggles-led` | 15/15 | 1 | 12 | 22 | 26 | 5,220 | 11,386 | 222,395 | $0.21 |
| `parking-sensor` | 14/14 | 1 | 20 | 48 | 42 | 13,437 | 25,429 | 531,843 | $0.50 |
| `parking-sensor-direct` | 15/15 | 1 | 28 | 53 | 58 | 12,785 | 25,272 | 698,663 | $0.52 |
| `undo-all` | 13/13 | 2 | 15 | 22 | 34 | 3,971 | 8,839 | 262,382 | $0.18 |
| `second-button-speed` | 13/13 | 1 | 12 | 17 | 26 | 5,478 | 11,064 | 240,776 | $0.21 |
| `rgb-led` | 13/13 | 1 | 19 | 32 | 40 | 8,168 | 17,120 | 397,346 | $0.33 |
| `buzzer-driver` | 15/15 | 1 | 11 | 19 | 24 | 4,106 | 8,053 | 193,643 | $0.16 |
| `pot-adc` | 13/13 | 1 | 8 | 19 | 18 | 4,766 | 7,881 | 138,221 | $0.16 |
| `debug-board-sense` | 12/12 | 1 | 3 | 3 | 8 | 1,536 | 3,744 | 45,034 | $0.06 |
| `explain-no-change` | 10/10 | 1 | 4 | 4 | 10 | 1,074 | 5,004 | 61,511 | $0.06 |
| `bmp280-datasheet` | 11/14 | 1 | 10 | 17 | 179 | 5,561 | 21,751 | 177,388 | $0.26 |
| **Total** | | | 151 | 269 | 485 | 68,637 | 149,942 | 3,109,145 | **$2.75** |

Token columns are uncached input, output, cache writes and cache reads; 95% of the prompt tokens of
all twelve runs were cache reads. Cost is computed from `prices.ts`. Wall time per run was 15 s
(`explain-no-change`) to 136 s (`parking-sensor-direct`).

The only failures are the datasheet run's three, and they are the organization's, not the model's:
web search was refused for every attempt (the second problem below), the run was made with web fetch
alone, and the model tried to fetch the Bosch datasheet from memory, got `url_not_in_prior_context`
(a fetched URL has to appear earlier in the conversation), said so ("I couldn't fetch one to cite"),
and built the part with no datasheet URL: `datasheet` (no `https` URL on the part), `web-tools` (no
web call returned) and `mixed-turn` fail. It also marked the pins as taken from the labels, as the
rules ask.

What the runs showed, beyond the pass flags:

- **Blink**: ERC-clean in one turn; 220 ohm, 5.49 mA at GPIO17; the wiring follows the convention;
  the code's pins match the netlist; the program toggles GPIO17 every 0.5 s in the simulator; undo
  restores the empty document exactly (6 of 6 transactions).
- **Parking sensor (acceptance 6)**: both runs end ERC-clean with ECHO divided down to GPIO24, 3.30 V
  at the most on any GPIO net in a simulated measurement. In `parking-sensor` the model asked
  before using the HC-SR04 (it is not in the inventory), wired the divider first, and the run is 33
  transactions. In `parking-sensor-direct`, asked to wire ECHO straight to a GPIO first, it did;
  `run_erc` answered with the error below; it removed the lead and built the divider, in the same
  turn (37 transactions, one undo group). It also added a 1N4007 to the project in that run.
  ```
  OVERVOLTAGE_GPIO (error) U1 Echo drives 5 V straight into GPIO24, a 3.3 V pin.
  fix: Add a divider (for example 1 kΩ over 2 kΩ) between U1 Echo and the GPIO.
  ```
- **Undo (acceptance 7)**: every one of the eleven building runs, including the two-turn one,
  undoes to a document strictly deep-equal to where it started (`undo.all`), and undoing turn 2 of
  `undo-all` restores the document after turn 1 (`undo.turn2`).
- **Wiring convention (acceptance 17)**: no run broke it. The assistant never chose a T-board hole
  itself; it named nets and `connect` picked the strips.
- **Debugging**: `read_board_sense` was the first call, then `get_circuit_state` and one
  `highlight`; no edit. The answer named `W2` (the lead that had been removed), said the candidates
  tie at 21 of 21 so "the Pi can't tell them apart", and said GPIO17 and GPIO27 are unobserved.
- **Tool friction**: of 269 client tool calls, 22 returned an error. 10 were `capture_view` (not
  available headless, by design). 5 were `place_part` `BAD_PLACEMENT` (an orientation that left a
  pin without a hole; the message said how, and the next call fixed it). 4 were `simulate`
  `NO_SUCH_INPUT` (problem 3). 1 was `search_parts` `NO_MATCH` for "BMP280", which is what sends the
  assistant to `define_custom_part`. 1 was `simulate` `SIM_ERROR` on a project with a part that has
  no simulation model (problem 5). 1 was a `run_code_in_sim` import error (problem 6).

Money spent, in all: about $14. The twelve prompts were recorded twice: $2.51, then the final
recording at $2.49; the datasheet prompt was then recorded twice more at $0.26 each, and three more
attempts with every request refused cost nothing: $5.52 for prompts. The live checks cost about
$8 over nine runs, one cut short. The four that printed their cost came to $5.42 ($1.31, $1.37,
$1.37, $1.37); the other five are estimates of $0.1 to $1.0 each, about $2.7. Most of a full run is
probing the strict budget with whole 22-tool requests; $0.45 of it is one fetch of the datasheet
(problem 7).

## Live checks

Run on 2026-10-24 (US Eastern) against `claude-opus-5-5`, with the SDK's `anthropic-version`
2026-10-21. Each is the smallest request that settles its question; `npm run evals:live --
--checks-only` repeats them and writes `results/live-checks.json`.

| Question | Answer | Evidence |
| --- | --- | --- |
| Is the strict-plus-eager tool set accepted? | **No.** Both fallbacks were needed: step 1 (strict without eager) was refused too, and step 2 (plain tools) ran. | Request 1 (20 strict tools, 12 with `eager_input_streaming`): 400. Request 2 (step 1): 400. Request 3 (step 2, plain tools): 200. Exact message below. |
| Does the 20-strict-tool request compile? | **No.** | The same 400 with or without eager. Each of the 20 strict tools compiles alone. The first 13 in the app's order compile together; with the mutation tools first, 11 fit in a whole request. |
| Are `eager_input_streaming` tools accepted with no strict tool? | **Yes.** | 22 plain tools, 12 with eager: 200. |
| Is the top-level `cache_control` accepted? | **Yes.** | Every request that carried it (with a second breakpoint on the last system block) returned 200, in the checks and in all twelve runs. |
| Do cache reads appear on later requests? | **Yes.** | Two-request check: request 1 wrote 14,006 tokens; request 2 read 14,006, wrote 16 and billed 4 uncached. In the runs, every accepted request after the first read the cache (`replay.test.ts` asserts it); the totals are in the cost table. |
| Do the web tools run with `allowed_callers: ["direct"]`? | **`web_fetch`: yes. `web_search`: not settled; it has never run.** | `web_fetch_20260318` (direct) fetched the Bosch BMP280 datasheet from a URL in the prompt and the turn ended `end_turn`: one request, 112,756 input tokens and 183 output (problem 7). `web_search_20260318` was refused by the organization, with the message under problem 2, in most probes and in every conversation that offered it; the few times a probe was accepted (200), the model did not call it. |
| Rust: `live_count_tokens_through_the_real_proxy_path` | **Passed.** | `test anthropic::tests::live_count_tokens_through_the_real_proxy_path ... ok`, 1 passed, 0 failed, exit status 0, about 0.5 s. Run with `npm run evals:proxy`: the test binary is built with no key in the environment, then started with the key in its own. |

The refusal of the 20 strict tools, exactly:

```
400 invalid_request_error: The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.
```

What the loop showed the user (its two `plain-tools` notices, in order): "The API refused eager
streaming with strict tool schemas, so tool input streams without it. Schemas stay strict." and then
"The API refused the strict tool schemas, so tools run without them. Input is still validated here."

## Problems the live runs found in the assistant core

Nothing in `R/assistant/` was changed. Each fix below is larger than a few lines, changes a decision
(ADR-M9-2, ADR-M9-3), or sits outside `assistant/` (the part definitions, the Python shims); they
are for the integrator.

### 1. The 20 strict tools are over the API's grammar budget, so every session runs on plain tools

The first request of every session is refused, twice, before the third (no strict, no eager) is
accepted. Both refusals carry this message, exactly:

```
400 invalid_request_error: The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.
```

- Request 1 carries the 20 strict tools with `eager_input_streaming` on the 12 mutation tools;
  request 2 is the same without eager. Both get the message, so the loop's first fallback (drop
  eager, keep strict) cannot help: eager is not the cause, and the notice it shows ("The API
  refused eager streaming with strict tool schemas") names the wrong one. Request 3, plain tools,
  is accepted. Each recorded session shows this.
- What it costs: no strict tools, and no eager streaming for the whole session, although eager is
  accepted without strict (`eager-plain` below). The early ghosts of acceptance 5 are lost.
- What fits (live checks `strict-alone`, `strict-budget`, `strict-budget-by-value`): each of the 20
  strict tools compiles alone. The first 13 in the app's order compile together (`get_circuit_state`
  to `write_code`, and `run_code_in_sim`), and the whole 22-tool request with those 13 strict and
  eager on the 12 mutation tools returns 200. The limit is not a count, and not only the strict
  schemas: with the mutation tools first, 11 fit in a whole request (`connect`, `place_part`,
  `place_tboard`, `move_part`, `set_part_props`, `set_wire_props`, `remove_part`, `remove_wire`,
  `add_board`, `write_code`, `get_circuit_state`) with eager on 12 tools, and the 12th
  (`search_parts`) made the whole request fail although the strict tools alone still compiled.
- Suggested fix: `strict` on those 11, so `connect` and `place_part` keep the guarantee; eager on
  the 12 mutation tools as now; and the fallback chain strict+eager, then plain+eager, then plain.
  That changes ADR-M9-2's "every tool that takes parameters is strict" and the counts in
  `contract.test.ts`, so it was left alone.

### 2. "Web search is not enabled for this organization" ends the turn

```
400 invalid_request_error: Web search is not enabled for this organization
```

- A request that carries `web_search_20260318` (called directly, or with the default callers) is
  mostly refused with this message, and sometimes accepted, with the same key and the same tools.
  Over this work a bare probe was accepted 4 times in about 100 (each within a minute or two of a
  long run of other requests; none in a 40-minute wait that probed every 30 seconds), and each
  acceptance was followed within seconds by a refusal of the next request. None of the datasheet
  prompt's 31 attempts, across four runs, got past its first request. `web_fetch_20260318` was
  accepted every time. Request ids of three refusals: `req_011CgMECy2hFybpiJsQ24mCx`,
  `req_011CgMGzuE2SX1nkVcqnKFUX` and `req_011CgMHxUjRmXyeSTE1EncNU`.
- `canFallBack` matches only strict, eager, schema and complexity errors, so the turn ends with
  `error`, and the user is told nothing they can act on. Suggested fix: treat it like the strict
  fallback, on the first request only: rebuild the tools without the web tools, say so in a notice,
  retry, and point at `assistant.webTools`.
- The harness copes by running the datasheet prompt again when this happens (`WEB_RETRIES`); the
  other prompts do not use the web tools.

### 3. `simulate` cannot press a button

In the button run the assistant tried `pressed` (twice) and then `closed` on `SW1` and got
`{"NO_SUCH_INPUT":"SW1 has no input pressed"}` (and `... input closed`); in `second-button-speed` it
tried `pressed` on `SW2` and got the same. The simulator reads `pressed` from a
switch (`core/sim/circuit.ts`, and every tutorial assertion sets it), but `tact-switch-6mm` declares
only `mode`, and the tool accepts only declared properties. So the assistant could not simulate a
press; it said so in its answer and did not claim the toggle worked. ADR-C9-4 already says anything
that seeds a simulator input must declare it as a property. Fix: declare `pressed` (boolean, default
false) on `tact-switch-6mm` and `tilted` on `tilt-switch` in `content/parts/`.

### 4. `run_code_in_sim`: `signal.pause()` returns at once

A program that sets gpiozero callbacks and then calls `pause()`, the usual shape, ends at t = 0 in
the app's Pyodide (`harness.test.ts` shows it). In the button run, `run_code_in_sim` printed the
program's first line and returned with no events at all, so `Button.when_pressed` was never
exercised; the assistant said it could not check the toggling (and, separately, that it could not
press the button, problem 3). Fix: in `workers/python/_prelude.py`, make `signal.pause` sleep in
virtual time until interrupted. The harness's scores do exactly that (`RunOptions.virtualPause`), so
they judge the program and not the shim; the transcripts show what the model was told.

### 5. A project with a part that has no simulation model cannot be simulated at all

`define_custom_part` offers `simModel: "none"`, and the datasheet run used it for the BMP280. Then
`simulate` fails for the whole project, not just for that part:

```
{"SIM_ERROR":"custom-bmp280-breakout-gy-bmp280-6-pin: no simulation model for none"}
```

(`run_code_in_sim` threw the same message in an earlier recording of the run.) The assistant
reported "the simulator has no model for a custom module" and could not check the rest of the
circuit. Fix, in `core/sim/circuit.ts`: treat `none` as a part that adds no devices.

### 6. The gpiozero shim covers five classes

`codePins` reads fifteen gpiozero classes, but the Pyodide shim (`workers/python/gpiozero.py`)
defines `LED`, `Buzzer`, `PWMLED`, `TonalBuzzer` and `Button`. The parking-sensor run wrote its first
program with `DistanceSensor` and `run_code_in_sim` answered
`ImportError: cannot import name 'DistanceSensor' from 'gpiozero' (/home/pyodide/sim/gpiozero.py)`.
The assistant rewrote the program with RPi.GPIO. Nothing to fix in `assistant/`; the system prompt
could tell the model which classes the simulator has.

### 7. A fetched datasheet costs more than `max_content_tokens` suggests

ADR-M9-4 sets `max_content_tokens: 30000` "which bounds what a datasheet costs". One `web_fetch` of
the Bosch BMP280 datasheet was billed as 112,756 input tokens in a single request, about $0.45 at the
Opus 5.5 price, and the fetch result enters the context for the rest of the session. Also,
`web_fetch` refuses a URL that is not already in the conversation:
`url_not_in_prior_context` when the model fetched the datasheet address from memory. So a datasheet
lookup needs `web_search` first, which this organization does not reliably have (problem 2).
