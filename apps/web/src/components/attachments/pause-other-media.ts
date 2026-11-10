const MEDIA_PLAYER_SELECTOR = "audio[data-ponder-audio-player], video[data-ponder-video-player]";

export const pauseOtherMediaPlayers = (activePlayer: HTMLMediaElement) => {
  activePlayer.ownerDocument
    .querySelectorAll<HTMLMediaElement>(MEDIA_PLAYER_SELECTOR)
    .forEach((player) => {
      if (player !== activePlayer) player.pause();
    });
};
