import { findNode } from './wait-for.js';
// The chat header occupies the top band; the input bar sits at the bottom.
// Anything in between is content (message list rows, bubbles, search results),
// where the same name can also appear — matching there is how a reply ended up
// in the wrong conversation.
const HEADER_RATIO = 0.18;
const INPUT_FLOOR_RATIO = 0.62;
export function headerShowsPeer(observation, peer, size) {
    const limit = size.height * HEADER_RATIO;
    return (findNode(observation.roots, node => {
        if (node.bounds.bottom > limit) {
            return false;
        }
        const label = `${node.text} ${node.desc}`.trim();
        return label === peer || label.includes(peer);
    }) !== null);
}
export function findBottomInput(observation, size, matches) {
    const floor = size.height * INPUT_FLOOR_RATIO;
    return findNode(observation.roots, node => node.bounds.top >= floor && matches(node));
}
