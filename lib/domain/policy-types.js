const PERSONAL_SURFACES = new Set([
    'message',
    'image',
    'voice',
    'share',
    'mention',
]);
export function isOutbound(surface) {
    return surface !== 'device';
}
export function targetsPerson(surface) {
    return PERSONAL_SURFACES.has(surface);
}
export function needsText(surface) {
    return (surface === 'message' ||
        surface === 'voice' ||
        surface === 'moment' ||
        surface === 'comment' ||
        surface === 'mention');
}
