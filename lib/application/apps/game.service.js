import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { failResult, okResult } from '../../domain/adapter-types.js';
import { sleep } from '../support/wait-for.js';
const DEFAULT_FINISH_LABELS = ['success', 'finish', 'close'];
export class GameService {
    driver;
    vision;
    templateRoot;
    policy;
    id = 'game';
    displayName = '游戏';
    packageName = '';
    capabilities = new Set([
        'game',
    ]);
    todos = [
        {
            capability: 'game',
            feature: 'puzzle solver policies',
            note: 'not implemented: board-level solving needs a custom GamePolicy (e.g. match-3 grid analysis)',
        },
    ];
    constructor(driver, vision, templateRoot, policy) {
        this.driver = driver;
        this.vision = vision;
        this.templateRoot = templateRoot;
        this.policy = policy;
    }
    async initialize() { }
    async runGame(input) {
        try {
            const run = await this.run({
                game: input.game,
                rounds: input.rounds,
                threshold: input.threshold,
            });
            return okResult(`game ${run.game} finished after ${run.rounds} rounds`, {
                game: run.game,
                rounds: run.rounds,
                finishedAt: run.finishedAt,
                steps: run.steps.length,
            });
        }
        catch (err) {
            return failResult(`game failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async run(options) {
        const rounds = options.rounds ?? 30;
        const threshold = options.threshold ?? 0.85;
        const settleMs = options.settleMs ?? 1200;
        const finishLabels = options.finishLabels ?? DEFAULT_FINISH_LABELS;
        await this.driver.connect();
        const steps = [];
        let emptyStreak = 0;
        for (let round = 1; round <= rounds; round++) {
            const observation = await this.driver.observe();
            const templates = this.listTemplates(options.game);
            const matches = await this.vision.matchTemplates(observation.screenshotPath, templates, threshold);
            if (matches.some(m => finishLabels.includes(m.label))) {
                steps.push({
                    action: 'finish',
                    reason: 'finish template matched',
                });
                break;
            }
            const step = this.policy.decide(round, matches, observation);
            if (!step) {
                emptyStreak++;
                if (emptyStreak >= 3) {
                    steps.push({
                        action: 'finish',
                        reason: 'no template matched for 3 rounds',
                    });
                    break;
                }
                await this.driver.pressKey('back');
                await sleep(settleMs);
                continue;
            }
            emptyStreak = 0;
            steps.push(step);
            await this.execute(step);
            await sleep(settleMs);
        }
        return {
            game: options.game,
            rounds: steps.length,
            steps,
            finishedAt: new Date().toISOString(),
        };
    }
    listTemplates(game) {
        const dir = join(this.templateRoot, game);
        return readdirSync(dir)
            .filter(file => file.toLowerCase().endsWith('.png'))
            .map(file => ({
            label: file.replace(/\.png$/i, ''),
            path: join(dir, file),
        }));
    }
    async execute(step) {
        if (step.action === 'tap' && step.point) {
            await this.driver.tap(step.point);
        }
        else if (step.action === 'long_press' && step.point) {
            await this.driver.longPress(step.point, 1200);
        }
        else if (step.action === 'press_key' && step.target) {
            await this.driver.pressKey(step.target);
        }
    }
}
