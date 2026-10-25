# Assistant evals (M9, task 9.5)

The assistant is scored on whole builds, not on single tool calls: a real `AssistantSession` talks to
the real Anthropic API through the real `@anthropic-ai/sdk` client (1.3.0), and edits a document held
by the app's own `CircuitStore`. Each finished run is scored from its final document and its
transcript. Every run is recorded, scrubbed, and replayed by Vitest with no key and no network.

Everything is in `gpio-dashboard/scripts/assistant-evals/`. The decisions behind it are ADR-0100 to
ADR-0104 in DECISIONS.md; the fixes the first live run led to are ADR-0105 to ADR-0108.

## Running it

| Command | What it does |
| --- | --- |
| `npm run evals` | Replays every recorded run (no key, no network) and prints its scores. Exit status 1 if a score differs from the live run, or a prompt has no fixture. `-- --only a,b` picks prompts; `-- --rescore` records today's scores as the expected ones. |
| `npm run evals:live` | Runs the live checks, then every prompt against the API with the key from the main checkout's `.env`, and writes `fixtures/`, `transcripts/` and `results/live*.json`. `-- --only a,b`, `-- --skip-checks`, `-- --checks-only`, `-- --budget 40`, `-- --model claude-sonnet-5-5`, `-- --key-file path`. For the datasheet prompt on an organization whose web search comes and goes, the loop meets a refusal itself (ADR-0106) and the notice is in the transcript. To record the search path instead: `-- --search` (keep the tool and resend refused requests), `-- --no-search` (offer web fetch alone from the start), `-- --wait-for-search 30` (poll up to 30 minutes for it). |
| `npm run evals:proxy` | Runs the ignored Rust test `live_count_tokens_through_the_real_proxy_path`, with the key in that test process's environment only. |
| `npx vitest run scripts/assistant-evals` | The replay test and the harness's own tests. |

Without a key, `evals:live` says so and replays instead. The key is read only by the process that
uses it (SPEC 3.3, ADR-0102).

## The harness

- **A Node program, not a mock.** `cli.ts` starts Vite's module runner so the app's TypeScript loads
  unchanged (ADR-0100). `NodeContext` implements `AssistantContext` over:
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
  - Ghosts (`setGhost`) are recorded and must all be cleared by the end of the turn. Whether one is
    drawn before a tool's input completes is a property of the app's window, which a headless run
    cannot see; each run instead counts, per tool, the partial inputs that arrived before a call
    was complete and how many were enough to draw a ghost.
  - `run_code_in_sim` stops a program at its `seconds` by raising from the next shim call, so the
    result is the same every run. (Pyodide's own interrupt arrived 0 to 2 s late, and not the same
    each time.) A program's last `time.sleep` can carry it past `seconds`; the run prints the
    virtual time reached.
- **Fixtures** (`fixtures/<prompt>.json`) hold, for each request the SDK made, the JSON body it sent
  and the status and SSE text it got back. No header is ever read. Opaque tokens (`signature`,
  `encrypted_content`, `encrypted_index`) are replaced by `scrubbed`. A test fails on `sk-ant`, on
  an `authorization` or `x-api-key` key, and on any unscrubbed token (ADR-0101).
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
  All 26 shipped tutorials pass it (`checks.test.ts`).
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
This is the second recording, made after the fixes of ADR-0105 to ADR-0108: **no run took a
fallback for its tools.** The first request of eleven runs was accepted with the 11 strict tools and
eager streaming on the 12 mutation tools. The datasheet run's was refused for web search, dropped
it, and went on (the second problem below).

| Prompt | Checks passed | Turns | Requests | Tool calls | Input | Output | Cache write | Cache read | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `blink-led` | 14/14 | 1 | 8 | 11 | 18 | 2,150 | 3,795 | 124,163 | $0.09 |
| `button-toggles-led` | 15/15 | 1 | 11 | 19 | 24 | 4,338 | 8,704 | 200,226 | $0.17 |
| `parking-sensor` | 14/14 | 1 | 19 | 49 | 40 | 11,615 | 20,801 | 484,922 | $0.43 |
| `parking-sensor-direct` | 15/15 | 1 | 19 | 48 | 40 | 11,936 | 25,186 | 463,790 | $0.46 |
| `undo-all` | 13/13 | 2 | 16 | 22 | 36 | 3,806 | 8,161 | 282,810 | $0.17 |
| `second-button-speed` | 13/13 | 1 | 7 | 9 | 16 | 2,748 | 7,241 | 124,048 | $0.12 |
| `rgb-led` | 13/13 | 1 | 11 | 20 | 24 | 4,333 | 9,945 | 199,885 | $0.18 |
| `buzzer-driver` | 15/15 | 1 | 13 | 22 | 28 | 4,185 | 9,530 | 236,202 | $0.18 |
| `pot-adc` | 13/13 | 1 | 9 | 19 | 20 | 3,677 | 7,152 | 161,034 | $0.14 |
| `debug-board-sense` | 12/12 | 1 | 3 | 3 | 8 | 1,682 | 3,922 | 45,658 | $0.06 |
| `explain-no-change` | 10/10 | 1 | 4 | 3 | 10 | 1,073 | 2,229 | 59,594 | $0.04 |
| `bmp280-datasheet` | 11/14 | 1 | 9 | 16 | 244 | 5,280 | 22,847 | 161,042 | $0.25 |
| **Total** | | | 129 | 241 | 508 | 56,823 | 129,513 | 2,543,374 | **$2.29** |

