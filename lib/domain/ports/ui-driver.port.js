function matchField(value, pattern) {
    if (pattern === undefined)
        return true;
    if (typeof pattern === 'string')
        return value.includes(pattern);
    const flags = pattern.flags.replace(/[gy]/g, '');
    return new RegExp(pattern.source, flags).test(value);
}
export function matches(node, matcher) {
    return (matchField(node.text, matcher.text) &&
        matchField(node.desc, matcher.desc) &&
        matchField(node.resourceId, matcher.resourceId) &&
        matchField(node.className, matcher.className));
}
export function center(node) {
    return {
        x: Math.round((node.bounds.left + node.bounds.right) / 2),
        y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
    };
}
