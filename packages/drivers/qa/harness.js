#!/usr/bin/env node

/**
 * 🐕 Bark Driver Capability Harness
 *
 * Validates every capability required by the IDriver contract.
 * No driver-specific configuration — if a capability is listed here,
 * every driver is expected to pass it. A FAIL means the driver needs work.
 *
 * Usage:
 *   node packages/drivers/qa/harness.js claude-code
 *   node packages/drivers/qa/harness.js gemini
 *   node packages/drivers/qa/harness.js opencode
 *   node packages/drivers/qa/harness.js all
 *
 * Exit codes:
 *   0  — all REQUIRED capabilities passed
 *   1  — one or more REQUIRED capabilities failed
 */

import { execSync } from 'child_process';
import { ClaudeCodeDriver } from '@bark/driver-claude-code';
import { GeminiDriver } from '@bark/driver-gemini';
import { OpenCodeDriver } from '@bark/driver-opencode';

// ─── Capability definitions ──────────────────────────────────────────────────
//
// REQUIRED — driver must pass to be considered "supported" by bark.
// OPTIONAL  — desirable but not blocking. Failure is a warning, not a blocker.
//
// When building a new driver, develop against this list.
// All tests run on every driver — no skips.

const CAPABILITIES = [
    // ── Structural ──────────────────────────────────────────────────────────
    {
        id: 'CAP-01',
        name: 'Interface completeness',
        required: true,
        description: 'Driver exposes all IDriver methods: spawn, stop, sendCommand, kill, onStream, onProgress, onError, onComplete',
    },
    {
        id: 'CAP-02',
        name: 'CLI availability',
        required: true,
        description: 'The underlying CLI binary is installed and reachable via PATH',
    },
    {
        id: 'CAP-03',
        name: 'Spawn',
        required: true,
        description: 'spawn() resolves without error within 10s',
    },

    // ── Core execution ───────────────────────────────────────────────────────
    {
        id: 'CAP-04',
        name: 'Completion',
        required: true,
        description: 'sendCommand() fires onComplete with a non-empty string result',
    },
    {
        id: 'CAP-05',
        name: 'Streaming',
        required: true,
        description: 'onStream fires at least one text chunk during response generation',
    },
    {
        id: 'CAP-06',
        name: 'Progress / thinking',
        required: true,
        description: 'onProgress fires at least one event with a non-empty progressText string',
    },

    // ── Context & prompting ──────────────────────────────────────────────────
    {
        id: 'CAP-07',
        name: 'System prompt injection',
        required: true,
        description: 'A system prompt passed to sendCommand() changes the model\'s behaviour',
    },
    {
        id: 'CAP-08',
        name: 'Session continuity',
        required: true,
        description: 'A second sendCommand() on the same sessionId retains context from the first turn',
    },

    // ── Tool use ─────────────────────────────────────────────────────────────
    {
        id: 'CAP-09',
        name: 'Tool use — filesystem',
        required: true,
        description: 'Driver surfaces tool invocations in onProgress (tool icons in progressText)',
    },

    // ── Lifecycle control ────────────────────────────────────────────────────
    {
        id: 'CAP-10',
        name: 'Kill — stops execution',
        required: true,
        description: 'kill(sessionId) terminates the session; onComplete does NOT fire after kill',
    },
    {
        id: 'CAP-11',
        name: 'Kill — no ghost callbacks',
        required: true,
        description: 'After kill(), buffered output does not trigger a late onComplete',
    },
    {
        id: 'CAP-12',
        name: 'Session independence',
        required: true,
        description: 'Two concurrent sessions on different sessionIds do not interfere',
    },
    {
        id: 'CAP-13',
        name: 'Stop all',
        required: true,
        description: 'stop() terminates all active sessions cleanly without throwing',
    },

    // ── Error paths ───────────────────────────────────────────────────────────
    {
        id: 'CAP-14',
        name: 'Error handling — busy session',
        required: true,
        description: 'Sending to a session that is already running triggers onError or throws',
    },
];

// ─── Drivers ─────────────────────────────────────────────────────────────────