Token columns are uncached input, output, cache writes and cache reads; 95% of the prompt tokens of
all twelve runs were cache reads. Cost is computed from `prices.ts`. Wall time per run was 15 s
(`explain-no-change`) to 122 s (`parking-sensor-direct`). The previous recording cost $2.75: fewer
requests (129, not 151) because the first request is no longer refused twice, and fewer tool calls
(241, not 269) because of the fixes below.

The only failures are the datasheet run's three, and they are the organization's, not the model's:
web search is refused (the second problem), the run went on with web fetch alone, and the model
tried to fetch the Bosch datasheet from memory, got `url_not_in_prior_context` (a fetched URL has
to appear earlier in the conversation), and built the part with no datasheet URL: `datasheet` (no
`https` URL on the part), `web-tools` (no web call returned) and `mixed-turn` fail. The run's
notice, which the user would have seen:

> The API refused web search (“Web search is not enabled for this organization”), so this
> conversation runs without it. The “Web search and fetch, for datasheets” setting turns the web
> tools off for new conversations.

What the runs showed, beyond the pass flags:

- **Eager streaming (acceptance 5).** The wire shows partial tool input. Across the twelve runs,
  428 snapshots of a `place_part` input and 534 of a `connect` input arrived before the call was
  complete, and 238 and 182 of them were enough to draw a ghost (`ghostFor` returned one). A
  headless run can not show the ghost on screen; the count is of the events the loop gets, which
  are what the window draws from. Each run prints them per tool.
- **Pressing a button in `simulate`.** `button-toggles-led` called `simulate` with
  `SW1.pressed = false` and then `true`, both without error; the pin read high released and low
  pressed. `second-button-speed` pressed `SW2`. The tool error `NO_SUCH_INPUT` did not occur in any run.
- **An event-driven gpiozero program.** The program in `button-toggles-led` sets `when_pressed` on a
  `Button` and calls `pause()`. `run_code_in_sim` ran it to 5.00 of 5 s and its last event is
  `5.000 GPIO17 low`, the `finally` clause at the end of the time; in `second-button-speed` the program ran to
  10.00 of 10 s. In the first recording the same shape ended at t = 0.
- **gpiozero classes.** `parking-sensor` wrote its program with `DistanceSensor` and
  `PWMOutputDevice`; `run_code_in_sim` printed `29.9 cm` for the 30 cm the model had set on the HC-SR04
  (the module's 58 µs per cm against gpiozero's 343.26 m/s reads 0.45% short). In the first recording
  the same prompt raised `ImportError` and the assistant rewrote the program with RPi.GPIO.
- **A part with no simulation model.** The datasheet run defined a custom part with
  `simModel: "none"` and then ran `simulate`, which answered with the circuit.
- **Blink**: ERC-clean, 5.49 mA at GPIO17; the program toggles GPIO17 five times in 3 s; undo
  restores the empty document exactly (5 of 5 transactions).
- **Parking sensor (acceptance 6)**: both runs end ERC-clean with ECHO divided down to GPIO24, 3.30 V
  at the most on any GPIO net in a simulated measurement. In `parking-sensor-direct`, asked to wire
  ECHO straight to a GPIO first, the model did; `run_erc` answered `OVERVOLTAGE_GPIO` and it built
  the divider in the same turn (34 transactions, one undo group). `parking-sensor` wired the divider
  from the start (36 transactions).
- **Undo (acceptance 7)**: every one of the ten building runs, including the two-turn one, undoes
  to a document strictly deep-equal to where it started (`undo.all`), and undoing turn 2 of
  `undo-all` restores the document after turn 1 (`undo.turn2`).
- **Wiring convention (acceptance 17)**: no run broke it.
- **Debugging**: `read_board_sense` was the first call; no edit. The answer named the lead that had
  been removed and said what the Pi can not observe.
