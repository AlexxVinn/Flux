-- Scene ops require playback_state = 'paused'. Client no longer uses global "playing" for physics.
update public.rooms
set playback_state = 'paused'
where playback_state = 'playing';
