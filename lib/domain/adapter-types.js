export const CAPABILITIES = [
    'message',
    'comment',
    'social',
    'live',
    'feed',
    'signin',
    'pet',
    'game',
    'moment',
];
export function okResult(detail, data) {
    return { ok: true, detail, data };
}
export function failResult(detail, data) {
    return { ok: false, detail, data };
}