- **Tool friction**: of 241 client tool calls, 11 returned an error: 10 `capture_view` (not
  available headless, by design) and 1 `search_parts` `NO_MATCH` for "BMP280", which is what sends
  the assistant to `define_custom_part`. In the first recording there were 22: no `BAD_PLACEMENT`,
  `NO_SUCH_INPUT`, `SIM_ERROR` or import error came up this time.
- **Scoring.** One scorer changed. `led.blink()` is one `pwm 1 Hz 50%` event, and the blink check
  counted only high and low events, so the first live run of `blink-led` scored 13/14 on a correct
  program. A background blink now counts as the level changes it makes. `blink-led` was recorded
  again with the corrected scorer.

Money spent in this pass: $3.16. The full live run cost $2.91 ($0.61 for the checks, $2.30 for the
prompts), `blink-led` was recorded once more after the scorer change ($0.09), and a trial of the
fixed core on `blink-led` before the full run cost $0.16. $0.45 of the checks is one fetch of the
datasheet (problem 7).

## Live checks

Run on 2026-10-24 (US Eastern) against `claude-opus-5-5`, with the SDK's `anthropic-version`
2026-10-21. Each is the smallest request that settles its question; `npm run evals:live --
--checks-only` repeats them and writes `results/live-checks.json`.

| Question | Answer | Evidence |
| --- | --- | --- |
| Is the strict-plus-eager tool set accepted? | **Yes.** | Request 1 of a real two-turn session: 22 tools, 11 strict, 12 with `eager_input_streaming`: 200, and no fallback ran. The first request of the eleven runs without web tools was the same. |
| Does the whole request compile with all 20 parameterised tools strict? | **No.** | Refused, exactly the message below. Each of the 20 strict tools compiles alone. |
| Is there room beyond the 11 strict tools the app sends? | **No.** | The app's set returned 200; adding each of the other nine in turn to the whole request was refused. |
| Are `eager_input_streaming` tools accepted when none is strict? | **Yes.** | 22 plain tools, 12 with eager: 200. |
| Is the top-level `cache_control` accepted? | **Yes.** | Every request that carried it (with a second breakpoint on the last system block) returned 200, in the checks and in all twelve runs. |
| Do cache reads appear on later requests? | **Yes.** | In the check, request 2 read 14,216 tokens, wrote 16 and billed 4 uncached. In the runs, every accepted request after the first read the cache (`replay.test.ts` asserts it); the totals are in the cost table. |
| Do the web tools run with `allowed_callers: ["direct"]`? | **`web_fetch`: yes. `web_search`: not settled; it has never run.** | `web_fetch_20260318` (direct) fetched the Bosch BMP280 datasheet from a URL in the prompt and the turn ended `end_turn` ($0.45, problem 7). `web_search_20260318` was refused with the message under problem 2, direct and with the default callers; `web_fetch` was accepted both ways. |
| Rust: `live_count_tokens_through_the_real_proxy_path` | Passed in the first pass; not run again in this one. | `npm run evals:proxy`. Nothing in this pass touches the proxy. |

The refusal of the 20 strict tools, exactly:

```
400 invalid_request_error: The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.
```

## Findings of the first live run, and what fixed them

The first recording found seven problems. Six are fixed; the decisions are ADR-0105 to ADR-0108 in
DECISIONS.md. The second recording above is the evidence that each holds.

### 1. The 20 strict tools were over the API's grammar budget, so every session ran on plain tools

Fixed (ADR-0105). Before: the first request carried the 20 strict tools with eager streaming on the
12 mutation tools, and the second the same without eager. Both were refused with the message
above, the third (plain tools) was accepted, and the loop's notice named eager streaming, which was
not the cause. Eager streaming and the early ghosts of acceptance 5 were lost for the session.

- Measured: each of the 20 strict tools compiles alone; the limit is the size of the grammar, not a
  count; with the mutation tools first, 11 fit in a whole request, and no other tool fits beside them
  (`strict-room`); eager streaming is accepted with no strict tool.
- Fix: `STRICT_TOOLS` is `get_circuit_state`, `add_board`, `place_tboard`, `place_part`,
  `move_part`, `remove_part`, `set_part_props`, `connect`, `set_wire_props`, `remove_wire` and
  `write_code`, with eager streaming on all 12 mutation tools. A refused first request drops
  strict, then eager (eager first if the API names it), and each notice quotes the API's message.
  `loop.test.ts` covers each step; `contract.test.ts` pins the set.
- Evidence: the first request of every run is a single accepted request, 22 tools, 11 strict, 12
  eager (`replay.test.ts`, "what the fixes changed").

