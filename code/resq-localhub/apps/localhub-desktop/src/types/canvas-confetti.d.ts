declare module "canvas-confetti" {
  type Options = {
    particleCount?: number;
    spread?: number;
    origin?: { x?: number; y?: number };
  };

  const confetti: (options?: Options) => void;

  export default confetti;
}