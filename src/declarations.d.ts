declare module 'node-wav-player' {
  interface PlayOptions {
    path: string;
    sync?: boolean;
    loop?: boolean;
  }

  interface WavPlayer {
    play(options: PlayOptions): Promise<void>;
    stop(): void;
  }

  const player: WavPlayer;
  export default player;
}