### 2. "Web search is not enabled for this organization" ended the turn

Fixed (ADR-0106). The message, exactly:

```
400 invalid_request_error: Web search is not enabled for this organization
```

A request that carries `web_search_20260318` is mostly refused with this, and sometimes accepted,
with the same key and tools. Before, `canFallBack` did not match it and the turn ended in an error.
Now the first request of a conversation is sent again without the tool the API names, with a
notice; `web_fetch` stays. A refusal later in a conversation still ends the turn, because the tools
are bound to the thinking blocks by then.

- Evidence: in `bmp280-datasheet` the first request was refused (400), the second carried no
  `web_search`, 11 strict and 12 eager tools, and the turn ran to `end_turn` with the notice above.
  The organization's web search is still refused, in the checks too, so the search path itself has
  not run. The harness no longer retries this prompt for the first-request case (`WEB_RETRIES` and
  `--search` stay for a refusal that comes later).

### 3. `simulate` could not press a button

Fixed (ADR-0107). The simulator reads `pressed` from a tact switch, but `tact-switch-6mm` declared
only `mode`, and the tool accepts only declared properties (`NO_SUCH_INPUT: SW1 has no input
pressed`). The layer is the part definition, as ADR-0093 says: `tact-switch-6mm` now declares
`pressed`. `tilt-switch` already declared `tilted`. A new test records every environment key the
simulator reads from each library part and requires it to be declared, which would have caught
this; the keypad's `pressedKeys` (text, not a property type) is the one exception, so a key can
not yet be pressed in `simulate`. `simulate` now checks an input with `propProblem`, the check
`validateDoc` uses, and a wrong name lists the part's properties. `BAD_PROP` is unchanged.

- Evidence: the button runs above; `tools.test.ts` presses a switch and reads GPIO18 at 3.3 V and
  near 0 V.

### 4. `run_code_in_sim`: `signal.pause()` returned at once

Fixed (ADR-0108). `_prelude.py` now replaces `signal.pause` with a loop of 10 ms virtual sleeps,
which ends with the run (Stop, Ctrl+C and the end of the time are all `KeyboardInterrupt`). The
harness no longer swaps it in for the scores, so the model sees what the scores judge.

- Evidence: `gpiozero.test.ts` ("signal.pause"), `harness.test.ts`, and the two button runs above.
- Not changed: nothing presses a button during a `run_code_in_sim`, so a callback that waits for an
  edge does not run there; the run shows that the program waits for the time it was given.

### 5. A project with a part that has no simulation model could not be simulated at all

Fixed (ADR-0107). `Circuit.addPart` threw `no simulation model for none`. `none` now adds no
devices: the part's pins are nets and nothing is stamped. Evidence: `session.test.ts`, which fails
without the change, and the datasheet run's `simulate`, which answered.

### 6. The gpiozero shim covered five classes

Fixed (ADR-0108). The shim now has every class `core/code/pins.ts` reads: `OutputDevice`,
`DigitalOutputDevice`, `PWMOutputDevice`, `RGBLED`, `Servo`, `AngularServo`, `InputDevice`,
`DigitalInputDevice`, `MotionSensor`, `LineSensor` and `DistanceSensor`, with the original five.
`DistanceSensor` times ECHO call by call against the HC-SR04 model, the servos send their pulse
width as PWM to the SG90 model, and `MotionSensor` reads the HC-SR501. `pins.ts` exports the class
list, and a test requires the shim to import each one. `codePins` now also reads `RGBLED`'s three
pins and `DistanceSensor`'s two by position. The system prompt lists the classes. Not modelled:
fades (`PWMLED.pulse`, `RGBLED.blink`), `Button.when_held`, and the sensors' smoothing queues.

- Evidence: `gpiozero.test.ts` (11 tests on real gpiozero code over tutorial circuits: distances
  of 50, 120 and 300 cm read within 1%, range callbacks as a distance is moved, servo angles,
  RGB colours on their own pins, a PIR's callback after its warm-up) and the `parking-sensor` run.

### 7. A fetched datasheet costs more than `max_content_tokens` suggests

Not changed. ADR-0086 sets `max_content_tokens: 30000` "which bounds what a datasheet costs". One
`web_fetch` of the Bosch BMP280 datasheet was billed as 112,756 input tokens in a single request,
about $0.45 at the Opus 5.5 price, and the fetch result enters the context for the rest of the
session. Also, `web_fetch` refuses a URL that is not already in the conversation:
`url_not_in_prior_context` when the model fetched the datasheet address from memory. So a datasheet
lookup needs `web_search` first, which this organization does not reliably have (problem 2).