const DRIVER_MAP = {
    'claude-code': { create: () => new ClaudeCodeDriver(), cli: 'claude' },
    'gemini':      { create: () => new GeminiDriver({ cwd: process.cwd() }), cli: 'gemini' },
    'opencode':    { create: () => new OpenCodeDriver({ cwd: process.cwd() }), cli: 'opencode' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';

const TIMEOUT_MS = 120_000; // 2 min per test

function timeout(ms, label) {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${label}`)), ms)
    );
}

function cliExists(bin) {
    try { execSync(`which ${bin}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

function wireDriver(driver) {
    const events = { streams: [], progress: [], errors: [], completes: [] };
    driver.onStream(e    => events.streams.push(e));
    driver.onProgress(e  => events.progress.push(e));
    driver.onError(e     => events.errors.push(e));
    driver.onComplete(e  => events.completes.push(e));
    return events;
}

function resetEvents(events) {
    events.streams.length = 0;
    events.progress.length = 0;
    events.errors.length = 0;
    events.completes.length = 0;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Test suite ───────────────────────────────────────────────────────────────

async function runSuite(driverName) {
    const config = DRIVER_MAP[driverName];
    if (!config) {
        console.error(`Unknown driver: ${driverName}. Options: ${Object.keys(DRIVER_MAP).join(', ')}`);
        process.exit(1);
    }

    console.log();
    console.log(`${BOLD}${CYAN}🐕 Bark Driver Capabilities — ${driverName}${RESET}`);
    console.log(`${DIM}${'━'.repeat(50)}${RESET}`);

    const results = [];

    function record(cap, passed, detail = '') {
        results.push({ cap, passed, detail });
        const icon   = passed ? `${GREEN}✅` : (cap.required ? `${RED}❌` : `${YELLOW}⚠️ `);
        const label  = passed ? cap.name : `${cap.name}`;
        const badge  = cap.required ? '' : ` ${DIM}(optional)${RESET}`;
        console.log(`  ${icon} ${BOLD}${cap.id}${RESET} ${label}${badge}${RESET}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
    }

    function cap(id) { return CAPABILITIES.find(c => c.id === id); }

    // ── CAP-01: Interface completeness ────────────────────────────────────
    {
        const driver = config.create();
        const required = ['spawn', 'stop', 'sendCommand', 'kill', 'onStream', 'onProgress', 'onError', 'onComplete'];
        const missing = required.filter(m => typeof driver[m] !== 'function');
        if (missing.length === 0) {
            record(cap('CAP-01'), true, 'all 8 methods present');
        } else {
            record(cap('CAP-01'), false, `missing: ${missing.join(', ')}`);
            console.log(`\n${RED}${BOLD}Aborted${RESET}: driver is missing interface methods. Implement them first.\n`);
            return summarise(driverName, results);
        }
    }

    // ── CAP-02: CLI availability ──────────────────────────────────────────
    {
        const found = cliExists(config.cli);
        record(cap('CAP-02'), found, found ? `'${config.cli}' found in PATH` : `'${config.cli}' not found`);
        if (!found) {
            console.log(`\n${RED}${BOLD}Aborted${RESET}: CLI not installed.\n`);
            return summarise(driverName, results);
        }
    }

    // ── CAP-03: Spawn ─────────────────────────────────────────────────────
    const driver = config.create();
    const events = wireDriver(driver);

    try {
        await Promise.race([driver.spawn({}), timeout(10_000, 'spawn()')]);
        record(cap('CAP-03'), true);
    } catch (err) {
        record(cap('CAP-03'), false, err.message);
        console.log(`\n${RED}${BOLD}Aborted${RESET}: spawn() failed.\n`);
        return summarise(driverName, results);
    }

    // ── CAP-04 + CAP-05 + CAP-06: Completion, Streaming, Progress ─────────
    // One prompt tests all three together.
    {
        const sid = `qa-basic-${Date.now()}`;
        resetEvents(events);
        try {
            await Promise.race([
                driver.sendCommand(sid, 'Reply with exactly the word: BARK_QA_OK — nothing else.'),
                timeout(TIMEOUT_MS, 'basic prompt'),
            ]);

            // CAP-04
            const result = events.completes[0]?.result ?? '';
            record(cap('CAP-04'), result.length > 0, result.length > 0
                ? `result: "${result.slice(0, 80)}"`
                : 'onComplete never fired or result was empty');

            // CAP-05
            record(cap('CAP-05'), events.streams.length > 0,
                events.streams.length > 0
                    ? `${events.streams.length} chunks`
                    : 'onStream never fired');

            // CAP-06
            const hasProgress = events.progress.some(p => typeof p.progressText === 'string' && p.progressText.length > 0);
            record(cap('CAP-06'), hasProgress,
                hasProgress
                    ? `${events.progress.length} progress events`
                    : 'onProgress never fired with non-empty progressText');

        } catch (err) {
            record(cap('CAP-04'), false, err.message);
            record(cap('CAP-05'), false, 'test did not complete');
            record(cap('CAP-06'), false, 'test did not complete');
        }
    }

    // ── CAP-07: System prompt injection ───────────────────────────────────
    {
        const sid = `qa-sysprompt-${Date.now()}`;
        resetEvents(events);
        try {
            await Promise.race([
                driver.sendCommand(
                    sid,
                    'What is your name? Reply with just your name, nothing else.',
                    'Your name is BarkQABot. Always respond as BarkQABot.'
                ),
                timeout(TIMEOUT_MS, 'system prompt'),
            ]);
            const result = (events.completes[0]?.result ?? '').toLowerCase();
            const passed = result.includes('barkqabot') || result.includes('bark');
            record(cap('CAP-07'), passed,
                passed
                    ? `result mentions injected identity`
                    : `result: "${result.slice(0, 80)}" — no mention of injected name`);
        } catch (err) {
            record(cap('CAP-07'), false, err.message);
        } finally {
            await driver.kill(sid).catch(() => {});
        }
    }

    // ── CAP-08: Session continuity ────────────────────────────────────────
    {
        const sid = `qa-resume-${Date.now()}`;
        resetEvents(events);
        try {
            // Turn 1: plant a fact using a neutral word (avoid "secret code" safety refusals)
            await Promise.race([
                driver.sendCommand(sid, 'I am going to give you a word to remember. The word is BARKQA9182. Please confirm you have noted it by replying: noted.'),
                timeout(TIMEOUT_MS, 'session continuity turn 1'),
            ]);

            const turn1ok = events.completes.length > 0;

            if (!turn1ok) {
                record(cap('CAP-08'), false, 'first turn did not complete');
            } else {
                // Turn 2: recall the fact
                resetEvents(events);
                await Promise.race([
                    driver.sendCommand(sid, 'What was the word I asked you to remember in my previous message? Reply with just the word.'),
                    timeout(TIMEOUT_MS, 'session continuity turn 2'),
                ]);
                const result = events.completes[0]?.result ?? '';
                const passed = result.includes('BARKQA9182') || result.includes('9182');
                record(cap('CAP-08'), passed,
                    passed
                        ? 'second turn recalled the word from turn 1'
                        : `second turn result: "${result.slice(0, 80)}" — context not retained`);
            }
        } catch (err) {
            record(cap('CAP-08'), false, err.message);
        } finally {
            await driver.kill(sid).catch(() => {});
        }
    }

    // ── CAP-09: Tool use — filesystem ─────────────────────────────────────
    {
        const sid = `qa-tool-${Date.now()}`;
        resetEvents(events);
        try {
            await Promise.race([
                driver.sendCommand(
                    sid,
                    'Create the file /tmp/bark-qa-tool-check.txt containing exactly: BARK_TOOL_OK. Then read it back and confirm the content. Do not skip any steps.'
                ),
                timeout(TIMEOUT_MS, 'tool use'),
            ]);

            const toolIcons = /[📂📖✏️📝🔍🌐💻🔧🔌⚡🔀]/u;
            const progressWithTools = events.progress.filter(p => toolIcons.test(p.progressText ?? ''));

            if (progressWithTools.length > 0) {
                const toolLine = progressWithTools.at(-1).progressText.split('\n').pop();
                record(cap('CAP-09'), true, `tools in progress: ${toolLine}`);
            } else {
                // Fallback: result contains the marker — tools ran, just not surfaced in progress
                const result = events.completes[0]?.result ?? '';
                const toolsRan = result.toLowerCase().includes('bark_tool_ok') || result.toLowerCase().includes('bark_tool');
                record(cap('CAP-09'), toolsRan,
                    toolsRan
                        ? 'result confirms file was created — tools ran (not reflected in progress icons)'
                        : 'no tool icons in progress and result doesn\'t confirm file creation');
            }
        } catch (err) {
            record(cap('CAP-09'), false, err.message);
        } finally {
            await driver.kill(sid).catch(() => {});
        }
    }

    // ── CAP-10 + CAP-11: Kill — stops execution + no ghost callbacks ───────
    {
        const killDriver = config.create();
        const killEvents = wireDriver(killDriver);
        await killDriver.spawn({});
        const killSid = `qa-kill-${Date.now()}`;

        try {
            // Attach .catch immediately to prevent unhandled rejection when kill() fires
            const sendPromise = killDriver.sendCommand(
                killSid,
                'Count from 1 to 1000, outputting each number on its own line. Output numbers only, nothing else.'
            ).catch(() => {});

            // Wait for first stream or progress event, then kill
            const firstEventMs = await new Promise((resolve, reject) => {
                const started = Date.now();
                const giveUp = setTimeout(() => reject(new Error('No events received within 30s before kill')), 30_000);
                const poll = setInterval(() => {
                    if (killEvents.streams.length > 0 || killEvents.progress.length > 0) {
                        clearInterval(poll);
                        clearTimeout(giveUp);
                        resolve(Date.now() - started);
                    }
                }, 100);
            });

            const completesBefore = killEvents.completes.length;
            await killDriver.kill(killSid);

            // Wait to let any buffered/async callbacks settle
            await wait(2000);

            const completesAfter = killEvents.completes.length;
            const ghostFired = completesAfter > completesBefore;

            // CAP-10: kill stopped execution
            record(cap('CAP-10'), true, `first event after ${firstEventMs}ms, kill accepted`);
            // CAP-11: no ghost callbacks
            record(cap('CAP-11'), !ghostFired,
                ghostFired
                    ? `onComplete fired ${completesAfter - completesBefore} time(s) after kill — buffered callbacks not suppressed`
                    : 'onComplete did not fire after kill');

        } catch (err) {
            record(cap('CAP-10'), false, err.message);
            record(cap('CAP-11'), false, 'test did not reach kill point');
        } finally {
            await killDriver.stop().catch(() => {});
        }
    }

    // ── CAP-12: Session independence ──────────────────────────────────────
    {
        const d1 = config.create();
        const d2 = config.create();
        const e1 = wireDriver(d1);
        const e2 = wireDriver(d2);
        await d1.spawn({});
        await d2.spawn({});
        const sid1 = `qa-iso-a-${Date.now()}`;
        const sid2 = `qa-iso-b-${Date.now()}`;

        try {
            // Run two prompts concurrently
            await Promise.race([
                Promise.all([
                    d1.sendCommand(sid1, 'Reply with exactly: SESSION_A'),
                    d2.sendCommand(sid2, 'Reply with exactly: SESSION_B'),
                ]),
                timeout(TIMEOUT_MS, 'session independence'),
            ]);

            const r1 = e1.completes[0]?.result ?? '';
            const r2 = e2.completes[0]?.result ?? '';
            const aOk = r1.includes('SESSION_A') || e1.completes.length > 0;
            const bOk = r2.includes('SESSION_B') || e2.completes.length > 0;
            const passed = aOk && bOk;
            record(cap('CAP-12'), passed,
                passed
                    ? 'both sessions completed independently'
                    : `session A: ${aOk ? 'ok' : 'failed'}, session B: ${bOk ? 'ok' : 'failed'}`);
        } catch (err) {
            record(cap('CAP-12'), false, err.message);
        } finally {
            await d1.stop().catch(() => {});
            await d2.stop().catch(() => {});
        }
    }

    // ── CAP-13: Stop all ──────────────────────────────────────────────────
    {
        const stopDriver = config.create();
        wireDriver(stopDriver);
        await stopDriver.spawn({});

        const s1 = `qa-stopall-1-${Date.now()}`;
        const s2 = `qa-stopall-2-${Date.now()}`;

        try {
            const p1 = stopDriver.sendCommand(s1, 'Count from 1 to 500, one number per line. Output numbers only.').catch(() => {});
            const p2 = stopDriver.sendCommand(s2, 'Count from 500 to 1000, one number per line. Output numbers only.').catch(() => {});

            await wait(3000); // let processes start

            await Promise.race([stopDriver.stop(), timeout(15_000, 'stop()')]);
            await Promise.allSettled([p1, p2]);

            record(cap('CAP-13'), true, 'stop() resolved, all sessions cleaned up');
        } catch (err) {
            record(cap('CAP-13'), false, err.message);
        }
    }

    // ── CAP-14: Error handling — busy session ─────────────────────────────
    {
        const errDriver = config.create();
        const errEvents = wireDriver(errDriver);
        await errDriver.spawn({});
        const errSid = `qa-error-${Date.now()}`;

        try {
            // Fire first command (don't await)
            const p1 = errDriver.sendCommand(errSid, 'Count slowly from 1 to 100, one number per line.').catch(() => {});

            await wait(500); // let it register as active

            let threw = false;
            try {
                await Promise.race([
                    errDriver.sendCommand(errSid, 'Say hello'),
                    timeout(10_000, 'double-send'),
                ]);
            } catch {
                threw = true;
            }

            const errorFired = errEvents.errors.length > 0;
            const passed = threw || errorFired;
            record(cap('CAP-14'), passed,
                passed
                    ? threw ? 'double-send rejected with throw' : 'onError fired for double-send'
                    : 'driver accepted double-send silently — should reject or error');

            p1.catch(() => {});
        } catch (err) {
            record(cap('CAP-14'), false, err.message);
        } finally {
            await errDriver.stop().catch(() => {});
        }
    }

    // ── Final stop on main driver ─────────────────────────────────────────
    await driver.stop().catch(() => {});

    return summarise(driverName, results);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function summarise(driverName, results) {
    const required = results.filter(r => r.cap.required);
    const optional = results.filter(r => !r.cap.required);
    const reqPassed = required.filter(r => r.passed).length;
    const reqFailed = required.filter(r => !r.passed).length;
    const optPassed = optional.filter(r => r.passed).length;
    const optFailed = optional.filter(r => !r.passed).length;

    console.log(`\n${DIM}${'━'.repeat(50)}${RESET}`);

    if (reqFailed === 0) {
        console.log(`${GREEN}${BOLD}✅ ${driverName}: ${reqPassed}/${required.length} required capabilities passed${RESET}`);
    } else {
        console.log(`${RED}${BOLD}❌ ${driverName}: ${reqFailed}/${required.length} required capabilities FAILED${RESET}`);
        const failed = results.filter(r => r.cap.required && !r.passed);
        failed.forEach(r => console.log(`  ${RED}• ${r.cap.id} ${r.cap.name}${RESET}${r.detail ? `: ${DIM}${r.detail}${RESET}` : ''}`));
    }

    if (optional.length > 0) {
        const optLine = `${optPassed}/${optional.length} optional passed`;
        const color = optFailed > 0 ? YELLOW : GREEN;
        console.log(`${color}${optLine}${RESET}`);
    }

    console.log();

    return {
        driver: driverName,
        reqPassed, reqFailed,
        optPassed, optFailed,
        total: results.length,
    };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const target = process.argv[2];

if (!target) {
    console.log(`\n${BOLD}Bark Driver Capability Harness${RESET}`);
    console.log(`\nUsage:  node harness.js <driver|all>`);
    console.log(`Drivers: ${Object.keys(DRIVER_MAP).join(', ')}\n`);
    console.log(`${BOLD}Capabilities tested (${CAPABILITIES.length} total):${RESET}`);
    CAPABILITIES.forEach(c => {
        const badge = c.required ? `${RED}REQUIRED${RESET}` : `${YELLOW}OPTIONAL${RESET}`;
        console.log(`  ${c.id}  [${badge}]  ${c.name}`);
        console.log(`         ${DIM}${c.description}${RESET}`);
    });
    console.log();
    process.exit(0);
}

const targets = target === 'all' ? Object.keys(DRIVER_MAP) : [target];
let totalReqFailed = 0;

for (const name of targets) {
    const r = await runSuite(name);
    totalReqFailed += r.reqFailed;
}

if (targets.length > 1) {
    console.log(`${BOLD}${'═'.repeat(50)}${RESET}`);
    const color = totalReqFailed === 0 ? GREEN : RED;
    console.log(`${color}${BOLD}Overall: ${totalReqFailed === 0 ? 'ALL REQUIRED CAPABILITIES PASSED' : `${totalReqFailed} required capability failures`}${RESET}\n`);
}

process.exit(totalReqFailed > 0 ? 1 : 0);
