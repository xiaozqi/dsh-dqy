export class PriorityTapPolicy {
    priority;
    constructor(priority = []) {
        this.priority = priority;
    }
    decide(_round, matches) {
        if (matches.length === 0)
            return null;
        const ordered = [...matches].sort((a, b) => {
            const rankDiff = this.rank(a.label) - this.rank(b.label);
            if (rankDiff !== 0)
                return rankDiff;
            return b.score - a.score;
        });
        const target = ordered[0];
        return {
            action: 'tap',
            target: target.label,
            point: target.point,
            reason: `highest priority match: ${target.label} ` +
                `(${target.score.toFixed(2)})`,
        };
    }
    rank(label) {
        const index = this.priority.indexOf(label);
        return index === -1 ? this.priority.length + 1 : index;
    }
}
