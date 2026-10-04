/** `index` moved one `step` (±1) through a list of `length`, wrapping around at both ends. */
export const cycle = (index: number, step: number, length: number) => (index + step + length) % length;
